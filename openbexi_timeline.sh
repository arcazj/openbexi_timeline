#!/usr/bin/env bash
set -euo pipefail
ob_launch_root=${OPENBEXI_TIMELINE_HOME:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)}
ob_launch_root=$(cd -- "$ob_launch_root" && pwd -P)
if [[ -n ${OPENBEXI_PYTHON:-} ]]; then
    ob_launch_python=$OPENBEXI_PYTHON
elif [[ -x "$ob_launch_root/.venv/bin/python" ]]; then
    ob_launch_python="$ob_launch_root/.venv/bin/python"
elif [[ -x "$ob_launch_root/.venv/Scripts/python.exe" ]]; then
    ob_launch_python="$ob_launch_root/.venv/Scripts/python.exe"
else
    ob_launch_python=$(command -v python3 || true)
fi
if [[ -z $ob_launch_python ]]; then
    printf '%s\n' 'Python 3.12+ is required. Install the project environment or set OPENBEXI_PYTHON.' >&2
    exit 1
fi
exec "$ob_launch_python" "$ob_launch_root/tools/launch-timeline.py" "$@"
