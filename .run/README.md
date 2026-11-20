# IntelliJ run configurations

Open the repository as a Python project and select its Python 3.12+ `.venv`
interpreter. Shared configurations use the project root and current HBDS workspaces.

| Configuration | Purpose |
| --- | --- |
| Timeline Python - Default / GEO | Serve committed samples / collected GEO data on `http://127.0.0.1:8783` |
| GEO_collector | Collect earthquake and volcano data with the dashboard on `http://127.0.0.1:8765` |
| GEO_collector_7_days | Collect the previous seven complete UTC days, then exit |
| GEO_collector_fill_gaps | Fill recorded missing days through today, then exit |
| Check - Python workspace | Validate the default workspace without opening a port |
| Help - Timeline Python | Print server options without loading data |
| Tests - Python | Run the Python server regression suite |

Start one Default or GEO server configuration per port. GEO requires collected
data in its configured targets; Default uses repository samples. To validate a
different workspace, change the Check configuration's `--workspace` argument.

The seven-day collector recalculates its dates on every launch. For example,
launching on November 14 UTC collects November 7 through November 13 inclusive.
It retains older output and reports progress in the console.

The gap-filling collector reads successful date coverage and unfinished requests
from the job history. It rechecks the last fully covered day, retries failed days,
and collects today through the latest available data. A current-day poll does not
mark the rest of that day complete. With no history, `--initial-days 7` sets the
initial lookback. Each source records coverage separately.

## Python and collector setup

Follow the [collector setup guide](../timeline_data_collector/README.md) to create
or reuse `.venv` and install its public plugins. Install the server into the same
environment from the project root:

```powershell
.venv/Scripts/python.exe -m pip install -r requirements.lock -e . -e timeline_data_collector
```

The launch files select `.venv/Scripts/python.exe`. If the registered interpreter
has a different SDK name, select it under **Run > Edit Configurations**. On
Linux/macOS, use `.venv/bin/python`. The server and public converters run entirely
in Python; no Java installation or plugin JAR build is required.

## Collector launch troubleshooting

Use `GEO_collector`, or create a local configuration for another workspace. Run
one collector per dashboard port, or add `--allow-workspace PATH` to collect
additional workspaces in one process. Use `--all-workspaces` only when all
neighboring workspaces are intended. Deployment-specific configurations and
credentials remain local.

If Run works but Debug leaves an empty console, check `idea.log` for
`Failed to launch Python DAP debug adapter` followed by `Connection refused`.
Under **Settings > Build, Execution, Deployment > Python Debugger**, select
**Mode: pydevd**, apply it and launch again. This setting is kept in the ignored
project settings and may need selecting again after recreating IDE settings.

INFO reports completed work and durations. DEBUG includes configuration loading,
source selection, output paths, UTC dates, checkpoints and scheduling. Slow DEBUG
steps report progress every ten seconds. Use
`--log-file .local-private/timeline-collector/collector.log` for a rotating local
copy. Restart a running process to load changed code.

The collector launchers run the `timeline_data_collector` module. Dashboard
arguments start with `serve`, conversions with `run`, and checks with `validate`.
Verify installation from the project root:

```powershell
.venv/Scripts/python.exe -m timeline_data_collector --help
.venv/Scripts/python.exe -m timeline_data_collector serve --help
.venv/Scripts/python.exe -m timeline_data_collector run --help
.venv/Scripts/python.exe -m timeline_data_collector validate --workspace HBDS/GEO_Workspace.json
```

A missing collector module or `jsonschema` dependency means the selected
interpreter needs the editable installation shown above. Install any private
converter packages and their dependencies into that same interpreter following
their local documentation. Help and configuration validation do not import every
converter dependency.
