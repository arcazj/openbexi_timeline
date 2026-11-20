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
$collectorLauncher = $null
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
    # Restart with a customized service and an explicit port. User plugin and
    # state settings must survive, and workspace service selection must be honored.
    & taskkill.exe /PID $launcher.Id /T /F | Out-Null
    $customService = Join-Path $dataDir 'HBDS/service.custom.yml'
    $settings = [IO.File]::ReadAllText((Join-Path $dataDir 'HBDS/service.desktop.yml')).Replace('roots: []','roots: [plugins]').Replace('../collector-state','../custom-collector-state').Replace('owner: python','owner: java')
    New-Item -ItemType Directory -Force -Path (Join-Path $dataDir 'HBDS/plugins') | Out-Null
    [IO.File]::WriteAllText($customService, $settings)
    $workspaceFile = Join-Path $dataDir 'HBDS/workspace.json'
    $selection = Get-Content -LiteralPath $workspaceFile -Raw | ConvertFrom-Json
    $selection.service = 'service.custom.yml'
    [IO.File]::WriteAllText($workspaceFile, ($selection | ConvertTo-Json -Depth 4))
    # Simulate upgrading an older installed runtime while preserving the user's
    # selected service, saved model/access data, and collected events.
    [IO.File]::WriteAllText((Join-Path $dataDir 'keep.txt'), 'User data survives upgrade and uninstall.')
    foreach ($directory in @('runtime/bin','app/lib')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $installDir $directory) | Out-Null
    }
    [IO.File]::WriteAllText((Join-Path $installDir 'runtime/bin/java.exe'), 'obsolete runtime fixture')
    [IO.File]::WriteAllText((Join-Path $installDir 'app/lib/obsolete.jar'), 'obsolete application fixture')
    $upgrade = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS', "/DIR=`"$installDir`"" -WindowStyle Hidden -PassThru -Wait
    if ($upgrade.ExitCode -ne 0) { throw "Upgrade failed: $($upgrade.ExitCode)" }
    if (!(Test-Path -LiteralPath (Join-Path $dataDir 'keep.txt'))) { throw 'Upgrade removed user data.' }
    $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
    $launcher = Start-Process powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$installDir\Start-OpenBEXI.ps1`"", '-NoBrowser', '-Port', $port, '-DataDirectory', "`"$dataDir`"" -WindowStyle Hidden -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        if ($launcher.HasExited) { throw 'Customized desktop workspace exited early.' }
        try { if (Invoke-RestMethod "http://127.0.0.1:$port/api/v1/health" -TimeoutSec 1) { $ready = $true; break } }
        catch { Start-Sleep -Milliseconds 500 }
    }
    if (!$ready -or [IO.File]::ReadAllText($customService) -ne $settings) { throw 'Desktop restart changed or ignored custom service settings.' }
    if (Test-Path -LiteralPath (Join-Path $installDir 'runtime')) { throw 'Obsolete Java runtime remains in Python installation.' }
    if (Get-ChildItem -LiteralPath $installDir -File -Recurse | Where-Object { $_.Extension -in '.jar','.class','.java' }) { throw 'Java artifact found in Python installation.' }
    Remove-Item Env:JAVA_HOME -ErrorAction SilentlyContinue
    $collectorOutput = Join-Path $testRoot 'collector-validation.log'
    $collectorErrors = Join-Path $testRoot 'collector-validation-errors.log'
    $validation = Start-Process -FilePath (Join-Path $installDir 'python/python.exe') -ArgumentList "`"$(Join-Path $ProjectRoot 'tools/test-installed-collector.py')`"", "`"$(Join-Path $dataDir 'HBDS/workspace.json')`"" -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput $collectorOutput -RedirectStandardError $collectorErrors
    Get-Content -LiteralPath $collectorOutput, $collectorErrors | ForEach-Object { Write-Host $_ }
    if ($validation.ExitCode -ne 0) { throw 'Installed collector conversion or stable rerun failed.' }
    # Run real WS/WSS handshakes using the isolated embedded interpreter and its
    # installed dependencies; ASGI-only tests cannot detect missing WS backends.
    foreach ($transportCase in @('test_legacy_listener_startup.py', 'test_connections.py')) {
        $transportOutput = Join-Path $testRoot ($transportCase + '.log')
        $transportErrors = Join-Path $testRoot ($transportCase + '-errors.log')
        $transport = Start-Process -FilePath (Join-Path $installDir 'python/python.exe') -ArgumentList '-m', 'unittest', 'discover', '-s', "`"$(Join-Path $ProjectRoot 'tests/python')`"", '-p', $transportCase, '-v' -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput $transportOutput -RedirectStandardError $transportErrors
        Get-Content -LiteralPath $transportOutput, $transportErrors | ForEach-Object { Write-Host $_ }
        if ($transport.ExitCode -ne 0) { throw ('Installed transport regression failed: ' + $transportCase) }
    }
    & (Join-Path $installDir 'timeline-convert-default.cmd') --version
    if ($LASTEXITCODE -ne 0) { throw 'Portable standalone converter launcher failed.' }
    $collectorListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $collectorListener.Start(); $collectorPort = $collectorListener.LocalEndpoint.Port; $collectorListener.Stop()
    $collectorLauncher = Start-Process powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$installDir\Start-Data-Collector.ps1`"", '-NoBrowser', '-Port', $collectorPort, '-Workspace', "`"$dataDir\HBDS\workspace.json`"" -WindowStyle Hidden -PassThru
    $collectorReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($collectorLauncher.HasExited) { throw 'Installed collector launcher exited early.' }
        try {
            $status = Invoke-RestMethod "http://127.0.0.1:$collectorPort/api/status" -TimeoutSec 1
            if ($status.sources[0].plugin -eq 'default' -and !$status.sources[0].error) { $collectorReady = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (!$collectorReady) { throw 'Installed collector dashboard never became healthy.' }
    if (Get-ChildItem -LiteralPath $installDir -Directory -Recurse | Where-Object { $_.Name -like 'timeline_private_*' -or ($_.Name -like '*_data_collector' -and $_.Name -ne 'timeline_data_collector') }) { throw 'Private package found in installer.' }
} finally {
    if ($collectorLauncher -and !$collectorLauncher.HasExited) { & taskkill.exe /PID $collectorLauncher.Id /T /F | Out-Null }
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
Write-Host 'Install, legacy upgrade, bundled Python, public plugin conversion, browser rendering and uninstall checks passed.'
