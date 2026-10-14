"""Indexed timeline queries and replayable cursors shared by all server workers."""
from __future__ import annotations

import json
import time
import uuid

from .matching import MIN_TIME, Search, annotate, compact, compile_filter, counts, digest, has_match, instant, iso


def envelope(params, events=None, **metadata):
    return {"dateTimeFormat": "iso8601", "scene": params.get("scene", "0"), "events": events or [],
            "timelineMatch": {"version": 1, "provider": "json_file", "query": params.get("search", ""),
                "searchMode": params.get("searchMode") or "legacy", "hasCondition": bool(params.get("search", "").strip()) and not (params.get("searchMode", "legacy") == "legacy" and params.get("search", "").strip() == "*"),
                "domain": {"from": iso(MIN_TIME if params.get("history") == "backward" else instant(params["startDate"])),
                           "to": iso(instant(params["endDate"]))}, "complete": False, **metadata}}


class Queries:
    def __init__(self, index):
        self.index, self.config = index, index.config
        self.source_filters = {}
        for source in self.config.sources:
            include = compile_filter(source.include if isinstance(source.include, str) else "")
            exclude = compile_filter(source.exclude) if isinstance(source.exclude, str) and source.exclude else lambda _: False
            self.source_filters[source.index] = (include, exclude)

    def identity(self, params):
        return digest([self.config.signature, {key: params.get(key, "") for key in (
            "startDate", "endDate", "scene", "namespace", "userName", "timelineName", "filter", "sortBy", "search", "searchMode", "history")}])

    def validate(self, params):
        lower, upper = instant(params.get("startDate")), instant(params.get("endDate"))
        if upper <= lower:
            raise ValueError("Invalid time range.")
        if params.get("history") not in (None, "", "backward"):
            raise ValueError("Unknown history direction.")
        return MIN_TIME if params.get("history") == "backward" else lower, upper

    @staticmethod
    def snapshot(db, identifier, lower, upper, source_indices=None):
        # Capture only files that can overlap this window, plus coverage warnings.
        # The R-tree indexes days as exact integers; full timestamps below remove
        # the conservative candidates at day boundaries, including BCE dates.
        if source_indices == []:
            return
        source_clause = " AND source IN (" + ",".join("?" for _ in source_indices) + ")" if source_indices is not None else ""
        db.execute("""INSERT OR IGNORE INTO cursor_files
            SELECT ?,key,version,source,warning FROM files WHERE (warning!='[]' OR key IN (
              SELECT r.file_key FROM record_windows w CROSS JOIN records r ON r.id=w.id
              WHERE w.start_day<=? AND w.end_day>=? AND r.start<=? AND r.end>=?))""" + source_clause,
                   (identifier, upper//86400000, lower//86400000, upper, lower, *(source_indices or [])))

    def page(self, params):
        started = time.monotonic()
        lower, upper = self.validate(params)
        predicate = compile_filter(params.get("filter", ""))
        try:
            search = Search(params.get("search"), params.get("searchMode"))
        except ValueError:
            return envelope(params, error="Invalid search expression.", revision=self.index.status()["revision"])
        identity = self.identity(params)
        requested_namespace = params.get("namespace", "")
        source_indices = sorted({source.index for source in self.config.sources if source.namespace == requested_namespace}) if requested_namespace else None
        token = params.get("cursor") or ""
        with self.index.connect() as db:
            # One short transaction serializes consumption of the same cursor, including
            # requests arriving at different processes. Pages have a 250 ms work budget.
            db.execute("BEGIN IMMEDIATE")
            status = self.index.get(db, "status")
            identifier, separator, raw_sequence = token.partition(":")
            row = db.execute("SELECT * FROM cursors WHERE id=?", (identifier,)).fetchone() if token else None
            valid = row and separator and raw_sequence.isdigit() and row["identity"] == identity and row["touched"] >= time.time() - self.config.cursor_ttl
            if params.get("cancel") == "1":
                if valid:
                    db.execute("DELETE FROM cursors WHERE id=?", (identifier,))
                    db.execute("DELETE FROM cursor_files WHERE cursor=?", (identifier,))
                return envelope(params, cancelled=True, progressive=True, nextCursor=None, revision=status["revision"])
            if token:
                if not valid or int(raw_sequence) not in (row["sequence"], row["sequence"] - 1):
                    return envelope(params, error="Loading cursor expired or unavailable. Retry the visible time window.", revision=status["revision"])
                if int(raw_sequence) == row["sequence"] - 1:
                    result = json.loads(row["last"])
                    result["timelineMatch"]["cache"] = "replay"
                    db.execute("UPDATE cursors SET touched=? WHERE id=?", (time.time(), identifier))
                    return result
                state, sequence = json.loads(row["state"]), row["sequence"]
                if state.get("done"):
                    return envelope(params, error="Loading cursor expired or unavailable. Retry the visible time window.", revision=status["revision"])
            else:
                self.index.cleanup(db)
                # Completed cursors are retained for retries unless capacity is needed.
                if db.execute("SELECT count(*) FROM cursors").fetchone()[0] >= self.config.max_cursors:
                    oldest = db.execute("SELECT id FROM cursors WHERE json_extract(state,'$.done')=1 ORDER BY touched LIMIT 1").fetchone()
                    if oldest:
                        db.execute("DELETE FROM cursors WHERE id=?", (oldest[0],))
                        db.execute("DELETE FROM cursor_files WHERE cursor=?", (oldest[0],))
                    else:
                        return envelope(params, error="The server is processing too many timeline scans. Retry shortly.", revision=status["revision"])
                identifier, sequence = uuid.uuid4().hex, 0
                state = {"last": 0, "sessions": 0, "events": 0, "examined": 0, "seconds": 0, "initial": status["indexing"],
                         "revision": status["revision"], "warnings": [warning for warning in status["warnings"]
                            if not requested_namespace or not warning.get("namespace") or warning["namespace"] == requested_namespace]}
                db.execute("INSERT INTO cursors VALUES(?,?,?,?,?,?)", (identifier, identity, 0, compact(state), "{}", time.time()))
                self.snapshot(db, identifier, lower, upper, source_indices)
            if state["initial"]:
                self.snapshot(db, identifier, lower, upper, source_indices)
                state["warnings"] = [warning for warning in status["warnings"]
                                     if not requested_namespace or not warning.get("namespace") or warning["namespace"] == requested_namespace]
                state["revision"] = status["revision"]
                state["initial"] = status["indexing"]
            warnings = list(state["warnings"])
            for row_warning in db.execute("SELECT warning FROM cursor_files WHERE cursor=?", (identifier,)):
                warnings.extend(json.loads(row_warning[0]))
                if len(warnings) >= 100:
                    break
            # Keep diagnostics bounded without silently declaring full coverage.
            warnings = warnings[:100]
            history = params.get("history") == "backward"
            if history:
                # Seek directly to the next chronological record. Sorting all
                # historical candidates on every page can exhaust the query
                # budget before even a handful of records are examined.
                sql = """SELECT r.id,r.start,c.source FROM records r INDEXED BY records_history
                         JOIN cursor_files c ON r.file_key=c.file_key AND r.version=c.version
                         WHERE c.cursor=? AND (r.start,r.id)<(?,?) AND r.start<=? AND r.end>=?
                         ORDER BY r.start DESC,r.id DESC LIMIT 4097"""
                arguments = (identifier, state.get("lastStart", upper+1), state["last"], upper, lower)
            else:
                sql = """SELECT r.id,r.start,c.source FROM record_windows w
                         CROSS JOIN records r ON r.id=w.id
                         JOIN cursor_files c ON r.file_key=c.file_key AND r.version=c.version
                         WHERE w.start_day<=? AND w.end_day>=? AND c.cursor=? AND r.id>? AND r.start<=? AND r.end>=?
                         ORDER BY r.id LIMIT 4097"""
                arguments = (upper//86400000, lower//86400000, identifier, state["last"], upper, lower)
            rows = db.execute(sql, arguments) if not (history and state["initial"]) else None
            events, examined, size, exhausted = [], 0, 0, True
            for row_record in rows or ():
                if examined and (examined >= 4096 or time.monotonic() - started >= .25 or len(events) >= self.config.page_size or size >= 512 * 1024):
                    exhausted = False
                    break
                # Sort only IDs in SQLite. Fetch one payload at a time so broad
                # windows cannot materialize thousands of large records at once.
                record = json.loads(db.execute("SELECT payload FROM records WHERE id=?", (row_record["id"],)).fetchone()[0])
                include, exclude = self.source_filters.get(row_record["source"], (lambda _: True, lambda _: False))
                accepted = include(record) and not exclude(record) and predicate(record)
                item = annotate(record, search, lower, upper, record["sourceRecordKey"]) if accepted else None
                if item is not None and params.get("history") == "backward" and search.active and not has_match(item):
                    item = None
                if item is not None:
                    item_size = len(compact(item).encode("utf-8"))
                    if events and size + item_size > 512 * 1024:
                        exhausted = False
                        break
                    events.append(item)
                    size += item_size
                state["last"] = row_record["id"]
                state["lastStart"] = row_record["start"]
                examined += 1
            if rows is not None:
                rows.close()
            done = exhausted and not state["initial"]
            sessions, event_count = counts(events)
            state["sessions"] += sessions
            state["events"] += event_count
            state["examined"] += examined
            state["seconds"] += time.monotonic() - started
            if not done and (state["examined"] >= self.config.max_records or state["seconds"] >= self.config.max_query_seconds):
                done = True
                warnings.append({"code": "scan_limit", "namespace": "", "reason": "The query reached its configured work limit; coverage is partial.",
                                 "action": "Narrow the time window or filter, or increase the server query limits."})
            state["done"] = done
            result = envelope(params, events, complete=done and not warnings, revision=state["revision"], progressive=True,
                              batch=sequence, nextCursor=None if done else f"{identifier}:{sequence + 1}",
                              recordsExamined=examined, recordsReturned=len(events), recordsExcluded=examined-len(events),
                              uniqueSessions=state["sessions"], uniqueEvents=state["events"], cache="index",
                              scanSlices=1, indexedFilesSkipped=0, charactersRead=0,
                              elapsedMillis=round((time.monotonic()-started)*1000), warnings=[w["reason"] for w in warnings], warningDetails=warnings,
                              indexing=state["initial"])
            metadata = result["timelineMatch"]
            if not events and not done:
                state["emptyPages"] = state.get("emptyPages", 0) + 1
                metadata["retryAfterMs"] = min(2000, 250 * 2**min(state["emptyPages"], 3)) if state["initial"] else 50
            else:
                state["emptyPages"] = 0
            if params.get("history") == "backward":
                metadata["history"] = {"direction": "backward", "supported": True, "exhausted": done,
                                       "incomplete": bool(warnings), "filesExamined": status["files"]}
            db.execute("UPDATE cursors SET sequence=?,state=?,last=?,touched=? WHERE id=?",
                       (sequence + 1, compact(state), compact(result), time.time(), identifier))
            return result

    def query(self, params):
        if params.get("progressive") == "1" or params.get("cursor") or params.get("cancel"):
            return self.page(params)
        # Legacy finite-JSON clients still receive one response. The modern UI
        # uses progressive pages and can cancel or display initial-index progress.
        started, events, working, size, examined = time.monotonic(), [], dict(params), 0, 0
        while True:
            response = self.page(working)
            page_size = len(compact(response["events"]).encode("utf-8"))
            limited = size + page_size > 64 * 1024 * 1024
            if not limited:
                events.extend(response["events"])
                size += page_size
            metadata = response["timelineMatch"]
            examined += metadata.get("recordsExamined", 0)
            cursor = metadata.get("nextCursor")
            if not cursor or limited or time.monotonic()-started >= self.config.max_query_seconds:
                if cursor:
                    self.page({**working, "cursor": cursor, "cancel": "1"})
                    metadata.update(complete=False, error="The query is still indexing. Retry using progressive=1.", nextCursor=None)
                if limited:
                    metadata.update(complete=False, error="Finite response exceeds 64 MiB. Use progressive=1.", nextCursor=None)
                response["events"] = events
                metadata["progressive"] = False
                metadata.update(recordsReturned=len(events), recordsExamined=examined, recordsExcluded=examined-len(events))
                metadata["uniqueSessions"], metadata["uniqueEvents"] = counts(events)
                return response
            working["cursor"] = cursor
            if metadata.get("retryAfterMs"):
                time.sleep(metadata["retryAfterMs"]/1000)
