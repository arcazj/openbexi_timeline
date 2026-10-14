param(
    [ValidateRange(1024, 65535)][int]$Port = 8781,
    [string]$DataDirectory = (Join-Path $env:LOCALAPPDATA 'OpenBEXI Timeline\data'),
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$appRoot = Join-Path $PSScriptRoot 'app'
$runtime = Join-Path $PSScriptRoot 'runtime\bin\java.exe'
# Never attach to another process merely because it owns our default port.
$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $probe.Start() } catch { throw "Port $Port is already in use. Close the other instance or launch with -Port <number>." }
finally { $probe.Stop() }
New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
$DataDirectory = (Resolve-Path -LiteralPath $DataDirectory).Path
$hbdsDirectory = Join-Path $DataDirectory 'HBDS'
New-Item -ItemType Directory -Force -Path $hbdsDirectory | Out-Null
$hbdsConfiguration = Join-Path $hbdsDirectory 'openbexi_timeline.hbds.json'
if (!(Test-Path -LiteralPath $hbdsConfiguration)) {
    Copy-Item -LiteralPath (Join-Path $appRoot 'HBDS/templates/default.hbds.json') -Destination $hbdsConfiguration
}
$javaArgs = @(
    "-Dopenbexi.api.port=$Port",
    "`"-Dopenbexi.api.root=$appRoot`"",
    "`"-Dopenbexi.api.dataDir=$DataDirectory`"",
    "`"-Dopenbexi.hbds.config=$hbdsConfiguration`"",
    '-cp', "`"$appRoot\lib\*`"", 'com.openbexi.timeline.api.ApiServer'
)
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
}
