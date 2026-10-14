"""HBDS migration, access, concurrent saves, live queries and private-file boundaries."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from starlette.testclient import TestClient

from openbexi_timeline_server.app import create_app
from openbexi_timeline_server.config import load_configuration
from openbexi_timeline_server.hbds import HBDSError, LIMIT, Store, decode, legacy_configuration, resolve_alias, validate
from openbexi_timeline_server.index import TimelineIndex
from openbexi_timeline_server.query import Queries
from openbexi_timeline_server.storage import atomic_json

REPO = Path(__file__).resolve().parents[2]
ADMIN = "test-administrator-token-not-a-secret-12345"
PARAMS = {"startDate": "2026-09-12T00:00:00Z", "endDate": "2026-09-13T00:00:00Z", "scene": "0", "progressive": "0"}


def document():
    return {"schemaVersion": 1, "defaultNamespaceId": "ns-example",
            "namespaces": [{"id": "ns-example", "namespace": "EXAMPLE", "modelId": "model-example", "render": {}, "filter": {}, "connectorIds": []}],
            "models": [{"id": "model-example", "configuration": {"params": [{"name": "Example", "title": "Timeline"}], "bands": [{"name": "main"}]}}],
            "sources": [{"id": "source-example", "namespaceId": "ns-example", "order": 0, "configuration": {"type": "json_file", "enable": True, "data_model": "data/events.json"}}],
            "connectors": [], "tabs": [{"id": "tab-example", "namespaceId": "ns-example", "title": "Example", "order": 0, "enabled": True}],
            "users": [], "roles": [], "groups": [], "grants": [], "deployment": {}}


class HBDSTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.path = self.root / "HBDS/private/configurations/example.hbds.json"
        self.doc = document()
        atomic_json(self.path, self.doc)
        atomic_json(self.root / "data/events.json", {"events": [
            {"id": "a", "start": "2026-09-12T12:00:00Z", "data": {"title": "alpha", "status": "ACTIVE"}},
            {"id": "b", "start": "2026-09-12T12:00:00Z", "data": {"title": "beta", "status": "CLOSED"}}]})
        self.env = patch.dict("os.environ", {"OPENBEXI_API_TOKEN": ADMIN, "OPENBEXI_API_READ_TOKEN": "reader-test-token-12345678901234567890"})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def config(self):
        return load_configuration(self.path, root=self.root, state=self.root / "state")

    def client(self, prefix=""):
        conf = self.config()
        conf.context_path = prefix
        app = create_app(conf, start_indexer=False)
        app.state.index.refresh()
        return TestClient(app), app

    def headers(self, **values):
        return {"Authorization": "Bearer " + ADMIN, **values}

    def test_schema_and_relationship_contract(self):
        validate(self.doc, REPO)
        changes = [lambda d: d["namespaces"][0].update(modelId="missing"),
                   lambda d: d["tabs"][0].update(id="ns-example"),
                   lambda d: d["tabs"][0].update(enabled=False),
                   lambda d: d["sources"][0]["configuration"].update(namespace="duplicate"),
                   lambda d: d["deployment"].update(model="legacy"),
                   lambda d: d["models"][0]["configuration"].update(bands=[]),
                   lambda d: d["models"][0]["configuration"].update(rendering={"theme": {"sceneBackgroundImage": 7}}),
                   lambda d: d["models"][0]["configuration"].update(dataSource={"format": "bad"}),
                   lambda d: d["models"][0]["configuration"].update(constructor={}),
                   lambda d: d["tabs"].append({**d["tabs"][0], "id": "tab-other"}),
                   lambda d: d["sources"].append({**d["sources"][0], "id": "source-other"})]
        for i, mutate in enumerate(changes):
            invalid = deepcopy(self.doc)
            mutate(invalid)
            with self.subTest(case=i), self.assertRaises(ValueError):
                validate(invalid, REPO)

    def test_role_ceiling_and_duplicate_grants(self):
        self.doc.update(roles=[{"id": "role-admin", "name": "Admin", "ceiling": "admin"}],
                        groups=[{"id": "group-admin", "name": "Admins"}],
                        users=[{"id": "user-admin", "name": "Example", "email": "example@example.test", "admin": True, "roleId": "role-admin", "groupId": "group-admin"}],
                        grants=[{"id": "grant-admin", "groupId": "group-admin", "namespaceId": "ns-example", "permission": "denied"}])
        validate(self.doc, REPO)  # admin does not invalidate an explicit namespace denial
        self.doc["roles"][0]["ceiling"] = "rw"
        with self.assertRaises(ValueError):
            validate(self.doc, REPO)
        self.doc["roles"][0]["ceiling"] = "admin"
        self.doc["grants"].append({**self.doc["grants"][0], "id": "grant-duplicate"})
        with self.assertRaises(ValueError):
            validate(self.doc, REPO)

    def test_model_cross_field_rules_match_browser_and_java(self):
        base = json.loads((REPO / "HBDS/templates/default.hbds.json").read_text(encoding="utf-8"))
        validate(base, REPO)
        cases = [lambda m: m["bands"].append(deepcopy(m["bands"][0])),
                 lambda m: m["bands"][-1].update(sourceBands=["missing"]),
                 lambda m: m["bands"][0].update(range={"from": "2027-01-01", "to": "2026-01-01"}),
                 lambda m: m["bands"][0].update(ticks={"unit": "NUMERIC", "step": 1}),
                 lambda m: m["bands"][0].update(ticks={"unit": "MONTH", "step": 1.5}),
                 lambda m: m["bands"][0].update(ticks={"unit": "DAY", "step": 1}, tickMinutes=60),
                 lambda m: m["params"][0].update(date="invalid"),
                 lambda m: m.update(rendering={"activity": {"labelMinWidth": 400, "labelMaxWidth": 200}}),
                 lambda m: m.update(rendering={"table": {"columns": [{"field": "title", "label": "Title", "visible": False}]}})]
        for i, change in enumerate(cases):
            invalid = deepcopy(base)
            change(invalid["models"][0]["configuration"])
            with self.subTest(case=i), self.assertRaises(ValueError):
                validate(invalid, REPO)
        # All existing generic models, including numeric geological time and BCE dates,
        # remain accepted by the same runtime contract.
        for filename in (REPO / "HBDS/templates/models/demos").glob("*.json"):
            with self.subTest(model=filename.name):
                valid = deepcopy(base)
                valid["models"][0]["configuration"] = json.loads(filename.read_text(encoding="utf-8"))
                validate(valid, REPO)

    def test_band_context_and_focus_require_range_on_legacy_and_demo_models(self):
        generic = json.loads((REPO / "HBDS/templates/default.hbds.json").read_text(encoding="utf-8"))
        for base in (self.doc, generic):
            for key, extra in (("context", {}), ("focus", {"magnification": 2})):
                invalid = deepcopy(base)
                band = invalid["models"][0]["configuration"]["bands"][0]
                band.pop("range", None)
                band[key] = {"from": "2026-09-12", "to": "2026-09-13", **extra}
                with self.subTest(kind="demo" if base is generic else "legacy", field=key), self.assertRaises(ValueError):
                    validate(invalid, REPO)
    def test_duplicate_json_properties_rejected(self):
        for raw in (b'{"schemaVersion":1,"schemaVersion":2}', b'{"value":1e999}', b'{"value":NaN}', b'[' * 1100 + b']' * 1100):
            with self.subTest(raw=raw[:60]), self.assertRaises(ValueError):
                decode(raw)

    def test_namespace_defaults_merge_source_overrides(self):
        self.doc["namespaces"][0].update(render={"color": "red", "textColor": "white"}, filter={"include": "alpha", "exclude": "beta"}, connectorIds=["connector-rest"])
        self.doc["connectors"] = [{"id": "connector-rest", "protocol": "REST", "port": 8088}]
        self.doc["sources"][0]["configuration"].update(render={"color": "blue"}, filter={"include": "gamma"})
        source = legacy_configuration(self.doc)["data_sources"][0]
        self.assertEqual({"color": "blue", "textColor": "white"}, source["render"])
        self.assertEqual({"include": "gamma", "exclude": "beta"}, source["filter"])
        self.assertEqual("REST:8088", source["connector"])

    def test_migration_alias_precedes_existing_yaml_and_absolute_paths(self):
        old = self.root / "yaml/example.yml"
        old.parent.mkdir()
        old.write_text("model: stale.json\ndata_sources: []\n")
        atomic_json(self.root / "HBDS/private/migration.json", {"version": 1, "aliases": {"yaml/example.yml": "HBDS/private/configurations/example.hbds.json"}})
        for requested in (old, "yaml/example.yml"):
            conf = load_configuration(requested, root=self.root, state=self.root / "state")
            self.assertEqual(self.path, conf.hbds_path)
            self.assertIsNone(conf.model)
            self.assertEqual(1, len(conf.sources))

    def test_migration_alias_cannot_escape_hbds(self):
        atomic_json(self.root / "HBDS/aliases.json", {"version": 1, "aliases": {"yaml/escape.yml": "../secret.json"}})
        with self.assertRaises(ValueError):
            resolve_alias("yaml/escape.yml", self.root)

    def test_generic_template_is_promoted_and_local_edits_survive_restart(self):
        template = self.root / "HBDS/templates/default.hbds.json"
        atomic_json(template, self.doc)
        original = template.read_bytes()
        first = load_configuration(template, root=self.root)
        self.assertEqual(self.root / "HBDS/private/configurations/default.hbds.json", first.hbds_path)
        store = Store(first.hbds_path, self.root)
        edit, revision = store.read()
        edit["tabs"][0]["title"] = "My local title"
        store.save(edit, '"' + revision + '"')
        restarted = load_configuration(template, root=self.root)
        self.assertEqual("My local title", Store(restarted.hbds_path, self.root).read()[0]["tabs"][0]["title"])
        self.assertEqual(original, template.read_bytes())

    def test_admin_required_and_private_documents_never_static(self):
        client, _ = self.client("/timeline")
        with client:
            base = "/timeline"
            self.assertEqual(401, client.get(base + "/api/v1/hbds").status_code)
            self.assertEqual(403, client.get(base + "/api/v1/hbds", headers={"Authorization": "Bearer reader-test-token-12345678901234567890"}).status_code)
            self.assertEqual(200, client.get(base + "/api/v1/hbds/schema", headers=self.headers()).status_code)
            self.assertEqual(404, client.get(base + "/HBDS/private/configurations/example.hbds.json").status_code)
            startup = client.get(base + "/openbexi_timeline/config").json()
            self.assertEqual("EXAMPLE", startup["hbds"]["namespace"])
            self.assertEqual({"revision", "namespaceId", "namespace", "tabs", "modelConfiguration"}, set(startup["hbds"]))
            self.assertNotIn("data_model", json.dumps(startup))

    def test_static_hbds_requires_explicit_public_manifest(self):
        allowed = "HBDS/templates/models/public.json"
        unlisted = "HBDS/templates/models/local.json"
        atomic_json(self.root / allowed, {"public": True})
        atomic_json(self.root / unlisted, {"private": True})
        illustration = "HBDS/schema/example.png"
        (self.root / illustration).parent.mkdir()
        (self.root / illustration).write_bytes(b"public-diagram")
        # Even a mistakenly listed private file stays private.
        atomic_json(self.root / "release/public-files.json", [allowed, illustration, "HBDS/private/configurations/example.hbds.json"])
        client, _ = self.client()
        with client:
            self.assertEqual(200, client.get("/" + allowed).status_code)
            self.assertEqual(b"public-diagram", client.get("/" + illustration).content)
            self.assertEqual(404, client.get("/" + unlisted).status_code)
            self.assertEqual(404, client.get("/HBDS/private/configurations/example.hbds.json").status_code)

    def test_select_namespace_and_keep_tab_edits_out_of_data_refresh(self):
        self.doc["namespaces"].append({**self.doc["namespaces"][0], "id": "ns-second", "namespace": "SECOND"})
        self.doc["tabs"].append({"id": "tab-second", "namespaceId": "ns-second", "title": "Second", "order": 1, "enabled": True})
        atomic_json(self.path, self.doc)
        client, app = self.client()
        with client:
            selected = client.get("/openbexi_timeline/config?namespaceId=ns-second").json()["hbds"]
            self.assertEqual("SECOND", selected["namespace"])
            self.assertEqual(404, client.get("/openbexi_timeline/config?namespaceId=missing").status_code)
            initial = client.get("/api/v1/hbds", headers=self.headers())
            edit = initial.json()["document"]
            edit["tabs"][0]["title"] = "Renamed tab"
            edit["tabs"][0]["order"], edit["tabs"][1]["order"] = 1, 0
            saved = client.put("/api/v1/hbds", json=edit, headers=self.headers(**{"If-Match": initial.headers["etag"]}))
            self.assertEqual([], saved.json()["changedNamespaceIds"])
            self.assertEqual(["tab-second", "tab-example"], [tab["id"] for tab in client.get("/openbexi_timeline/config").json()["hbds"]["tabs"]])

    def test_approved_public_hbds_symlink_cannot_expose_private_configuration(self):
        public = "HBDS/templates/models/public.json"
        target = self.root / public
        target.parent.mkdir(parents=True)
        try:
            target.symlink_to(self.path)
        except (OSError, NotImplementedError):
            if os.name != "nt":
                self.skipTest("This account cannot create filesystem symbolic links.")
            # Windows permits directory junctions without the symlink privilege.
            target.parent.rmdir()
            made = subprocess.run(["cmd", "/c", "mklink", "/J", str(target.parent), str(self.path.parent)], capture_output=True)
            if made.returncode:
                self.skipTest("This account cannot create filesystem links or junctions.")
            public = "HBDS/templates/models/" + self.path.name
        atomic_json(self.root / "release/public-files.json", [public])
        client, _ = self.client()
        with client:
            self.assertEqual(404, client.get("/" + public).status_code)

    def test_legacy_model_urls_only_follow_public_aliases_in_hbds_workspace(self):
        public = "HBDS/templates/models/public.json"
        atomic_json(self.root / public, {"public": True})
        atomic_json(self.root / "models/private.json", {"private": True})
        atomic_json(self.root / "models/unlisted.json", {"private": True})
        atomic_json(self.root / "HBDS/aliases.json", {"version": 1, "aliases": {"models/public.json": public}})
        atomic_json(self.root / "HBDS/private/migration.json", {"version": 1, "aliases": {"models/private.json": "HBDS/private/configurations/example.hbds.json"}})
        atomic_json(self.root / "release/public-files.json", [public])
        client, _ = self.client()
        with client:
            self.assertEqual({"public": True}, client.get("/models/public.json").json())
            self.assertEqual(404, client.get("/models/private.json").status_code)
            self.assertEqual(404, client.get("/models/unlisted.json").status_code)

    def test_case_variant_urls_cannot_expose_hbds_or_legacy_private_files(self):
        atomic_json(self.root / "HBDS/private/migration.json", {"version": 1, "aliases": {"models/private.json": "HBDS/private/configurations/example.hbds.json"}})
        for name in ("models/private.json", "filters/private.json", "yaml/private.yml"):
            atomic_json(self.root / name, {"private": True})
        if os.name == "nt":
            self.assertTrue((self.root / "hBdS/pRiVaTe/mIgRaTiOn.JsOn").is_file())
            self.assertTrue((self.root / "mOdElS/pRiVaTe.JsOn").is_file())
        paths = ("/hBdS/pRiVaTe/mIgRaTiOn.JsOn", "/hbds/private/configurations/example.hbds.json",
                 "/HBDS/PRIVATE/CONFIGURATIONS/EXAMPLE.HBDS.JSON", "/models/PrIvAtE.json", "/MoDeLs/private.json",
                 "/mOdElS/pRiVaTe.JsOn", "/yAmL/PrIvAtE.YmL", "/fIlTeRs/PrIvAtE.JsOn")
        client, _ = self.client()
        with client:
            for path in paths:
                with self.subTest(path=path):
                    self.assertEqual(404, client.get(path).status_code)

    def test_revision_conflict_and_invalid_save_leave_original_bytes(self):
        client, _ = self.client()
        with client:
            initial = client.get("/api/v1/hbds", headers=self.headers())
            original = self.path.read_bytes()
            edit = initial.json()["document"]
            edit["tabs"][0]["title"] = "Edited"
            self.assertEqual(428, client.put("/api/v1/hbds", json=edit, headers=self.headers()).status_code)
            self.assertEqual(412, client.put("/api/v1/hbds", json=edit, headers=self.headers(**{"If-Match": '"wrong"'})).status_code)
            invalid = deepcopy(edit)
            invalid["models"][0]["configuration"]["bands"] = []
            self.assertEqual(422, client.put("/api/v1/hbds", json=invalid, headers=self.headers(**{"If-Match": initial.headers["etag"]})).status_code)
            self.assertEqual(original, self.path.read_bytes())
            saved = client.put("/api/v1/hbds", json=edit, headers=self.headers(**{"If-Match": initial.headers["etag"]}))
            self.assertEqual(200, saved.status_code, saved.text)
            self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), saved.json()["revision"])
            self.assertEqual([], saved.json()["changedNamespaceIds"])
            self.assertFalse(saved.json()["restartRequired"])
            self.assertEqual(412, client.put("/api/v1/hbds", json=edit, headers=self.headers(**{"If-Match": initial.headers["etag"]})).status_code)

    def test_two_stores_do_not_lose_concurrent_edits(self):
        first, second = Store(self.path, self.root), Store(self.path, self.root)
        original, revision = first.read()
        def write(store, title):
            edit = deepcopy(original)
            edit["tabs"][0]["title"] = title
            try:
                store.save(edit, '"' + revision + '"')
                return 200
            except HBDSError as error:
                return error.status
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(write, first, "One"), pool.submit(write, second, "Two")]
            self.assertEqual([200, 412], sorted(future.result() for future in futures))

    def test_model_and_expression_filter_apply_without_reindex(self):
        client, app = self.client()
        with client:
            before = app.state.index.status()
            self.assertEqual(2, len(client.get("/openbexi_timeline/sessions", params=PARAMS).json()["events"]))
            response = client.get("/api/v1/hbds", headers=self.headers())
            edit = response.json()["document"]
            edit["models"][0]["configuration"]["params"][0]["title"] = "Live model"
            edit["namespaces"][0]["filter"] = {"include": "expr: status = ACTIVE"}
            saved = client.put("/api/v1/hbds", json=edit, headers=self.headers(**{"If-Match": response.headers["etag"]}))
            self.assertEqual(200, saved.status_code, saved.text)
            self.assertFalse(saved.json()["restartRequired"])
            startup = client.get("/openbexi_timeline/config").json()
            self.assertEqual("Live model", startup["hbds"]["modelConfiguration"]["params"][0]["title"])
            self.assertEqual(["a"], [event["id"] for event in client.get("/openbexi_timeline/sessions", params=PARAMS).json()["events"]])
            self.assertEqual(before, app.state.index.status())

    def test_invalid_expression_is_rejected_before_save(self):
        client, _ = self.client()
        with client:
            response = client.get("/api/v1/hbds", headers=self.headers())
            edit = response.json()["document"]
            edit["namespaces"][0]["filter"] = {"include": "expr: status ="}
            original = self.path.read_bytes()
            saved = client.put("/api/v1/hbds", json=edit, headers=self.headers(**{"If-Match": response.headers["etag"]}))
            self.assertEqual(422, saved.status_code)
            self.assertEqual(original, self.path.read_bytes())

    def test_namespace_tabs_scope_indexed_records_and_cursor_pages(self):
        self.doc["namespaces"].append({**self.doc["namespaces"][0], "id": "ns-second", "namespace": "SECOND"})
        self.doc["sources"].append({"id": "source-second", "namespaceId": "ns-second", "order": 1,
                                    "configuration": {"type": "json_file", "enable": True, "data_model": "data/second.json"}})
        self.doc["deployment"] = {"timeline_server": {"page_size": 1}}
        atomic_json(self.path, self.doc)
        atomic_json(self.root / "data/second.json", {"events": [{"id": "c", "start": "2026-09-12T12:00:00Z"}]})
        client, _ = self.client()
        with client:
            second = client.get("/openbexi_timeline/sessions", params={**PARAMS, "namespace": "SECOND"}).json()
            self.assertEqual(["c"], [event["id"] for event in second["events"]])
            self.assertEqual(1, second["timelineMatch"]["recordsExamined"])
            first = client.get("/openbexi_timeline/sessions", params={**PARAMS, "namespace": "EXAMPLE", "progressive": "1"}).json()
            cursor = first["timelineMatch"]["nextCursor"]
            next_page = client.get("/openbexi_timeline/sessions", params={**PARAMS, "namespace": "EXAMPLE", "progressive": "1", "cursor": cursor}).json()
            self.assertEqual({"a", "b"}, {event["id"] for event in first["events"] + next_page["events"]})
            self.assertEqual([], client.get("/openbexi_timeline/sessions", params={**PARAMS, "namespace": "missing"}).json()["events"])

    def test_orphan_expression_validation_preserves_ingestion_globs(self):
        self.doc["sources"][0]["configuration"].update(type="local", filter={"include": "*.csv"})
        validate(self.doc, REPO)
        self.doc["namespaces"].append({**self.doc["namespaces"][0], "id": "ns-orphan", "namespace": "ORPHAN", "filter": {"include": "expr: status ="}})
        with self.assertRaises(ValueError):
            validate(self.doc, REPO)

    def test_restart_settings_reported_and_new_source_rebuilt_on_restart(self):
        client, _ = self.client()
        atomic_json(self.root / "data/next.json", {"events": [{"id": "c", "start": "2026-09-12T12:00:00Z"}]})
        with client:
            response = client.get("/api/v1/hbds", headers=self.headers())
            edit = response.json()["document"]
            edit["sources"][0]["configuration"]["data_model"] = "data/next.json"
            saved = client.put("/api/v1/hbds", json=edit, headers=self.headers(**{"If-Match": response.headers["etag"]}))
            self.assertTrue(saved.json()["restartRequired"], saved.text)
            self.assertTrue(client.get("/api/v1/hbds", headers=self.headers()).json()["restartRequired"])
            edit["tabs"][0]["title"] = "Still pending restart"
            again = client.put("/api/v1/hbds", json=edit, headers=self.headers(**{"If-Match": saved.headers["etag"]}))
            self.assertEqual(["sources"], again.json()["restartReasons"])
            self.assertEqual([], again.json()["changedNamespaceIds"])
            self.assertEqual(["a", "b"], [item["id"] for item in client.get("/openbexi_timeline/sessions", params=PARAMS).json()["events"]])
        index = TimelineIndex(self.config())
        index.refresh()
        self.assertEqual(["c"], [item["id"] for item in Queries(index).query(PARAMS)["events"]])

    def test_invalid_external_edit_keeps_last_valid_runtime(self):
        client, _ = self.client()
        with client:
            self.path.write_text('{"invalid":true}', encoding="utf-8")
            response = client.get("/openbexi_timeline/config")
            self.assertEqual(200, response.status_code)
            self.assertEqual("Timeline", response.json()["hbds"]["modelConfiguration"]["params"][0]["title"])
            self.assertEqual(2, len(client.get("/openbexi_timeline/sessions", params=PARAMS).json()["events"]))

    def test_missing_and_oversized_external_files_keep_last_valid_runtime(self):
        client, _ = self.client()
        with client:
            self.path.unlink()
            self.assertEqual("EXAMPLE", client.get("/openbexi_timeline/config").json()["hbds"]["namespace"])
            self.assertEqual(2, len(client.get("/openbexi_timeline/sessions", params=PARAMS).json()["events"]))
            self.path.write_bytes(b" " * (LIMIT + 1))
            self.assertEqual("Timeline", client.get("/openbexi_timeline/config").json()["hbds"]["modelConfiguration"]["params"][0]["title"])
            self.assertEqual(413, client.get("/api/v1/hbds", headers=self.headers()).status_code)

    def test_oversized_store_save_cannot_replace_last_valid_file(self):
        store = Store(self.path, self.root)
        edit, revision = store.read()
        edit["deployment"]["large-extension"] = "x" * LIMIT
        original = self.path.read_bytes()
        with self.assertRaises(HBDSError) as raised:
            store.save(edit, '"' + revision + '"')
        self.assertEqual(413, raised.exception.status)
        self.assertEqual(original, self.path.read_bytes())


if __name__ == "__main__":
    unittest.main()
