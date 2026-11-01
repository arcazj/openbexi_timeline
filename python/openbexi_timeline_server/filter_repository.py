"""Local, namespace-owned filter definitions; the selected UI username is the identity."""
from copy import deepcopy
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import re
import threading
import time

from .storage import atomic_json, read_json

LOCK = threading.RLock()
GUEST_FILTERS = {"ALL", "NAMESPACE_Exclude_Nominal_RNG"}


@contextmanager
def repository_lock(root):
    """The one-byte OS lock also serializes Java writers sharing this metadata root."""
    root.mkdir(parents=True, exist_ok=True)
    with LOCK, (root / ".filter-ownership.lock").open("a+b") as handle:
        if handle.tell() == 0:
            handle.write(b"0");handle.flush()
        deadline = time.monotonic() + 15
        while True:
            try:
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.lockf(handle, fcntl.LOCK_EX | fcntl.LOCK_NB, 1)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("Filter ownership storage is busy; retry the request.")
                time.sleep(.05)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.lockf(handle, fcntl.LOCK_UN, 1)


def segment(value):
    return value if re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value) else "ns_" + hashlib.sha256(value.encode()).hexdigest()[:24]


class FilterRepository:
    def __init__(self, config):
        self.config = config
        self.root = (config.hbds_root or config.root / "HBDS").resolve()

    def users(self):
        folder = self.root / "users"
        records = {}
        for filename in ("defaults.json", "index.json"):
            path = folder / filename
            for user in read_json(path) if path.is_file() else []:
                if isinstance(user, dict) and user.get("id"):
                    records[user["id"]] = {**records.get(user["id"], {}), **user}
        for name in ("admin", "guest", "arcazj"):
            records.setdefault(name, {"id": name, "name": name, "admin": name == "admin"})
        guest = records["guest"]
        for user in records.values():
            user.setdefault("email", user["id"] + "@example.invalid")
            user.setdefault("roleId", "role_admin" if user.get("admin") else guest.get("roleId", "role_guest"))
            user.setdefault("groupId", "group_admin" if user.get("admin") else guest.get("groupId", "group_guest"))
        return records

    def scope(self, params):
        selected = params.get("namespace", "")
        names = {source.namespace for source in self.config.sources}
        return selected if selected and selected != "0" else next(iter(names)) if len(names) == 1 else "_all"

    def definitions(self, scope):
        suffix = "." + segment(self.config.workspace_path.stem) if self.config.workspace_path else ""
        return self.root / "filters" / segment(scope) / ("definitions" + suffix + ".json")

    def load(self, scope, legacy):
        path = self.definitions(scope)
        previous = read_json(path) if path.is_file() else None
        if previous and previous.get("legacyMigrationCompleted"):
            return path, previous
        definitions = {item["name"]: item for item in previous.get("filters", [])} if previous else {}
        # Prefer the existing arcazj definitions; preserve every original profile on disk.
        profiles = sorted((self.root / "filters").rglob("*_filter_setting.json"), key=lambda p: (not p.name.startswith("arcazj_"), str(p)))
        if legacy:
            profiles.insert(0, None)
        for profile in profiles:
            if profile is not None and "workspaces" in profile.parts and self.config.workspace_path and self.config.workspace_path.stem not in profile.parts:
                continue
            body = legacy if profile is None else read_json(profile)
            timeline = body.get("openbexi_timeline", [{}])[0]
            names = {source.get("namespace") for source in timeline.get("sources", []) if isinstance(source, dict)}
            if names and not names.intersection(source.namespace for source in self.config.sources):
                continue
            if scope != "_all" and names and scope not in names:
                continue
            for original in timeline.get("filters", []):
                if not original.get("name") or original["name"] in definitions:
                    continue
                item = deepcopy(original)
                item.pop("canEdit", None)
                item.setdefault("owners", ["arcazj"] + (["guest"] if item["name"] in GUEST_FILTERS else []))
                item["namespace"] = scope
                definitions[item["name"]] = item
        definitions.setdefault("ALL", {"name": "ALL", "filter_value": "", "sortBy": "NONE", "owners": ["arcazj", "guest"], "namespace": scope})
        body = {"schemaVersion": 1, "legacyMigrationCompleted": True, "namespace": scope, "filters": list(definitions.values())}
        atomic_json(path, body)
        self.register(scope, body["filters"])
        return path, body

    def register(self, scope, filters, actor=None):
        users = self.users()
        workspace = self.config.workspace_path.stem if self.config.workspace_path else None
        if actor:
            guest = users["guest"]
            users.setdefault(actor, {"id": actor, "name": actor, "admin": False, "email": actor + "@example.invalid", "roleId": guest["roleId"], "groupId": guest["groupId"]})
        for user in users.values():
            user["filters"] = [item for item in user.get("filters", []) if not (item.get("namespace") == scope and item.get("workspace") == workspace)]
            for item in filters:
                if user["id"] in item.get("owners", []) and (user["id"] != "guest" or item["name"] in GUEST_FILTERS):
                    reference = {"namespace": scope, "name": item["name"], "access": "view" if user["id"] == "guest" else "owner"}
                    if workspace:
                        reference["workspace"] = workspace
                    user["filters"].append(reference)
            if user.get("admin"):
                user["filterAccess"] = "all"
        path = self.root / "users" / "index.json"
        records = list(users.values())
        if not path.is_file() or read_json(path) != records:
            atomic_json(path, records)

    def apply(self, params, legacy, operation):
        actor = (params.get("userName") or "guest").lower()
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,95}", actor):
            raise ValueError("Invalid filter user.")
        scope = self.scope(params)
        path, body = self.load(scope, legacy)
        admin = bool(self.users().get(actor, {}).get("admin"))
        visible = lambda item: admin or actor in item.get("owners", []) and (actor != "guest" or item["name"] in GUEST_FILTERS)
        editable = lambda item: actor != "guest" and (admin or actor in item.get("owners", []))
        items = body["filters"]
        name = params.get("filterName", "")
        selected = next((item for item in items if item["name"] == name and visible(item)), None)
        if operation == "updateFilter" and selected is None:
            raise PermissionError("This filter is unavailable for the selected user.")
        if operation in {"addFilter", "saveFilter", "deleteFilter"}:
            if actor == "guest" or selected and not editable(selected):
                raise PermissionError("The selected user may view and apply this filter only.")
            if any(item["name"].lower() == name.lower() for item in items) and selected is None:
                raise PermissionError("A filter with this name already exists.")
            if operation == "addFilter" and selected is not None:
                raise ValueError("A filter with this name already exists.")
            if operation == "deleteFilter":
                if selected is None:
                    raise ValueError("Filter not found.")
                items.remove(selected)
                selected = None
            else:
                if not name.strip() or len(name) > 512:
                    raise ValueError("Enter a filter name of at most 512 characters.")
                if selected is None:
                    selected = {"name": name, "namespace": scope, "owners": [actor] + (["guest"] if name in GUEST_FILTERS else [])}
                    items.append(selected)
                selected.update(filter_value=params.get("filter", ""), sortBy=params.get("sortBy", "NONE"), backgroundColor=params.get("backgroundColor", "#eef1f2"))
            atomic_json(path, body)
        self.register(scope, items, actor)
        previous = next((item["name"] for item in legacy.get("openbexi_timeline", [{}])[0].get("filters", []) if item.get("current") == "yes"), "ALL")
        active = selected["name"] if selected else previous
        result = []
        for original in items:
            if visible(original):
                item = deepcopy(original)
                item.update(canEdit=editable(item), current="yes" if item["name"] == active else "no")
                result.append(item)
        if not any(item["current"] == "yes" for item in result) and result:
            result[0]["current"] = "yes"
        return result, {"user": actor, "canCreate": actor != "guest", "admin": admin, "identityMode": "ui"}
