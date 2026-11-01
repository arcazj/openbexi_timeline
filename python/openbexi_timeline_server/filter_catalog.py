"""Historical, incremental value catalogs. No event payload is returned to the UI."""
import json
import os
import re
import threading
import time

from .filter_repository import segment
from .matching import compact, compile_filter
from .storage import atomic_json, read_json

HIDDEN = {"description", "asrun", "start", "end", "id", "title", "namespace", "sourcerecordkey", "sortbyvalue", "analyze"}
LOCK = threading.RLock()


def limits():
    result = {"maxValues": int(os.environ.get("OPENBEXI_FILTER_MAX_VALUES", "1000")),
              "minSamples": int(os.environ.get("OPENBEXI_FILTER_MIN_SAMPLES", "200")),
              "uniqueRatio": float(os.environ.get("OPENBEXI_FILTER_UNIQUE_RATIO", "0.9"))}
    if result["maxValues"] < 2 or result["minSamples"] < 3 or not 0 < result["uniqueRatio"] <= 1:
        raise ValueError("Invalid filter catalog limits.")
    return result


def collect(records, policy):
    fields = {}
    def visit(data, prefix="", depth=0):
        if not isinstance(data, dict) or depth > 16:
            return
        for key, value in data.items():
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", key) or key.replace("_", "").replace("-", "").lower() in HIDDEN:
                continue
            field = prefix + key
            if isinstance(value, dict):
                visit(value, field + ".", depth + 1)
            elif value is None or isinstance(value, (str, int, float, bool)):
                summary = fields.setdefault(field, {"seen": 0, "values": {}, "overflow": False})
                summary["seen"] += 1
                token = compact(value)
                if len(token) > 1024:
                    summary["overflow"] = True
                elif token in summary["values"]:
                    summary["values"][token] += 1
                elif len(summary["values"]) < policy["maxValues"] + 1:
                    summary["values"][token] = 1
                else:
                    summary["overflow"] = True
    def record(item):
        if not isinstance(item, dict) or item.get("zone"):
            return
        visit(item.get("data", {}))
        for child in item.get("activities", []):
            record(child)
    for item in records:
        record(item)
    return fields


def project(files, policy):
    combined = {}
    for source in files.values():
        for field, part in source["attributes"].items():
            total = combined.setdefault(field, {"seen": 0, "values": {}, "overflow": False})
            total["seen"] += part["seen"]
            total["overflow"] |= part["overflow"]
            for value, count in part["values"].items():
                if value in total["values"] or len(total["values"]) <= policy["maxValues"]:
                    total["values"][value] = total["values"].get(value, 0) + count
                else:
                    total["overflow"] = True
    attributes, excluded = [], []
    for field, total in sorted(combined.items()):
        distinct = len(total["values"])
        unsuitable = total["overflow"] or distinct > policy["maxValues"] or total["seen"] >= policy["minSamples"] and distinct / total["seen"] >= policy["uniqueRatio"]
        if unsuitable:
            excluded.append({"field": field, "reason": "high_cardinality", "seen": total["seen"], "distinct": distinct})
        else:
            attributes.append({"field": field, "seen": total["seen"], "distinct": distinct, "values": [json.loads(value) for value in sorted(total["values"])]})
    return attributes, excluded


class FilterCatalog:
    def __init__(self, index):
        self.index = index
        self.root = (index.config.hbds_root or index.config.root / "HBDS") / "filters"

    def refresh(self):
        policy = limits()
        with LOCK, self.index.connect() as db:
            db.execute("BEGIN")  # Keep file versions and their payloads in one read snapshot.
            status = self.index.status()
            result = []
            for name in sorted({source.namespace for source in self.index.config.sources}):
                source_ids = [source.index for source in self.index.config.sources if source.namespace == name]
                suffix = "." + segment(self.index.config.workspace_path.stem) if self.index.config.workspace_path else ""
                path = self.root / segment(name) / ("catalog.python" + suffix + ".json")
                legacy = self.root / segment(name) / "catalog.python.json"
                stored = path if path.is_file() else legacy
                previous = read_json(stored, 64 * 1024 * 1024) if stored.is_file() else {}
                old = previous.get("files", {}) if previous.get("schemaVersion") == 2 and previous.get("limits") == policy and previous.get("signature") == self.index.config.signature else {}
                rows = db.execute("SELECT key,version,source,sha,stamp,warning FROM files WHERE source IN (" + ",".join("?" for _ in source_ids) + ")", source_ids).fetchall()
                files = {}
                for row in rows:
                    cached = old.get(row["key"])
                    fingerprint = (row["sha"] or row["stamp"]) + ":" + row["warning"]
                    if cached and cached["stamp"] == fingerprint:
                        files[row["key"]] = cached
                    else:
                        source = next(source for source in self.index.config.sources if source.index == row["source"])
                        include = compile_filter(source.include if isinstance(source.include, str) else "")
                        exclude = compile_filter(source.exclude) if isinstance(source.exclude, str) and source.exclude else lambda _: False
                        payloads = (json.loads(item[0]) for item in db.execute("SELECT payload FROM records WHERE file_key=? AND version=?", (row["key"], row["version"])))
                        records = (record for record in payloads if include(record) and not exclude(record))
                        files[row["key"]] = {"stamp": fingerprint, "attributes": collect(records, policy)}
                if status["indexing"]:
                    for key, summary in old.items():
                        files.setdefault(key, summary)
                attributes, excluded = project(files, policy)
                body = {"schemaVersion": 2, "namespace": name, "signature": self.index.config.signature, "limits": policy,
                        "files": files, "attributes": attributes, "excluded": excluded, "updatedAt": previous.get("updatedAt", time.time())}
                if not path.is_file() or previous.get("schemaVersion") != 2 or files != previous.get("files") or policy != previous.get("limits") or body["signature"] != previous.get("signature"):
                    body["updatedAt"] = time.time()
                    atomic_json(path, body)
                result.append({key: body[key] for key in ("namespace", "attributes", "excluded", "updatedAt")})
            warnings = [item.get("reason", "Some source files could not be cataloged.") for item in status.get("warnings", [])]
            if status.get("warningCount", 0) and not warnings:
                warnings = ["Some source files could not be cataloged; check source diagnostics."]
            return {"filterCatalog": {"version": 1, "indexing": status["indexing"], "namespaces": result, "limits": policy, "warnings": warnings}}
