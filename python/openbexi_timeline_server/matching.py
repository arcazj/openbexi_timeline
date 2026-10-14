"""Legacy and typed filtering, search annotations, and timeline date semantics."""
from __future__ import annotations

import copy
import datetime as dt
import email.utils
import hashlib
import json
import math
import re
import uuid

import regex

MIN_TIME = -8_640_000_000_000_000
MAX_TIME = -MIN_TIME
MISSING = object()


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(compact(value).encode()).hexdigest()


def civil_days(year, month, day):
    year -= month <= 2
    era = year // 400
    y = year - era * 400
    doy = (153 * (month + (-3 if month > 2 else 9)) + 2) // 5 + day - 1
    return era * 146097 + y * 365 + y // 4 - y // 100 + doy - 719468


def date_parts(milliseconds):
    days, rest = divmod(int(milliseconds), 86400000)
    z = days + 719468
    era, doe = divmod(z, 146097)
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    year = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    day = doy - (153 * mp + 2) // 5 + 1
    month = mp + (3 if mp < 10 else -9)
    year += month <= 2
    hour, rest = divmod(rest, 3600000)
    minute, rest = divmod(rest, 60000)
    second, milli = divmod(rest, 1000)
    return year, month, day, hour, minute, second, milli


def iso(milliseconds):
    year, month, day, hour, minute, second, milli = date_parts(milliseconds)
    y = f"{year:04d}" if 0 <= year <= 9999 else (f"+{year}" if year > 9999 else f"-{abs(year):04d}")
    fraction = f".{milli:03d}" if milli else ""
    return f"{y}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:{second:02d}{fraction}Z"


