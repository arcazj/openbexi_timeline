param([string]$ProjectRoot = (Join-Path $PSScriptRoot '..'))
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$version = (Get-Content (Join-Path $ProjectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid stable version.' }
$dist = Join-Path $ProjectRoot 'dist'
$payload = Join-Path $dist ('windows-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $payload | Out-Null
$app = Join-Path $payload 'app'
Copy-Item -LiteralPath (Join-Path $dist 'pages') -Destination $app -Recurse
# Restore the API-aware help file after the static Pages build.
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'help/resources.json') -Destination (Join-Path $app 'help/resources.json')
New-Item -ItemType Directory -Force -Path (Join-Path $app 'release') | Out-Null
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'release/public-files.json') -Destination (Join-Path $app 'release/public-files.json')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'HBDS/aliases.json') -Destination (Join-Path $app 'HBDS/aliases.json')
foreach ($file in @('package.json', 'favicon.ico', 'openbexi_timeline.html', 'openbexi_timeline_earthquake.html')) {
    Copy-Item -LiteralPath (Join-Path $ProjectRoot $file) -Destination $app
}
New-Item -ItemType Directory -Path (Join-Path $app 'lib') | Out-Null
Copy-Item -LiteralPath (Join-Path $ProjectRoot "target/openbexi_timeline-$version.jar") -Destination (Join-Path $app 'lib')
Copy-Item -Path (Join-Path $ProjectRoot 'target/runtime/*.jar') -Destination (Join-Path $app 'lib')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../release/windows/Start-OpenBEXI.ps1') -Destination $payload
if (!$env:JAVA_HOME) { throw 'JAVA_HOME must point to JDK 21 or later.' }
& (Join-Path $env:JAVA_HOME 'bin/jlink.exe') --add-modules java.se,jdk.unsupported,jdk.crypto.ec,jdk.zipfs --strip-debug --no-header-files --no-man-pages --output (Join-Path $payload 'runtime')
if ($LASTEXITCODE -ne 0) { throw 'Java runtime packaging failed.' }
$compiler = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'Install Inno Setup 6, or use the Windows release workflow.' }
& $compiler "/DAppVersion=$version" "/DPayloadDir=$payload" "/DOutputDir=$dist" (Join-Path $PSScriptRoot '../release/windows/installer.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$installer = Join-Path $dist "openbexi-timeline-$version-windows-x64-setup.exe"
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText("$installer.sha256", "$hash  $([System.IO.Path]::GetFileName($installer))`n")
Write-Host "Built $installer"
