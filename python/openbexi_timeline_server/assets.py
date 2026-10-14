"""The Java public-asset allowlist, with resolved-path containment checks."""
from pathlib import Path
from functools import lru_cache
import json

BROWSER = {"js", "mjs", "css", "json", "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "woff", "woff2", "ttf", "otf", "eot", "wasm"}


@lru_cache(maxsize=4)
def manifest_paths(filename, stamp):
    try:
        values = json.loads(Path(filename).read_text(encoding="utf-8"))
        return frozenset(item for item in values if isinstance(item, str)) if isinstance(values, list) else frozenset()
    except (OSError, ValueError):
        return frozenset()


def public_asset(root, requested):
    requested = requested or "demos.html"
    if requested.startswith("models/"):
        from .hbds import resolve_alias
        migrated = resolve_alias(requested, root)
        if migrated.is_relative_to(root / "HBDS/templates/models"):
            requested = migrated.relative_to(root).as_posix()
        elif (root / "HBDS").is_dir():
            return None
    parts = requested.split("/")
    if any(not part or part.startswith(".") or ":" in part or "\\" in part or any(ord(c) < 32 or ord(c) == 127 for c in part) for part in parts):
        return None
    suffix = parts[-1].rsplit(".", 1)[-1].lower()
    first = parts[0]
    allowed = len(parts) == 1 and (requested in ("README.md", "LICENSE") or suffix in {"html", "png", "jpg", "jpeg", "svg", "ico"})
    allowed |= first == "src" and (len(parts) == 2 and suffix in {"js", "mjs"} or requested.startswith("src/vendor/yaml/") and (suffix in {"js", "json"} or parts[-1] == "LICENSE"))
    allowed |= first in {"node_modules", "icon", "css"} and suffix in BROWSER
    allowed |= first == "demos" and (suffix == "json" or requested in {"demos/embedded-earth-orbit.html", "demos/embedded-earth-orbit.js"})
    allowed |= first in {"models", "help", "schemas"} and suffix == "json"
    if first == "HBDS":
        manifest = root / "release/public-files.json"
        public = manifest_paths(str(manifest), manifest.stat().st_mtime_ns) if manifest.is_file() else frozenset()
        allowed = requested in public and requested.startswith(("HBDS/schema/", "HBDS/templates/"))
    allowed |= first == "json" and len(parts) > 2 and parts[1] == "test-data" and suffix in {"json", "xml", "txt", "png"}
    allowed |= first in {"docs", "doc"} and suffix in {"html", "md", "txt", "png", "jpg", "jpeg", "svg", "pdf", "css", "js"}
    allowed |= first == "swagger" and suffix in {"json", "yaml", "yml", "html", "css", "js"}
    allowed |= requested in {"tests/timeline_views.html", "tests/timeline_views.test.js"}
    allowed |= requested == "docs/python-server-benchmark.json"
    path = root.joinpath(*parts)
    if first == "HBDS" and path.resolve() != root.resolve().joinpath(*parts):
        return None
    return path if allowed and path.is_file() and path.resolve().is_relative_to(root.resolve()) else None
