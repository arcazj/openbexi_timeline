# IntelliJ run configurations

Open the project through `pom.xml`. Use JDK 21 for the project SDK; Maven compiles
the server and plugins for Java 17. Shared configurations set the working
directory to the project root and use the current HBDS workspace files.

| Configuration | Purpose |
| --- | --- |
| Timeline Java - Default / GEO | Serve committed samples / collected data on `http://127.0.0.1:8080` |
| Timeline Python - Default / GEO | Serve the same workspaces on `http://127.0.0.1:8783` |
| Collector - Demo / GEO | Open the collector dashboard on `http://127.0.0.1:8765`, with all three workspaces selectable |
| Collector - GEO once | Collect live earthquake and volcano data once with the saved checkpoints, then exit |
| Generator - Demo | Generate sessions and zones offline in `.local-private/events/DEMO_GENERATOR` |
| Check - Java workspace / Python workspace | Validate the default workspace and exit without starting a listener |
| Check - Collector plugins | Validate the GEO workspace and plugin configuration without ingestion |
| Help - Timeline Java / Timeline Python | Print server options (`--help`) and exit |
| Help - Collector | Print the collector command list (`--help`) and exit |
| Help - Collector server / Generator | Print dashboard (`serve --help`) / conversion (`run --help`) options and exit |
| Tests - Java | Run the project's JUnit tests; historical opt-in tests remain disabled |
| Browser - Timeline (Java) / Model editor (Java) / Demos | Debug a page served by the Java server on port 8080 |

Start one Default or GEO configuration per backend. Start Java before using its
browser configurations. GEO needs collected data in its configured target paths;
Default uses the samples already in the repository. Checks can run alongside a
server because they do not bind ports. Set a Check configuration's workspace
argument to validate a different workspace.

Select a **Help - ...** configuration and click **Run** to read usage in the Run
console. Help does not load a workspace, start a server, or generate data.

The former `openbexi_timeline*`, dated MCC/SOC, `data2json`, `event_generator*`,
old individual JUnit classes, and port-8442 browser entries are obsolete local
configurations. Remove them in **Run > Edit Configurations**; `.run` contains
their supported replacements. Private converters remain independent plugins.

## Python and collector setup on Windows

The Python server and collector share a Python 3.12+ environment. From the
project root, with a Python 3.12+ executable on PATH:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.lock
.venv/Scripts/python.exe -m pip install --no-deps -e .
.venv/Scripts/python.exe -m pip install -e timeline_data_collector
mvn --batch-mode --no-transfer-progress -f HBDS/plugins/default/pom.xml verify
mvn --batch-mode --no-transfer-progress -f HBDS/plugins/earthquake/pom.xml verify
mvn --batch-mode --no-transfer-progress -f HBDS/plugins/volcano/pom.xml verify
```

In **Project Structure > SDKs**, add the existing `.venv/Scripts/python.exe`
interpreter and name it **Timeline Python**. The Python configurations select
this SDK explicitly, so they do not change the Java module's SDK.
Collector and generator entries read `JAVA_HOME` from the ignored local file
`.local-private/intellij.env`. Create it with your JDK location, for example:

```dotenv
JAVA_HOME=C:/Users/your-user/.jdks/openjdk-21.0.2
```

Also set `JAVA_HOME` to this JDK when running the collector from a shell.
Java converters need their separately built JARs;
building the timeline server alone does not build plugins.

On Linux/macOS, select the environment's `bin/python` interpreter instead of
`Scripts/python.exe` in your local run configuration.
