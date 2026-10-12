param([string]$ProjectRoot = (Join-Path $PSScriptRoot '..'))
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$version = (Get-Content (Join-Path $ProjectRoot 'package.json') -Raw | ConvertFrom-Json).version
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('openbexi-installer-' + [guid]::NewGuid().ToString('N'))
$installDir = Join-Path $testRoot 'Installed App'
$dataDir = Join-Path $testRoot 'User Data'
New-Item -ItemType Directory -Path $testRoot | Out-Null
$installer = Join-Path $ProjectRoot "dist/openbexi-timeline-$version-windows-x64-setup.exe"
$install = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS', "/DIR=`"$installDir`"" -WindowStyle Hidden -PassThru -Wait
if ($install.ExitCode -ne 0) { throw "Install failed: $($install.ExitCode)" }
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
$launcher = $null
try {
    $launcher = Start-Process powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$installDir\Start-OpenBEXI.ps1`"", '-NoBrowser', '-Port', $port, '-DataDirectory', "`"$dataDir`"" -WindowStyle Hidden -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        if ($launcher.HasExited) { throw 'Installed launcher exited early.' }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$port/api/v1/health" -TimeoutSec 1
            if ($health) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (!$ready) { throw 'Installed application never became healthy.' }
    $env:OPENBEXI_INSTALL_TEST_URL = "http://127.0.0.1:$port"
    $browserTest = Join-Path $ProjectRoot 'node_modules/.openbexi-installer-smoke.mjs'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'test-windows-browser.mjs') -Destination $browserTest
    & node $browserTest
    if ($LASTEXITCODE -ne 0) { throw 'Installed browser smoke test failed.' }
    [System.IO.File]::WriteAllText((Join-Path $dataDir 'keep.txt'), 'User data survives uninstall.')
} finally {
    if ($launcher -and !$launcher.HasExited) { & taskkill.exe /PID $launcher.Id /T /F | Out-Null }
    $uninstaller = Join-Path $installDir 'unins000.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -WindowStyle Hidden -PassThru -Wait
        if ($uninstall.ExitCode -ne 0) { throw 'Uninstall failed.' }
    }
}
for ($attempt = 0; $attempt -lt 30 -and (Test-Path -LiteralPath "$installDir\Start-OpenBEXI.ps1"); $attempt++) { Start-Sleep -Milliseconds 500 }
if (Test-Path -LiteralPath "$installDir\Start-OpenBEXI.ps1") { throw 'Uninstall left application files behind.' }
if (!(Test-Path -LiteralPath (Join-Path $dataDir 'keep.txt'))) { throw 'Uninstall removed user data.' }
Write-Host 'Installer, bundled Java, browser rendering and uninstall checks passed.'
