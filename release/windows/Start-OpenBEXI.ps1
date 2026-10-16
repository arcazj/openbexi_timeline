param(
    [ValidateRange(1024, 65535)][int]$Port = 8781,
    [string]$DataDirectory = (Join-Path $env:LOCALAPPDATA 'OpenBEXI Timeline\data'),
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$appRoot = Join-Path $PSScriptRoot 'app'
$runtime = Join-Path $PSScriptRoot 'runtime\bin\java.exe'
$runtimeService = $null
New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
$DataDirectory = (Resolve-Path -LiteralPath $DataDirectory).Path
$hbdsDirectory = Join-Path $DataDirectory 'HBDS'
New-Item -ItemType Directory -Force -Path $hbdsDirectory | Out-Null
$hbdsConfiguration = Join-Path $hbdsDirectory 'openbexi_timeline.hbds.json'
$namespaceConfiguration = Join-Path $hbdsDirectory 'yaml/DEMO_default.yml'
$legacyWorkspace = (Test-Path -LiteralPath $hbdsConfiguration) -and !(Test-Path -LiteralPath $namespaceConfiguration)
$javaArgs = @(
    "-Dopenbexi.api.port=$Port",
    "`"-Dopenbexi.api.root=$appRoot`"",
    "`"-Dopenbexi.api.dataDir=$DataDirectory`"",
    '-cp', "`"$appRoot\lib\*`""
)
if ($legacyWorkspace) {
    # Keep existing desktop workspaces readable until explicitly migrated.
    $javaArgs = @("`"-Dopenbexi.hbds.config=$hbdsConfiguration`"") + $javaArgs + @('com.openbexi.timeline.api.ApiServer')
} else {
    foreach ($directory in @('yaml','models','filters','users','groups','roles')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $hbdsDirectory $directory) | Out-Null
    }
    $modelFile = Join-Path $hbdsDirectory 'models/default.json'
    if (!(Test-Path -LiteralPath $modelFile)) { Copy-Item -LiteralPath (Join-Path $appRoot 'HBDS/models/default.json') -Destination $modelFile }
    if (!(Test-Path -LiteralPath $namespaceConfiguration)) {
        $targetPath = (Join-Path $DataDirectory 'events/DEMO/yyyy/mm/dd').Replace('\','/') | ConvertTo-Json -Compress
        $sourcePath = (Join-Path $DataDirectory 'input/DEMO').Replace('\','/') | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($namespaceConfiguration, @"
config_version: 3
namespace: DEMO
model: models/default.json
target_path: $targetPath
connectors: [desktop]
sources:
  - id: input
    source_path: $sourcePath
    source_plugin: local
    converter_plugin: timeline_json
"@)
    }
    $desktopService = Join-Path $hbdsDirectory 'service.desktop.yml'
    if (!(Test-Path -LiteralPath $desktopService)) { [IO.File]::WriteAllText($desktopService, @"
config_version: 3
plugins:
  roots: []
state_root: ../collector-state
collector_ui:
  host: 127.0.0.1
  port: 8765
connectors:
  - id: desktop
    owner: java
    type: http
    host: 127.0.0.1
    port: $Port
"@) }
    $desktopWorkspace = Join-Path $hbdsDirectory 'workspace.json'
    if (!(Test-Path -LiteralPath $desktopWorkspace)) {
        $selection = @{schemaVersion=1; name='Demo_Workspace'; service='service.desktop.yml'; namespace_files=@('yaml/DEMO_default.yml')}
        [IO.File]::WriteAllText($desktopWorkspace, ($selection | ConvertTo-Json -Depth 4))
    }
    # Keep the workspace's selected service and plugin/state settings intact.
    # An explicit launch port applies to an ephemeral copy of that service.
    $runtimeService = Join-Path $hbdsDirectory ('.desktop-service-' + [guid]::NewGuid().ToString('N') + '.yml')
    $requestedPort = if ($PSBoundParameters.ContainsKey('Port')) { $Port } else { 0 }
    $prepareService = @'
import json, pathlib, sys, yaml
workspace, destination, requested = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), int(sys.argv[3])
selection = json.loads(workspace.read_text(encoding='utf-8-sig'))
source = workspace.parent / selection.get('service', 'service.desktop.yml')
service = yaml.safe_load(source.read_text(encoding='utf-8-sig'))
listener = next(item for item in service['connectors'] if item['id'] == 'desktop' and item['owner'] == 'java')
if requested: listener['port'] = requested
destination.write_text(yaml.safe_dump(service, sort_keys=False), encoding='utf-8')
print(listener['port'])
'@
    $effectivePort = $prepareService | & (Join-Path $PSScriptRoot 'python/python.exe') - $desktopWorkspace $runtimeService $requestedPort
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the selected desktop service.' }
    $Port = [int]$effectivePort
    $javaArgs[0] = "-Dopenbexi.api.port=$Port"
    $javaArgs += @('com.openbexi.timeline.server.openbexi_timeline', '--workspace', "`"$desktopWorkspace`"", '-serverconf', "`"$runtimeService`"", '--hbds-root', "`"$hbdsDirectory`"", '--root', "`"$appRoot`"")
}
# Never attach to another process merely because it owns the selected port.
$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $probe.Start() } catch { throw "Port $Port is already in use. Close the other instance or launch with -Port <number>." }
finally { $probe.Stop() }
$server = Start-Process -FilePath $runtime -ArgumentList $javaArgs -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $DataDirectory 'server.log') -RedirectStandardError (Join-Path $DataDirectory 'server-error.log')
try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($server.HasExited) { throw "Server stopped. See $DataDirectory\server-error.log" }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 1
            if ($health) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (!$ready) { throw "Server did not start. See $DataDirectory\server-error.log" }
    Write-Host "OpenBEXI Timeline: http://127.0.0.1:$Port/demos.html"
    Write-Host 'Keep this window open. Press Ctrl+C to stop the server.'
    if (!$NoBrowser) { Start-Process "http://127.0.0.1:$Port/demos.html" }
    while (!$server.WaitForExit(500)) { }
    if ($server.ExitCode -ne 0) { throw "Server exited with code $($server.ExitCode)." }
} finally {
    if (!$server.HasExited) { Stop-Process -Id $server.Id -Force }
    if ($runtimeService -and (Test-Path -LiteralPath $runtimeService)) { Remove-Item -LiteralPath $runtimeService }
}
