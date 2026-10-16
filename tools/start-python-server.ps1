param(
    [string[]]$DataConf = @(),
    [string]$Workspace = '',
    [string]$ServerConf = '',
    [string]$HbdsRoot = '',
    [int]$Port = 0,
    [int]$Workers = 1,
    [string]$State = '',
    [string]$JavaUrl = '',
    [switch]$IndexFirst,
    [switch]$Check
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw 'Create .venv and install requirements.lock first. See docs/python-server.md.'
}
Push-Location -LiteralPath $projectRoot
try {
    if ($Workspace -and $DataConf.Count) { throw 'Choose -Workspace or -DataConf, not both.' }
    if (-not $Workspace -and -not $DataConf.Count) {
        if (Test-Path -LiteralPath 'HBDS/workspace.json') { $Workspace = 'HBDS/workspace.json' }
        else { $DataConf = @('HBDS/yaml/DEMO_default.yml') }
    }
    $serverArgs = @('-m', 'openbexi_timeline_server')
    if ($Workspace) { $serverArgs += @('--workspace', $Workspace) }
    else {
        $serverArgs += @('-dataconf') + $DataConf
        if (-not $ServerConf) { $ServerConf = 'HBDS/service.yml' }
    }
    if ($ServerConf) { $serverArgs += @('-serverconf', $ServerConf) }
    if ($HbdsRoot) { $serverArgs += @('--hbds-root', $HbdsRoot) }
    if ($State) { $serverArgs += @('--state', $State) }
    $serverArgs += @('--workers', "$Workers")
    if ($Port) { $serverArgs += @('--port', "$Port") }
    if ($JavaUrl) { $serverArgs += @('--java-url', $JavaUrl) }
    & $pythonExe @serverArgs --check
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($Check) { exit 0 }
    if ($IndexFirst) {
        & $pythonExe @serverArgs --index-once
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    & $pythonExe @serverArgs
    exit $LASTEXITCODE
} finally { Pop-Location }
