param(
    [string]$Workspace = (Join-Path $env:LOCALAPPDATA 'OpenBEXI Timeline/data/HBDS/workspace.json'),
    [ValidateRange(1024,65535)][int]$Port = 8765,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $Workspace)) { throw 'Launch OpenBEXI Timeline once to create the desktop workspace, or pass -Workspace <path>.' }
$env:JAVA_HOME = Join-Path $PSScriptRoot 'runtime'
$python = Join-Path $PSScriptRoot 'python/python.exe'
$logs = Split-Path -Parent (Split-Path -Parent $Workspace)
$server = Start-Process -FilePath $python -ArgumentList '-m','timeline_data_collector','serve','--workspace',"`"$Workspace`"",'--port',$Port -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'collector.log') -RedirectStandardError (Join-Path $logs 'collector-error.log')
try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($server.HasExited) { throw "Collector stopped. See $logs\collector-error.log" }
        try {
            $status = Invoke-RestMethod "http://127.0.0.1:$Port/api/status" -TimeoutSec 1
            if ($status) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 300 }
    }
    if (!$ready) { throw 'Collector did not start.' }
    Write-Host "Timeline Data Collector: http://127.0.0.1:$Port"
    Write-Host 'Keep this window open. Press Ctrl+C to stop.'
    if (!$NoBrowser) { Start-Process "http://127.0.0.1:$Port" }
    while (!$server.WaitForExit(500)) { }
    if ($server.ExitCode -ne 0) { throw "Collector exited with code $($server.ExitCode)." }
} finally {
    if (!$server.HasExited) { Stop-Process -Id $server.Id -Force }
}
