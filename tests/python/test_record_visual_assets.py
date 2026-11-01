import tempfile
import unittest
from pathlib import Path

from openbexi_timeline_server.assets import public_asset


class RecordVisualAssetsTest(unittest.TestCase):
    def test_models_use_generic_public_asset_roots_without_opening_private_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("icon/survey/model.glb", "icon/survey/model.gltf", "icon/survey/geometry.bin",
                         "private/model.glb", "icon/.hidden/model.glb"):
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b"public" if name.startswith("icon/survey/") else b"private")
            for name in ("icon/survey/model.glb", "icon/survey/model.gltf", "icon/survey/geometry.bin"):
                self.assertEqual(public_asset(root, name), root / name)
            for name in ("private/model.glb", "icon/.hidden/model.glb", "icon/../private/model.glb"):
                self.assertIsNone(public_asset(root, name))
