param(
    [string]$DataConf = 'HBDS/templates/default.hbds.json',
    [int]$Port = 8783,
    [int]$Workers = 1,
    [string]$State = '.local-private/python-timeline',
    [string]$JavaUrl = '',
    [switch]$IndexFirst
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw 'Create .venv and install requirements.lock first. See docs/python-server.md.'
}
Push-Location -LiteralPath $projectRoot
try {
    $serverArgs = @('-m', 'openbexi_timeline_server', '-data_conf', $DataConf, '--state', $State, '--port', "$Port", '--workers', "$Workers")
    if ($JavaUrl) { $serverArgs += @('--java-url', $JavaUrl) }
    & $pythonExe @serverArgs --check
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($IndexFirst) {
        & $pythonExe @serverArgs --index-once
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    & $pythonExe @serverArgs
    exit $LASTEXITCODE
} finally { Pop-Location }