def instant(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(value) or not MIN_TIME <= value <= MAX_TIME:
            raise ValueError("Date is outside the supported range.")
        return int(value)
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Missing or invalid date.")
    match = re.fullmatch(r"([+-]?\d{4,6})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d)(?:\.(\d{1,9}))?)?(Z|[+-]\d\d:?\d\d)?)?", value.strip())
    if match:
        year, month, day = map(int, match.group(1, 2, 3))
        hour, minute, second = (int(v or 0) for v in match.group(4, 5, 6))
        days = civil_days(year, month, day)
        if date_parts(days * 86400000)[:3] != (year, month, day) or hour > 23 or minute > 59 or second > 59:
            raise ValueError("Invalid date.")
        result = days * 86400000 + hour * 3600000 + minute * 60000 + second * 1000 + int((match[7] or "0").ljust(3, "0")[:3])
        zone = match[8]
        if zone and zone != "Z":
            z = zone[1:].replace(":", "")
            zh, zm = int(z[:2]), int(z[2:])
            if zh > 23 or zm > 59:
                raise ValueError("Invalid UTC offset.")
            result -= (1 if zone[0] == "+" else -1) * (zh * 60 + zm) * 60000
        return instant(result)
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return instant(parsed.timestamp() * 1000)
    except (ValueError, TypeError, OverflowError) as error:
        raise ValueError("Invalid date; use ISO 8601 with a timezone.") from error


def namespace(record, inherited=""):
    data = record.get("data") if isinstance(record.get("data"), dict) else {}
    for value in (record.get("namespace"), data.get("namespace")):
        if value is not None and str(value).strip():
            return str(value)
    return inherited


def decode_filter(value):
    value = value or ""
    for before, after in {"_PIPE_": "|", "_PLUS_": "+", "_PERC_": "%", "_PARL_": "(", "_PARR_": ")"}.items():
        value = value.replace(before, after)
    return value


def pattern(value, flags=0):
    # Java's quoted literals are also used by some saved legacy searches.
    value = re.sub(r"\\Q(.*?)\\E", lambda m: regex.escape(m[1]), value, flags=re.S)
    try:
        compiled = regex.compile(value, flags)
    except regex.error as error:
        raise ValueError("Invalid regular expression.") from error

    def matches(text):
        try:
            return compiled.search(text, timeout=.02) is not None
        except TimeoutError as error:
            raise ValueError("Regular expression exceeded its processing limit; simplify it.") from error
    return matches


def field(record, path):
    parts = path.split(".")
    current = record if parts[0] in record else record.get("data", {})
    for part in parts:
        if not isinstance(current, dict) or part not in current:
            return MISSING
        current = current[part]
    return current


def equal(a, b):
    if a is MISSING:
        return False
    if isinstance(a, bool) != isinstance(b, bool):
        return False
    return a == b


def compare(a, op, b):
    if a is MISSING:
        return False
    if op in ("=", "==", "!="):
        return equal(a, b) if op != "!=" else not equal(a, b)
    if op in ("CONTAINS", "STARTS_WITH", "ENDS_WITH"):
        return isinstance(a, str) and isinstance(b, str) and {"CONTAINS": lambda: b in a,
            "STARTS_WITH": lambda: a.startswith(b), "ENDS_WITH": lambda: a.endswith(b)}[op]()
    numbers = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
    if not (isinstance(a, str) and isinstance(b, str) or numbers(a) and numbers(b)):
        return False
    return {">": lambda: a > b, ">=": lambda: a >= b, "<": lambda: a < b, "<=": lambda: a <= b}[op]()


class FilterParser:
    def __init__(self, text):
        self.tokens = []
        self.at = self.depth = 0
        i = 5
        while i < len(text):
            if text[i].isspace():
                i += 1
                continue
            start = i
            c = text[i]
            if c in "\"'":
                quote, value = c, ""
                i += 1
                while i < len(text) and text[i] != quote:
                    c = text[i]
                    i += 1
                    if c == "\\":
                        if i >= len(text) or text[i] not in "nrt\\\"'":
                            raise ValueError("Invalid escape in filter.")
                        c = {"n": "\n", "r": "\r", "t": "\t"}.get(text[i], text[i])
                        i += 1
                    value += c
                if i == len(text):
                    raise ValueError("Unclosed quoted filter value.")
                i += 1
                self.tokens.append((value, True))
            elif c in "(),":
                i += 1
                self.tokens.append((c, False))
            elif c in "=!<>":
                i += 1
                if i < len(text) and text[i] == "=":
                    i += 1
                self.tokens.append((text[start:i], False))
            else:
                while i < len(text) and not text[i].isspace() and text[i] not in "(),=!<>\"'":
                    i += 1
                self.tokens.append((text[start:i], False))
            if len(self.tokens) > 512:
                raise ValueError("Too many filter terms (maximum 512 tokens).")
        self.tokens.append(("", False))

    def take(self, text):
        value, quoted = self.tokens[self.at]
        if not quoted and value.upper() == text:
            self.at += 1
            return True
        return False

    def require(self, text):
        if not self.take(text):
            raise ValueError(f"Expected '{text}' in filter.")

    def parse(self):
        result = self.either()
        if self.tokens[self.at][0]:
            raise ValueError("Unexpected filter token.")
        return result

    def either(self):
        parts = [self.both()]
        while self.take("OR"):
            parts.append(self.both())
        return lambda record: any(p(record) for p in parts)

    def both(self):
        parts = [self.unary()]
        while self.take("AND"):
            parts.append(self.unary())
        return lambda record: all(p(record) for p in parts)

    def name(self):
        value, quoted = self.tokens[self.at]
        if quoted or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*", value):
            raise ValueError("Expected a filter field name.")
        self.at += 1
        return value

    def literal(self):
        value, quoted = self.tokens[self.at]
        if not quoted and (not value or value.upper() in (",", ")", "(", "AND", "OR", "NOT")):
            raise ValueError("Expected a filter value.")
        self.at += 1
        if quoted:
            return value
        if value.lower() in ("null", "true", "false"):
            return {"null": None, "true": True, "false": False}[value.lower()]
        if re.fullmatch(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?", value):
            number = float(value)
            if not math.isfinite(number):
                raise ValueError("Filter number must be finite.")
            return number
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", value):
            raise ValueError("Quote this filter value.")
        return value

    def unary(self):
        self.depth += 1
        if self.depth > 32:
            raise ValueError("Filter expressions may nest up to 32 levels.")
        try:
            if self.take("NOT"):
                predicate = self.unary()
                return lambda record: not predicate(record)
            if self.take("("):
                predicate = self.either()
                self.require(")")
                return predicate
            if self.take("EXISTS"):
                self.require("(")
                name = self.name()
                self.require(")")
                return lambda record: field(record, name) is not MISSING
            name = self.name()
            op = self.tokens[self.at][0].upper()
            self.at += 1
            if op == "IN":
                self.require("(")
                values = [self.literal()]
                while self.take(","):
                    values.append(self.literal())
                self.require(")")
                return lambda record: any(equal(field(record, name), v) for v in values)
            if op not in ("=", "==", "!=", ">", ">=", "<", "<=", "CONTAINS", "STARTS_WITH", "ENDS_WITH"):
                raise ValueError("Expected a filter comparison.")
            value = self.literal()
            return lambda record: compare(field(record, name), op, value)
        finally:
            self.depth -= 1


def compile_filter(value):
    text = decode_filter(value)
    if len(text) > 4096:
        raise ValueError("Filter exceeds 4096 characters.")
    if text.startswith("expr:"):
        return FilterParser(text).parse()
    if not text:
        return lambda record: True
    parts = text.split("|")

    def legacy(part):
        groups = [[(pattern(term), term) for term in group.split("+")] for group in part.split(";")] if part else []
        return lambda serialized: any(all(test(serialized) or term.startswith("description:") and term[12:] in serialized
                                         for test, term in group) for group in groups)
    include, exclude = legacy(parts[0]), legacy(parts[1] if len(parts) > 1 else "")

    def matches(record):
        serialized = compact({k: v for k, v in record.items() if k != "sourceRecordKey"}).replace('"', '')
        return (not parts[0] or include(serialized)) and not exclude(serialized)
    return matches


class Search:
    def __init__(self, query="", mode="legacy"):
        self.mode = mode or "legacy"
        if self.mode not in ("text", "pattern", "legacy"):
            raise ValueError("Unknown search mode.")
        query = (query or "").strip()
        if len(query) > 500:
            raise ValueError("Search is limited to 500 characters.")
        self.active = bool(query) and not (self.mode == "legacy" and query == "*")
        self.test = pattern(query.replace(";", "|").replace(" ", "|") if self.mode == "legacy" else
                            regex.escape(query) if self.mode == "text" else query,
                            0 if self.mode == "legacy" else regex.I) if self.active else lambda _: False

    def matches(self, record):
        if not self.active or record.get("zone") is True:
            return False
        if self.mode == "legacy":
            return self.test(compact({k: v for k, v in record.items() if k not in ("activities", "searchMatch", "sourceRecordKey")}).replace(" ", "").replace('"', ''))
        data = dict(record["data"]) if isinstance(record.get("data"), dict) else {}
        for key, value in record.items():
            if key not in ("data", "activities", "render", "start", "end", "id", "ID", "zone", "searchMatch", "deletedAt", "sourceRecordKey"):
                data.setdefault(key, value)
        data.setdefault("title", "Untitled")
        data.setdefault("description", str(data.get("text", "")))
        data["namespace"] = namespace(record)

        def visit(value):
            if isinstance(value, dict):
                return any(self.test(str(k)) or visit(v) for k, v in value.items() if k != "sourceRecordKey")
            if isinstance(value, list):
                return any(visit(v) for v in value)
            return value is not None and self.test(str(value).lower() if isinstance(value, bool) else str(value))
        return visit(data)


def prepare(record, inherited, warn, depth=0):
    """Validate and assign namespaces before full-session filtering; retain original dates."""
    try:
        if not isinstance(record, dict) or depth > 32:
            raise ValueError("Invalid nested record")
        start = instant(record.get("start"))
        raw_end = record.get("end")
        end = start if raw_end is None or isinstance(raw_end, str) and not raw_end.strip() else instant(raw_end)
        if end < start:
            raise ValueError("End precedes start")
        result = copy.deepcopy({k: v for k, v in record.items() if k not in ("activities", "sourceRecordKey")})
        result["namespace"] = namespace(record, inherited)
        if isinstance(raw_end, str) and not raw_end.strip():
            result.pop("end", None)
        if isinstance(record.get("activities"), list):
            result["activities"] = [item for child in record["activities"] if (item := prepare(child, result["namespace"], warn, depth + 1)) is not None]
        return result
    except (ValueError, TypeError, OverflowError, RecursionError):
        warn()
        return None


def annotate(record, search, lower, upper, key):
    result = dict(record)
    result["searchMatch"] = search.matches(record)
    result["sourceRecordKey"] = key
    result["start"] = iso(instant(record["start"]))
    if record.get("end") is not None:
        result["end"] = iso(instant(record["end"]))
    else:
        result.pop("end", None)
    if isinstance(record.get("activities"), list):
        result["activities"] = [annotate(child, search, lower, upper, key + "/" + str(i)) for i, child in enumerate(record["activities"])
                                if instant(child["start"]) <= upper and instant(child["start"] if child.get("end") is None else child["end"]) >= lower]
    return result


def source_key(path, ns, ordinal):
    raw = hashlib.md5((str(path) + ":" + ns).encode()).digest()
    return "source-" + str(uuid.UUID(bytes=raw, version=3)) + "-" + str(ordinal)


def has_match(record):
    return record.get("searchMatch") or any(has_match(child) for child in record.get("activities", []))


def counts(records):
    sessions = events = 0
    for record in records:
        if record.get("zone") is True:
            continue
        if isinstance(record.get("activities"), list) or isinstance(record.get("data"), dict) and record["data"].get("kind") == "session":
            sessions += 1
        else:
            events += 1
        child_sessions, child_events = counts(record.get("activities", []))
        sessions += child_sessions
        events += child_events
    return sessions, events
