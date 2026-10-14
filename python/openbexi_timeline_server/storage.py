"""Legacy saved filters, descriptor lookup and atomic event creation."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import tempfile
import uuid

from .matching import compact, compile_filter, date_parts, decode_filter, instant, namespace


def legacy_json(text):
    """Read bounded Java json-simple descriptors, including optional separators."""
    def invalid_constant(value):
        raise ValueError("Invalid JSON constant.")
    decoder = json.JSONDecoder(strict=False, parse_constant=invalid_constant)
    position = 0

    def whitespace():
        nonlocal position
        while position < len(text) and text[position] in " \t\r\n":
            position += 1

    def value(depth=0):
        nonlocal position
        whitespace()
        if position >= len(text) or depth > 128:
            raise ValueError("Truncated or excessively nested legacy JSON.")
        opening = text[position]
        if opening not in "{[":
            result, position = decoder.raw_decode(text, position)
            return result
        position += 1
        result = {} if opening == "{" else []
        closing = "}" if opening == "{" else "]"
        while True:
            whitespace()
            while position < len(text) and text[position] == ",":
                position += 1
                whitespace()
            if position >= len(text):
                raise ValueError("Truncated legacy JSON.")
            if text[position] == closing:
                position += 1
                return result
            if opening == "{":
                if text[position] != '"':
                    raise ValueError("Legacy JSON object keys must be strings.")
                key, position = decoder.raw_decode(text, position)
                whitespace()
                while position < len(text) and text[position] == ":":
                    position += 1
                    whitespace()
                result[key] = value(depth + 1)
            else:
                result.append(value(depth + 1))

    result = value()
    whitespace()
    if position != len(text):
        raise ValueError("Unexpected text after legacy JSON.")
    return result


def read_json(path, limit=8 * 1024 * 1024, *, legacy=False):
    with path.open("rb") as handle:
        raw = handle.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("Stored JSON exceeds its size limit.")
    if not legacy:
        return json.loads(raw)
    # Java json-simple also accepts omitted/repeated separators. Preserve the
    # original text values; only this bounded legacy descriptor reader is lenient.
    text = raw.decode("utf-8-sig")
    try:
        return json.loads(text, strict=False)
    except json.JSONDecodeError:
        return legacy_json(text)


def atomic_json(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".timeline-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(compact(body))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def partition(source, start):
    year, month, day = date_parts(instant(start))[:3]
    model = source.model.replace("\\", "/").removesuffix(".json")
    for name, value in (("yyyy", f"{year:04d}"), ("mm", f"{month:02d}"), ("dd", f"{day:02d}")):
        model = re.sub(r"/" + name + r"(?=/|$)", "/" + value, model)
    return Path(model)


class Storage:
    def __init__(self, index):
        self.index, self.config = index, index.config

    def profile(self, params):
        identities = [params.get("userName") or "guest", params.get("timelineName") or "timeline"]
        if any(not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value) for value in identities):
            raise ValueError("Invalid filter profile identity.")
        private = self.config.root / "HBDS/private/filters"
        directory = private if self.config.hbds_path or private.is_dir() else self.config.root / "filters"
        if not directory.resolve().is_relative_to(self.config.root):
            raise ValueError("Invalid filter storage path.")
        target = directory / ("_".join(identities) + "_filter_setting.json")
        read_path = target
        if not target.exists() and identities[0] == "guest":
            read_path = directory / "default_filter_setting.json"
            if not read_path.exists():
                template = self.config.root / "HBDS/templates/filters/default_filter_setting.json"
                if template.is_file() and template.resolve().is_relative_to(self.config.root.resolve() / "HBDS/templates/filters"):
                    # Read the generic default, but always save user edits privately.
                    return target, read_json(template, 2 * 1024 * 1024), identities
        if read_path.exists() and not read_path.resolve().is_relative_to(directory.resolve()):
            raise ValueError("Invalid filter storage path.")
        body = read_json(read_path, 2 * 1024 * 1024) if read_path.exists() else None
        if body is not None:
            try:
                timeline = body["openbexi_timeline"][0]
                assert isinstance(timeline["filters"], list)
                assert all(isinstance(item, dict) for item in timeline["filters"])
            except (TypeError, KeyError, IndexError, AssertionError) as error:
                raise ValueError("Saved filter settings are invalid.") from error
        return target, body, identities

    def resolve(self, params):
        if "filter" in params or not params.get("timelineName") or not params.get("userName"):
            return params
        _, body, _ = self.profile(params)
        if body:
            selected = next((item for item in body["openbexi_timeline"][0]["filters"] if item.get("current") == "yes"), None)
            if selected:
                params = {**params, "filter": decode_filter(selected.get("filter_value", "")), "filterName": selected.get("name", "")}
                params.setdefault("sortBy", selected.get("sortBy", "NONE"))
        return params

    def filters(self, params):
        operation = params.get("ob_request", "readFilters")
        expression = decode_filter(params.get("filter", ""))
        if operation not in ("readFilters", "deleteFilter"):
            compile_filter(expression)
        with self.index.connect() as db:
            db.execute("BEGIN IMMEDIATE")  # Cross-worker serialization of profile edits.
            path, body, identities = self.profile(params)
            if body is None:
                timeline = {key: params.get(key, "") for key in ("top", "left", "width", "height", "camera", "backgroundColor", "sortBy", "email")}
                timeline.update(name=identities[1], user=identities[0], start="current_time", title1=params.get("title", "Timeline"),
                                filters=[{"name": "ALL", "filter_value": "", "sortBy": "NONE", "current": "yes"}])
                body = {"dateTimeFormat": "iso8601", "scene": params.get("scene", "0"), "namespace": params.get("namespace", ""), "openbexi_timeline": [timeline]}
            timeline = body["openbexi_timeline"][0]
            timeline.update(sources=[source.public() for source in self.config.sources], multiples="45")
            if operation == "readFilters":
                return body
            name = params.get("filterName", "")
            if not name.strip() or len(name) > 512:
                raise ValueError("Enter a filter name of at most 512 characters.")
            filters = timeline["filters"]
            selected = next((item for item in filters if item.get("name") == name), None)
            if selected is not None:
                filters.remove(selected)
            if operation == "deleteFilter":
                selected = filters[0] if filters else None
            else:
                selected = {**(selected or {}), "name": name, "filter_value": expression, "sortBy": params.get("sortBy", "NONE"),
                            "backgroundColor": params.get("backgroundColor", "#eef1f2")}
                filters.insert(0, selected)
            for item in filters:
                item["current"] = "yes" if item is selected else "no"
            timeline["sortBy"] = selected.get("sortBy", "NONE") if selected else "NONE"
            atomic_json(path, body)
            return body

    def descriptor(self, params):
        identity = params.get("event_id", "")
        if not identity.strip() or identity in ("null", "undefined", ".", "..") or re.search(r"[\\/:\x00-\x1f\x7f]", identity):
            raise ValueError("Invalid descriptor identity or start date.")
        instant(params.get("start"))
        requested_namespace = params.get("namespace", "")
        sources = sorted(self.config.sources, key=lambda source: source.namespace != requested_namespace)
        seen = set()
        for source in sources:
            path = partition(source, params["start"]) / "descriptors" / (identity + ".json")
            if path in seen or not path.exists():
                continue
            seen.add(path)
            if not path.resolve().is_relative_to(path.parent.resolve()):
                raise ValueError("Invalid descriptor path.")
            try:
                body = read_json(path, legacy=True)
            except ValueError as error:
                raise OSError("Cannot parse descriptor data.") from error
            if not isinstance(body, dict) or not isinstance(body.get("event_descriptor"), list):
                raise OSError("Invalid descriptor data.")
            selected = []
            for item in body["event_descriptor"]:
                if not isinstance(item, dict):
                    raise OSError("Invalid descriptor data.")
                if str(item.get("id", item.get("ID", identity))) == identity and (not requested_namespace or namespace(item, source.namespace) == requested_namespace):
                    selected.append(item)
            if selected:
                return {**body, "event_descriptor": selected}, 200
        return {"event_descriptor": [], "descriptorStatus": "not_found"}, 404

    def add_event(self, params):
        start, end = params.get("startEvent"), params.get("endEvent")
        if instant(end) < instant(start):
            raise ValueError("Event end precedes start.")
        if not self.config.sources:
            raise ValueError("No writable JSON source is configured.")
        targets = set()
        for source in self.config.sources:
            directory = partition(source, start)
            if directory in targets:
                continue
            targets.add(directory)
            if source.root.suffix == ".json":
                raise ValueError("Adding events requires a directory source.")
            if not directory.resolve().is_relative_to(source.root.resolve()):
                raise ValueError("Invalid event destination.")
            identity = str(uuid.uuid4())
            event = {"id": identity, "start": start, "end": end,
                     "data": {"namespace": source.namespace, "title": params.get("title", ""), "description": params.get("description", "")},
                     "render": {"color": "#050100"}}
            if params.get("icon") and "#" not in params["icon"]:
                event["render"]["image"] = params["icon"]
            atomic_json(directory / (identity + ".json"), {"dateTimeFormat": "iso8601", "scene": params.get("scene", "0"), "events": [event]})
        self.index.refresh()
