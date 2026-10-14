"""Shared HBDS configuration contract, revision checks and atomic private storage."""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import threading

from .storage import atomic_json
from .matching import compact

LIMIT = 2 * 1024 * 1024
REGISTRIES = ("namespaces", "models", "sources", "connectors", "tabs", "users", "roles", "groups", "grants")


class HBDSError(ValueError):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON property: " + key)
        result[key] = value
    return result


def decode(raw):
    if len(raw) > LIMIT:
        raise HBDSError(413, "HBDS configuration exceeds 2 MiB.")
    def finite(value):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("Non-finite JSON number.")
        return number
    try:
        result = json.loads(raw, object_pairs_hook=unique_object, parse_float=finite,
                            parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite JSON number.")))
        pending = [(result, 0)]
        while pending:
            value, depth = pending.pop()
            if depth > 80:
                raise ValueError("HBDS JSON exceeds its nesting limit.")
            if isinstance(value, (dict, list)):
                pending.extend((child, depth + 1) for child in (value.values() if isinstance(value, dict) else value))
        return result
    except RecursionError as error:
        raise ValueError("HBDS JSON exceeds its nesting limit.") from error


def read_bytes(path):
    with Path(path).open("rb") as handle:
        raw = handle.read(LIMIT + 1)
    if len(raw) > LIMIT:
        raise HBDSError(413, "HBDS configuration exceeds 2 MiB.")
    return raw


def resolve_alias(path, root):
    """Resolve migrations before existing legacy files; private JSON is authoritative."""
    root, path = Path(root).resolve(), Path(path)
    absolute = path if path.is_absolute() else root / path
    try:
        key = absolute.resolve().relative_to(root).as_posix()
    except ValueError:
        return absolute
    for manifest in (root / "HBDS/private/migration.json", root / "HBDS/aliases.json"):
        if manifest.is_file():
            aliases = decode(read_bytes(manifest)).get("aliases", {})
            destination = aliases.get(key)
            if destination:
                target = (root / destination).resolve()
                if not target.is_relative_to(root / "HBDS"):
                    raise ValueError("HBDS migration alias leaves the HBDS directory.")
                return target
    return absolute


def _schema(root, filename):
    path = Path(root) / filename
    if not path.is_file():
        path = Path(__file__).resolve().parents[2] / filename
    return decode(read_bytes(path))


def schema_validate(value, schema, document=None, location="configuration"):
    """Validate the vocabulary used by the checked-in schemas, without new dependencies."""
    document = schema if document is None else document
    if isinstance(schema, bool):
        if not schema:
            raise ValueError(location + " is not allowed.")
        return
    if "$ref" in schema:
        reference = schema["$ref"]
        if not reference.startswith("#/"):
            raise ValueError("Unsupported external schema reference.")
        resolved = document
        for part in reference[2:].split("/"):
            resolved = resolved[part.replace("~1", "/").replace("~0", "~")]
        return schema_validate(value, resolved, document, location)
    types = {"object": isinstance(value, dict), "array": isinstance(value, list), "string": isinstance(value, str),
             "boolean": isinstance(value, bool), "null": value is None,
             "integer": isinstance(value, (int, float)) and not isinstance(value, bool) and (isinstance(value, int) or value.is_integer()),
             "number": isinstance(value, (int, float)) and not isinstance(value, bool) and (isinstance(value, int) or math.isfinite(value))}
    expected = schema.get("type")
    if expected and not any(types.get(item, False) for item in (expected if isinstance(expected, list) else [expected])):
        raise ValueError(location + " has an invalid type.")
    def equal(item):
        numeric = types["number"] and isinstance(item, (int, float)) and not isinstance(item, bool)
        return (numeric or type(value) is type(item)) and value == item
    if "enum" in schema and not any(equal(item) for item in schema["enum"]):
        raise ValueError(location + " has an unsupported value.")
    if "const" in schema and not equal(schema["const"]):
        raise ValueError(location + " has an unsupported value.")
    for keyword in ("anyOf", "oneOf", "allOf"):
        if keyword in schema:
            valid = 0
            for alternative in schema[keyword]:
                try:
                    schema_validate(value, alternative, document, location)
                    valid += 1
                except ValueError:
                    pass
            if (keyword == "oneOf" and valid != 1) or (keyword == "anyOf" and valid == 0) or (keyword == "allOf" and valid != len(schema[keyword])):
                raise ValueError(location + " does not match the permitted structure.")
    if "if" in schema:
        branch = "then"
        try:
            schema_validate(value, schema["if"], document, location)
        except ValueError:
            branch = "else"
        schema_validate(value, schema.get(branch, True), document, location)
    if isinstance(value, dict):
        if any(key not in value for key in schema.get("required", [])):
            raise ValueError(location + " is missing required properties.")
        for key, dependency in schema.get("dependencies", {}).items():
            if key not in value:
                continue
            if isinstance(dependency, list):
                if any(required not in value for required in dependency):
                    raise ValueError(location + " is missing dependent properties.")
            else:
                schema_validate(value, dependency, document, location)
        properties = schema.get("properties", {})
        for key, child in value.items():
            applicable = properties.get(key, schema.get("additionalProperties", True))
            schema_validate(child, applicable, document, location + "." + key)
    elif isinstance(value, list):
        if len(value) < schema.get("minItems", 0) or len(value) > schema.get("maxItems", math.inf):
            raise ValueError(location + " has an invalid number of items.")
        if schema.get("uniqueItems") and len({json.dumps(item, sort_keys=True) for item in value}) != len(value):
            raise ValueError(location + " contains duplicate items.")
        for i, child in enumerate(value):
            schema_validate(child, schema.get("items", True), document, f"{location}[{i}]")
    elif isinstance(value, str):
        if len(value) < schema.get("minLength", 0) or len(value) > schema.get("maxLength", math.inf):
            raise ValueError(location + " has an invalid length.")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            raise ValueError(location + " has an invalid format.")
    elif types["number"]:
        if value < schema.get("minimum", -math.inf) or value > schema.get("maximum", math.inf):
            raise ValueError(location + " is outside the permitted range.")
        if value <= schema.get("exclusiveMinimum", -math.inf) or value >= schema.get("exclusiveMaximum", math.inf):
            raise ValueError(location + " is outside the permitted range.")


def validate(document, root):
    def safe(value, depth=0):
        if depth > 80:
            raise ValueError("HBDS nesting exceeds 80 levels.")
        if isinstance(value, dict):
            for key, child in value.items():
                if key in {"__proto__", "prototype", "constructor"}:
                    raise ValueError("Unsafe HBDS property.")
                safe(child, depth + 1)
        elif isinstance(value, list):
            for child in value:
                safe(child, depth + 1)
    safe(document)
    schema_validate(document, _schema(root, "HBDS/schema/configuration.schema.json"))
    registries, identities = {}, set()
    for name in REGISTRIES:
        items = document[name]
        registries[name] = {item["id"]: item for item in items}
        if len(registries[name]) != len(items) or identities.intersection(registries[name]):
            raise ValueError("Duplicate HBDS identity in " + name + ".")
        identities.update(registries[name])
    def reference(name, identity):
        if identity not in registries[name]:
            raise ValueError("Unknown HBDS reference in " + name + ".")
    reference("namespaces", document["defaultNamespaceId"])
    names, orders = set(), set()
    for namespace in document["namespaces"]:
        if namespace["namespace"] in names:
            raise ValueError("Duplicate namespace name.")
        names.add(namespace["namespace"])
        reference("models", namespace["modelId"])
        for connector in namespace["connectorIds"]:
            reference("connectors", connector)
    for source in document["sources"]:
        reference("namespaces", source["namespaceId"])
        if "namespace" in source["configuration"]:
            raise ValueError("Source namespace must come from namespaceId.")
        order = (source["namespaceId"], source["order"])
        if order in orders:
            raise ValueError("Source order must be unique within a namespace.")
        orders.add(order)
    orders.clear()
    for tab in document["tabs"]:
        reference("namespaces", tab["namespaceId"])
        if tab["order"] in orders:
            raise ValueError("Tab order must be unique.")
        orders.add(tab["order"])
    if not any(tab["enabled"] for tab in document["tabs"]):
        raise ValueError("At least one timeline tab must be enabled.")
    for user in document["users"]:
        reference("roles", user["roleId"])
        reference("groups", user["groupId"])
        if user["admin"] and registries["roles"][user["roleId"]]["ceiling"] != "admin":
            raise ValueError("Administrator users require an admin role ceiling.")
    seen = set()
    for grant in document["grants"]:
        reference("groups", grant["groupId"])
        reference("namespaces", grant["namespaceId"])
        pair = (grant["groupId"], grant["namespaceId"])
        if pair in seen:
            raise ValueError("Duplicate group/namespace grant.")
        seen.add(pair)
    if "model" in document["deployment"] or "data_sources" in document["deployment"]:
        raise ValueError("Models and sources belong in their HBDS collections.")
    for model in document["models"]:
        validate_model_semantics(model["configuration"])
    from .matching import compile_filter
    record_namespaces = {source["namespaceId"] for source in document["sources"] if source["configuration"].get("type", "json_file") == "json_file"}
    for namespace in document["namespaces"]:
        for key in ("include", "exclude"):
            rule = namespace["filter"].get(key)
            if isinstance(rule, str) and (rule.startswith("expr:") or namespace["id"] in record_namespaces):
                compile_filter(rule)
    for source in document["sources"]:
        config = source["configuration"]
        for key in ("include", "exclude"):
            rule = config.get("filter", {}).get(key)
            if isinstance(rule, str) and (rule.startswith("expr:") or config.get("type", "json_file") == "json_file"):
                compile_filter(rule)
    return document


def validate_model_semantics(model):
    """Cross-field rules shared with browser model validation and TimelineModels."""
    from .matching import MAX_TIME, civil_days, instant
    rendering = model.get("rendering", {})
    activity = rendering.get("activity", {})
    if activity.get("labelMinWidth", 80) > activity.get("labelMaxWidth", 360):
        raise ValueError("Model labelMinWidth must not exceed labelMaxWidth.")
    columns = rendering.get("table", {}).get("columns")
    if columns is not None and not any(column.get("visible", True) for column in columns):
        raise ValueError("Model table requires a visible column.")
    bands = model["bands"]
    names = {band["name"] for band in bands}
    if len(names) != len(bands):
        raise ValueError("Model band names must be unique.")
    if "dataSource" not in model:
        return  # The legacy schema deliberately permits legacy calendar strings/options.
    axis = model["dataSource"].get("time", {})
    numeric = axis.get("kind") == "numeric"

    def calendar(value):
        if isinstance(value, str):
            year = re.fullmatch(r"([+-]?\d{1,6})\s*(BC|BCE|AD|CE)?", value.strip(), flags=re.IGNORECASE)
            if year:
                number = int(year[1])
                number = 1 - number if (year[2] or "").upper().startswith("BC") else number
                return instant(civil_days(number, 1, 1) * 86400000)
        return instant(value)

    def time_value(value):
        if not numeric:
            return calendar(value)
        if isinstance(value, str) and not re.fullmatch(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?", value.strip(), flags=re.IGNORECASE):
            raise ValueError("Model numeric axis requires numeric values.")
        number = float(value) * axis["millisecondsPerUnit"] * axis.get("direction", 1)
        if not math.isfinite(number) or abs(number) > MAX_TIME:
            raise ValueError("Model time is outside the browser range.")
        return number

    def interval(value):
        if time_value(value["to"]) <= time_value(value["from"]):
            raise ValueError("Model range must follow its declared axis direction.")

    def tick_options(value):
        ticks = value.get("ticks")
        if ticks:
            if numeric != (ticks["unit"] == "NUMERIC"):
                raise ValueError("Model tick units must match its calendar or numeric axis.")
            if ticks["unit"] in ("MONTH", "YEAR", "DECADE", "CENTURY") and not float(ticks["step"]).is_integer():
                raise ValueError("Calendar month/year tick steps must be integers.")
        if "tickMinutes" in value and (numeric or ticks):
            raise ValueError("Model tickMinutes requires a calendar axis and cannot combine with ticks.")

    normal = {band["name"]: band for band in bands if "overview_" not in band["name"]}
    if not normal:
        raise ValueError("Model requires a normal band.")
    params = model["params"][0]
    time_value(params["date"])
    for band in bands:
        if isinstance(band["height"], str) and float(band["height"].removesuffix("%")) > 100:
            raise ValueError("Band height must not exceed 100 percent.")
        for key in ("range", "context"):
            if key in band:
                interval(band[key])
        tick_options(band)
        focus = band.get("focus", [])
        for region in focus if isinstance(focus, list) else [focus]:
            interval(region)
            tick_options(region)
        if "sourceBands" in band:
            if "overview_" not in band["name"]:
                raise ValueError("sourceBands is only supported on Overview bands.")
            for name in band["sourceBands"]:
                if name not in normal or normal[name].get("groupBy"):
                    raise ValueError("Overview sourceBands must reference existing normal, ungrouped bands.")
        if "secondaryScale" in band:
            if numeric:
                raise ValueError("Secondary elapsed-year scales require a calendar axis.")
            calendar(band["secondaryScale"]["origin"])
    if params.get("dockOverview") and "overview_" not in bands[-1]["name"]:
        raise ValueError("A docked Overview requires a trailing Overview band.")
    for zone in model["dataSource"].get("zones", []):
        if time_value(zone["end"]) <= time_value(zone["start"]):
            raise ValueError("Zone end must follow start in the declared axis direction.")


def legacy_configuration(document):
    namespaces = {item["id"]: item for item in document["namespaces"]}
    connectors = {item["id"]: item for item in document["connectors"]}
    result = deepcopy(document["deployment"])
    result["data_sources"] = []
    for source in sorted(document["sources"], key=lambda item: (item["order"], item["id"])):
        namespace = namespaces[source["namespaceId"]]
        entry = {**deepcopy(source["configuration"]), "namespace": namespace["namespace"],
                 "render": {**deepcopy(namespace["render"]), **deepcopy(source["configuration"].get("render", {}))},
                 "filter": {**deepcopy(namespace["filter"]), **deepcopy(source["configuration"].get("filter", {}))}}
        if "connector" not in entry and namespace["connectorIds"]:
            entry["connector"] = "|".join(str(connectors[key]["protocol"]) + ":" + str(connectors[key]["port"]) for key in namespace["connectorIds"])
        result["data_sources"].append(entry)
    return result


def projection(document, revision, namespace_id=None):
    selected = namespace_id or document["defaultNamespaceId"]
    namespace = next((item for item in document["namespaces"] if item["id"] == selected), None)
    if namespace is None:
        raise HBDSError(404, "HBDS namespace not found.")
    model = next(item for item in document["models"] if item["id"] == namespace["modelId"])
    return {"revision": revision, "namespaceId": selected, "namespace": namespace["namespace"],
            "tabs": deepcopy(sorted((item for item in document["tabs"] if item["enabled"]), key=lambda item: (item["order"], item["id"]))),
            "modelConfiguration": deepcopy(model["configuration"])}


def changes(before, after):
    affected = set()
    old_models = {item["id"]: item for item in before["models"]}
    new_models = {item["id"]: item for item in after["models"]}
    changed_models = {key for key in old_models.keys() | new_models.keys() if old_models.get(key) != new_models.get(key)}
    old = {item["id"]: item for item in before["namespaces"]}
    new = {item["id"]: item for item in after["namespaces"]}
    for key in old.keys() | new.keys():
        if old.get(key) != new.get(key) or (new.get(key) or old[key])["modelId"] in changed_models:
            affected.add(key)
    for registry in ("sources",):
        a, b = ({item["id"]: item for item in document[registry]} for document in (before, after))
        for key in a.keys() | b.keys():
            if a.get(key) != b.get(key):
                affected.update(item["namespaceId"] for item in (a.get(key), b.get(key)) if item)
    restart = []
    for field in ("sources", "connectors", "deployment"):
        if before[field] != after[field]:
            restart.append(field)
    if {item["id"]: (item["namespace"], item["connectorIds"]) for item in before["namespaces"]} != {item["id"]: (item["namespace"], item["connectorIds"]) for item in after["namespaces"]}:
        restart.append("namespaceBindings")
    # File-pattern filters change the inventory; expression filters can change query views.
    if any(old.get(key, {}).get("filter") != new.get(key, {}).get("filter") and
           any(isinstance(namespace.get("filter", {}).get(rule), list) for namespace in (old.get(key, {}), new.get(key, {})) for rule in ("include", "exclude"))
           for key in old.keys() | new.keys()):
        restart.append("namespaceFileFilters")
    return {"changedNamespaceIds": sorted(affected), "restartRequired": bool(restart), "restartReasons": restart}


class Store:
    def __init__(self, path, root):
        self.root = Path(root).resolve()
        path = Path(path).resolve()
        template = path if path.is_relative_to(self.root / "HBDS/templates") else None
        if template:
            path = self.root / "HBDS/private/configurations" / path.name
        self.path, self.lock = path, threading.RLock()
        self._cached = None
        self._stamp = None
        if template:
            with self.transaction():
                if not self.path.exists():
                    document = validate(decode(read_bytes(template)), self.root)
                    atomic_json(self.path, document)
        self.read()

    def read(self, *, copy_result=True):
        with self.lock:
            stat = self.path.stat()
            stamp = (stat.st_mtime_ns, stat.st_size)
            if stamp != self._stamp:
                raw = read_bytes(self.path)
                document = validate(decode(raw), self.root)
                self._cached = (document, hashlib.sha256(raw).hexdigest())
                self._stamp = stamp
            return deepcopy(self._cached) if copy_result else self._cached

    @contextmanager
    def transaction(self):
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.with_suffix(self.path.suffix + ".lock").open("a+b") as handle:
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    handle.seek(0)
                    if os.name == "nt":
                        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def save(self, document, expected):
        if not expected:
            raise HBDSError(428, "If-Match is required to save HBDS configuration.")
        validate(document, self.root)
        if len(compact(document).encode("utf-8")) > LIMIT:
            raise HBDSError(413, "HBDS configuration exceeds 2 MiB.")
        with self.transaction():
            # Always read file bytes inside the cross-process lock for conflict detection.
            self._stamp = None
            current, revision = self.read()
            if expected != '"' + revision + '"':
                raise HBDSError(412, "HBDS configuration changed. Reload before saving.")
            summary = changes(current, document)
            if current != document:
                atomic_json(self.path, document)
                self._stamp = None
            saved, revision = self.read()
            return {"document": saved, "revision": revision, **summary}
