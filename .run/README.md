# IntelliJ run configurations

Open the project through `pom.xml`. Use JDK 21 for the project SDK; Maven compiles
the server and plugins for Java 17. Shared configurations set the working
directory to the project root and use the current HBDS workspace files.

| Configuration | Purpose |
| --- | --- |
| Timeline Java - Default / GEO | Serve committed samples / collected data on `http://127.0.0.1:8080` |
| Timeline Python - Default / GEO | Serve the same workspaces on `http://127.0.0.1:8783` |
| Check - Java workspace / Python workspace | Validate the default workspace and exit without starting a listener |
| Help - Timeline Java / Timeline Python | Print server options (`--help`) and exit |
| Tests - Java | Run the project's JUnit tests; historical opt-in tests remain disabled |
| Browser - Timeline (Java) / Model editor (Java) / Demos | Debug a page served by the Java server on port 8080 |

Start one Default or GEO configuration per backend. Start Java before using its
browser configurations. GEO needs collected data in its configured target paths;
Default uses the samples already in the repository. Checks can run alongside a
server because they do not bind ports. Set a Check configuration's workspace
argument to validate a different workspace.

Select a **Help - ...** configuration and click **Run** to read usage in the Run
console. Help does not load a workspace, start a server, or generate data.

The former `openbexi_timeline*`, dated deployment-specific collectors, `event_generator*`,
old individual JUnit classes, and port-8442 browser entries are obsolete local
configurations. Remove them in **Run > Edit Configurations**; `.run` contains
their supported replacements. Private converters remain independent plugins.

## Python and collector setup on Windows

The Python server and collector share the repository-root Python 3.12+
environment. Follow the [collector setup guide](../timeline_data_collector/README.md)
to create or reuse `.venv` and install the core and plugins. Install the timeline
server into that same environment from the project root:

```powershell
.venv/Scripts/python.exe -m pip install -r requirements.lock
.venv/Scripts/python.exe -m pip install --no-deps -e .
```

The Python configurations select the registered project `.venv/Scripts/python.exe`
interpreter. IntelliJ also requires its SDK name to match the registered entry.
If yours has a different name, select your existing project interpreter in each
Python configuration under **Run > Edit Configurations**. Keep the Java module
on JDK 21; changing its module SDK to Python would break the Java launchers.
Collector entries read `JAVA_HOME` from the ignored local file
`.local-private/intellij.env`. Create it with your JDK location, for example:

```dotenv
JAVA_HOME=C:/Users/your-user/.jdks/openjdk-21.0.2
```

Also set `JAVA_HOME` to this JDK when running the collector from a shell.
Java converters need their separately built JARs;
building the timeline server alone does not build plugins.

On Linux/macOS, select the environment's `bin/python` interpreter instead of
`Scripts/python.exe` in your local run configuration.

## Collector launch troubleshooting

Create a local collector launch configuration for the desired workspace.
It includes scheduling and health recording. Run one collector per dashboard
port, or add `--allow-workspace PATH` to collect additional workspaces in the
same process. Use `--all-workspaces` only when all neighboring workspaces are intended.
Collector one-shot, generator, help, validation, monitor and
backfill launch configurations have been removed. Use the CLI commands below
for those utilities. Previous public launch files remain available in Git history.

INFO reports completed work and duration. Use DEBUG for configuration/plugin
loading, source selection, output paths, UTC dates, checkpoints and scheduling.
Slow DEBUG steps report progress every 10 seconds.
Use `--log-file .local-private/timeline-collector/collector.log` to retain a
rotating local copy, and `--log-level DEBUG` for detailed diagnostics.
Restart a running collector to load updated code.

Both launchers run the `timeline_data_collector` module through its
`__main__.py`, using `.venv/Scripts/python.exe`. Dashboard arguments start with `serve`, conversion
arguments with `run`, and checks with `validate`; each uses `--workspace`.

Verify the installation from the project root:

```powershell
.venv/Scripts/python.exe -m pip install -e timeline_data_collector
.venv/Scripts/python.exe -m timeline_data_collector --help
.venv/Scripts/python.exe -m timeline_data_collector serve --help
.venv/Scripts/python.exe -m timeline_data_collector run --help
.venv/Scripts/python.exe -m timeline_data_collector validate --workspace HBDS/GEO_Workspace.json
```

`No module named timeline_data_collector.__main__` means the collector has not
been installed in that interpreter; a missing `jsonschema` means its dependencies
are incomplete. The editable install above supplies both. For Java converter
launches, also create `.local-private/intellij.env` as described above.

For an operational workspace, install its private converter packages and their
dependencies in this same interpreter, following their local README files.
Help and configuration validation do not import every conversion dependency.
