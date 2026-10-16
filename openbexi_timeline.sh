#!/usr/bin/env bash
set -euo pipefail

# Build first: mvn --batch-mode --no-transfer-progress verify
# Explicit arguments and environment configuration refer to the caller's directory.
ob_launch_cwd=$(pwd -P)
if [[ -n ${OPENBEXI_HBDS_CONFIG:-} && $OPENBEXI_HBDS_CONFIG != /* ]]; then
    export OPENBEXI_HBDS_CONFIG="$ob_launch_cwd/$OPENBEXI_HBDS_CONFIG"
fi
ob_launch_root=${OPENBEXI_TIMELINE_HOME:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)}
ob_launch_root=$(cd -- "$ob_launch_root" && pwd -P)
if [[ -n ${JDK_HOME:-} ]]; then
    ob_launch_java="$JDK_HOME/bin/java"
elif [[ -n ${JAVA_HOME:-} ]]; then
    ob_launch_java="$JAVA_HOME/bin/java"
else
    ob_launch_java=$(command -v java || true)
fi
if [[ -z $ob_launch_java || ! -x $ob_launch_java ]]; then
    printf '%s\n' 'Java not found. Set JAVA_HOME or JDK_HOME to a patched JDK 17 or newer.' >&2
    exit 1
fi
shopt -s nullglob
ob_launch_jars=("$ob_launch_root"/target/runtime/*.jar)
if [[ ! -f "$ob_launch_root/target/classes/com/openbexi/timeline/server/openbexi_timeline.class" || ${#ob_launch_jars[@]} -eq 0 ]]; then
    printf '%s\n' 'Build the application first: mvn --batch-mode --no-transfer-progress verify' >&2
    exit 1
fi
if [[ $# -eq 0 ]]; then
    ob_launch_config=${OPENBEXI_HBDS_CONFIG:-${OPENBEXI_TIMELINE_CONFIG:-${OPENBEXI_TIMELINE_DATA_PATH:-}}}
    if [[ -n $ob_launch_config ]]; then
        [[ $ob_launch_config = /* ]] || ob_launch_config="$ob_launch_cwd/$ob_launch_config"
        set -- -data_conf "$ob_launch_config"
    elif [[ -f "$ob_launch_root/HBDS/workspace.json" ]]; then
        set -- --workspace "$ob_launch_root/HBDS/workspace.json"
    else
        set -- -dataconf "$ob_launch_root/HBDS/yaml/DEMO_default.yml" -serverconf "$ob_launch_root/HBDS/service.yml" --hbds-root "$ob_launch_root/HBDS"
    fi
elif [[ $# -eq 2 && ( $1 == -data_conf || $1 == -data_path ) ]]; then
    ob_launch_config=$2
    [[ $ob_launch_config = /* ]] || ob_launch_config="$ob_launch_cwd/$ob_launch_config"
    set -- "$1" "$ob_launch_config"
fi
# The server resolves HBDS migration aliases before checking the selected file.
cd -- "$ob_launch_root"
mkdir -p tomcat
exec "$ob_launch_java" -cp "$ob_launch_root/target/classes:$ob_launch_root/target/runtime/*" \
    com.openbexi.timeline.server.openbexi_timeline "$@"
