"""Historical catalogs, wire filtering and UI-profile ownership use disposable files only."""
import json
from pathlib import Path
import tempfile
import unittest
from dataclasses import replace
from unittest.mock import patch
from starlette.testclient import TestClient
from openbexi_timeline_server.app import create_app
from openbexi_timeline_server.config import Configuration, Source
from openbexi_timeline_server.index import TimelineIndex
from openbexi_timeline_server.filter_catalog import FilterCatalog
from openbexi_timeline_server.storage import Storage, atomic_json


class FilterCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = self.root / "data"
        self.config = Configuration(self.root, self.root / "state", [Source(1, "DEMO_ALPHA", str(self.data / "yyyy/mm/dd"), self.data)], page_size=1)
        self.index = TimelineIndex(self.config)
        self.file = self.data / "2020/01/01/history.json"
        self.rows = [{"id": str(n), "start": "2020-01-01T12:00:00Z", "data": {"title": str(n), "system": "RNG" if n % 2 else "CMD", "serial": str(n), "Description": "<p>hidden</p>", "as_run": "hidden"}} for n in range(12)]
        self.policy = patch.dict("os.environ", {"OPENBEXI_FILTER_MAX_VALUES": "10", "OPENBEXI_FILTER_MIN_SAMPLES": "8", "OPENBEXI_FILTER_UNIQUE_RATIO": "0.9"})
        self.policy.start()
        atomic_json(self.file, {"events": self.rows})
        self.index.refresh()

    def tearDown(self):
        self.policy.stop()
        self.temp.cleanup()

    def choices(self):
        body = FilterCatalog(self.index).refresh()["filterCatalog"]["namespaces"][0]
        return body, {field["field"]: field["values"] for field in body["attributes"]}

    def test_catalog_covers_old_files_and_suppresses_unique_fields_and_hidden_aliases(self):
        body, choices = self.choices()
        self.assertEqual({"system": ["CMD", "RNG"]}, choices)
        self.assertEqual(["serial"], [field["field"] for field in body["excluded"]])
        self.assertTrue((self.root / "HBDS/filters/DEMO_ALPHA/catalog.python.json").is_file())
        with patch("openbexi_timeline_server.filter_catalog.collect", side_effect=AssertionError("Unchanged data must not be reread")):
            self.assertEqual(choices, self.choices()[1])
            restarted = FilterCatalog(TimelineIndex(self.config)).refresh()["filterCatalog"]["namespaces"][0]
            self.assertEqual(choices, {field["field"]: field["values"] for field in restarted["attributes"]})
            separate = TimelineIndex(replace(self.config, state=self.root / "independent-index"))
            warming = FilterCatalog(separate).refresh()["filterCatalog"]
            self.assertTrue(warming["indexing"])
            self.assertEqual(choices, {field["field"]: field["values"] for field in warming["namespaces"][0]["attributes"]})
            separate.refresh()
            self.assertEqual(choices, {field["field"]: field["values"] for field in FilterCatalog(separate).refresh()["filterCatalog"]["namespaces"][0]["attributes"]})
            scoped = TimelineIndex(replace(self.config, workspace_path=self.root / "HBDS/Other_Workspace.json"))
            self.assertEqual(choices, {field["field"]: field["values"] for field in FilterCatalog(scoped).refresh()["filterCatalog"]["namespaces"][0]["attributes"]})
            self.assertTrue((self.root / "HBDS/filters/DEMO_ALPHA/catalog.python.Other_Workspace.json").is_file())

    def test_incremental_new_modified_and_removed_files_update_values_with_types(self):
        added = self.data / "2025/01/01/new.json"
        atomic_json(added, {"events": [{"id": "new", "start": "2025-01-01T00:00:00Z", "data": {"system": "NEW", "flag": False, "priority": 3}}]})
        self.index.refresh()
        self.assertEqual(["CMD", "NEW", "RNG"], self.choices()[1]["system"])
        self.assertEqual([False], self.choices()[1]["flag"])
        self.assertEqual([3], self.choices()[1]["priority"])
        atomic_json(added, {"events": [{"id": "new", "start": "2025-01-01T00:00:00Z", "data": {"system": "CHANGED"}}]})
        self.index.refresh()
        self.assertEqual(["CHANGED", "CMD", "RNG"], self.choices()[1]["system"])
        added.unlink();self.index.refresh()
        self.assertEqual(["CMD", "RNG"], self.choices()[1]["system"])

    def test_rest_catalog_returns_no_records_and_filters_before_pagination(self):
        current = self.data / "2026/09/12/current.json"
        atomic_json(current, {"events": [
            {"id": "running", "start": "2026-09-12T12:00:00Z", "data": {"system": "RNG", "status": "RUNNING"}},
            {"id": "finished", "start": "2026-09-12T12:00:00Z", "data": {"system": "RNG", "status": "FINISHED"}},
            {"id": "cmd", "start": "2026-09-12T12:00:00Z", "data": {"system": "CMD", "status": "RUNNING"}}]})
        app = create_app(self.config, start_indexer=False);app.state.index.refresh()
        with TestClient(app) as client:
            response = client.get("/openbexi_timeline_sse/filter-values?startDate=2099-01-01&userName=guest")
            self.assertEqual(200, response.status_code);self.assertNotIn("events", response.json())
            choices = {item["field"]: item["values"] for item in response.json()["filterCatalog"]["namespaces"][0]["attributes"]}
            self.assertEqual(["CMD", "RNG"], choices["system"])
            params = {"startDate": "2026-09-12T00:00:00Z", "endDate": "2026-09-13T00:00:00Z", "namespaces": '["DEMO_ALPHA"]',
                      "filter": 'expr: system = "RNG" | status = "FINISHED"', "progressive": "1"}
            found = []
            for _ in range(30):
                page = client.get("/openbexi_timeline/sessions", params=params).json();found.extend(item["id"] for item in page["events"])
                cursor = page["timelineMatch"].get("nextCursor")
                if not cursor:break
                params["cursor"] = cursor
            self.assertEqual(["running"], found)
            params.pop("cursor", None);params["namespaces"] = "[]"
            self.assertEqual([], client.get("/openbexi_timeline/sessions", params=params).json()["events"])
            params["namespaces"] = '["DEMO_ALPHA"]';params["progressive"] = "0"
            with client.websocket_connect("/openbexi_timeline_ws/sessions") as socket:
                socket.send_json(params)
                self.assertEqual(["running"], [item["id"] for item in socket.receive_json()["events"]])
                socket.send_json({"namespaces": "[]"})
                self.assertEqual([], socket.receive_json()["events"])

    def test_ownership_guest_is_read_only_creators_own_new_filters_and_admin_sees_all(self):
        storage = Storage(self.index)
        legacy = {"namespace": "DEMO_ALPHA", "openbexi_timeline": [{"filters": [
            {"name": "ALL", "filter_value": "", "current": "yes", "sortBy": "NONE"},
            {"name": "NAMESPACE_Exclude_Nominal_RNG", "filter_value": "|system:RNG", "sortBy": "NONE"},
            {"name": "Existing", "filter_value": "expr: system = CMD", "sortBy": "system"}]}]}
        atomic_json(self.root / "HBDS/filters/default_filter_setting.json", legacy)
        base = {"userName": "guest", "timelineName": "timeline", "namespace": "DEMO_ALPHA"}
        guest = storage.filters(base)["openbexi_timeline"][0]
        self.assertEqual(["ALL", "NAMESPACE_Exclude_Nominal_RNG"], [item["name"] for item in guest["filters"]])
        self.assertTrue(all(not item["canEdit"] for item in guest["filters"]))
        for operation in ("addFilter", "saveFilter", "deleteFilter"):
            with self.assertRaises(PermissionError):storage.filters({**base, "ob_request": operation, "filterName": "ALL", "filter": ""})
        applied = storage.filters({**base, "ob_request": "updateFilter", "filterName": "NAMESPACE_Exclude_Nominal_RNG", "filter": "tampered"})
        self.assertEqual("|system:RNG", next(item for item in applied["openbexi_timeline"][0]["filters"] if item["current"] == "yes")["filter_value"])
        created = storage.filters({**base, "userName": "creator.demo", "ob_request": "addFilter", "filterName": "Copy", "filter": "expr: system = RNG"})
        self.assertEqual(["creator.demo"], created["openbexi_timeline"][0]["filters"][0]["owners"])
        other = Storage(TimelineIndex(replace(self.config, state=self.root / "other-state", workspace_path=self.root / "HBDS/Other.json")))
        migrated = other.filters({**base, "userName": "creator.demo"})["openbexi_timeline"][0]
        self.assertEqual(["creator.demo"], migrated["filters"][0]["owners"])
        admin = storage.filters({**base, "userName": "admin"})["openbexi_timeline"][0]
        self.assertEqual(4, len(admin["filters"]));self.assertTrue(all(item["canEdit"] for item in admin["filters"]))
        arcazj = storage.filters({**base, "userName": "arcazj"})["openbexi_timeline"][0]
        self.assertEqual({"ALL", "NAMESPACE_Exclude_Nominal_RNG", "Existing"}, {item["name"] for item in arcazj["filters"]})
        users = json.loads((self.root / "HBDS/users/index.json").read_text())
        references = next(user for user in users if user["id"] == "creator.demo")["filters"]
        self.assertEqual({None, "Other"}, {item.get("workspace") for item in references if item["name"] == "Copy"})
        self.assertEqual({"view"}, {item["access"] for user in users if user["id"] == "guest" for item in user["filters"]})
        self.assertEqual("all", next(user for user in users if user["id"] == "admin")["filterAccess"])
