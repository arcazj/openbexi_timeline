param(
    [string[]]$DataConf = @(),
    [string]$Workspace = '',
    [string]$ServerConf = '',
    [string]$HbdsRoot = '',
    [string]$JavaExecutable = 'java',
    [string]$MavenExecutable = 'mvn',
    [switch]$Build,
    [switch]$Check
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ($JavaExecutable -eq 'java') {
    if ($env:JDK_HOME) { $JavaExecutable = Join-Path $env:JDK_HOME 'bin/java.exe' }
    elseif ($env:JAVA_HOME) { $JavaExecutable = Join-Path $env:JAVA_HOME 'bin/java.exe' }
}
Push-Location -LiteralPath $projectRoot
try {
    if ($Workspace -and $DataConf.Count) { throw 'Choose -Workspace or -DataConf, not both.' }
    if (-not $Workspace -and -not $DataConf.Count) {
        if (Test-Path -LiteralPath 'HBDS/workspace.json') { $Workspace = 'HBDS/workspace.json' }
        else { $DataConf = @('HBDS/yaml/DEMO_default.yml') }
    }
    if ($Build) {
        & $MavenExecutable --batch-mode --no-transfer-progress verify
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    if (-not (Test-Path -LiteralPath 'target/classes/com/openbexi/timeline/server/openbexi_timeline.class') -or
        -not (Get-ChildItem -Path 'target/runtime/*.jar' -ErrorAction SilentlyContinue)) {
        throw 'Build the Java server first: mvn --batch-mode --no-transfer-progress verify (or use -Build).'
    }
    $classpath = (Join-Path $projectRoot 'target/classes') + [IO.Path]::PathSeparator + (Join-Path $projectRoot 'target/runtime/*')
    $serverArgs = @('-cp', $classpath, 'com.openbexi.timeline.server.openbexi_timeline')
    if ($Workspace) { $serverArgs += @('--workspace', $Workspace) }
    else {
        $serverArgs += @('-dataconf') + $DataConf
        if (-not $ServerConf) { $ServerConf = 'HBDS/service.yml' }
    }
    if ($ServerConf) { $serverArgs += @('-serverconf', $ServerConf) }
    if ($HbdsRoot) { $serverArgs += @('--hbds-root', $HbdsRoot) }
    if ($Check) { $serverArgs += '--check' }
    & $JavaExecutable @serverArgs
    exit $LASTEXITCODE
} finally { Pop-Location }
