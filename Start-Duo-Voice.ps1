# Launcher for Duo Voice Harness
[CmdletBinding()]
param(
  [switch]$Windowed
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js was not found. Install Node.js 22.12 or newer, then run this launcher again.' }
$nodeVersion = & $nodeCommand.Source -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.12.0') { throw 'Duo requires Node.js 22.12 or newer. Update Node.js, then reopen the launcher.' }
$npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
if (-not $npmCommand) { throw 'npm.cmd was not found. Install Node.js 22.12 or newer with npm, then run this launcher again.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'package-lock.json') -PathType Leaf)) {
  throw 'package-lock.json is missing. Restore the complete Duo source before installing dependencies.'
}

$electronBinary = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\electron\package.json') -PathType Leaf)) {
  Write-Host 'First run: installing Duo Voice Harness dependencies...' -ForegroundColor Cyan
  Push-Location $projectRoot
  try {
    & $npmCommand.Source ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed with exit code $LASTEXITCODE. Check your connection and npm output, then retry." }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath $electronBinary -PathType Leaf)) {
  Write-Host 'First run: downloading the Electron desktop runtime...' -ForegroundColor Cyan
  & $nodeCommand.Source (Join-Path $projectRoot 'node_modules\electron\install.js')
  if ($LASTEXITCODE -ne 0) { throw "Electron binary setup failed with exit code $LASTEXITCODE. Check your connection and the download output, then retry." }
}

if (-not (Test-Path -LiteralPath $electronBinary -PathType Leaf)) {
  throw 'Electron did not finish installing. Check the npm output and binary-download settings, then run npm ci again.'
}

$launchArguments = @('"' + $projectRoot + '"')
if ($Windowed) { $launchArguments += '--windowed' }
$duoLogRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'duo-voice-harness\logs'
if ($env:DUO_VOICE_DATA_ROOT) { $duoLogRoot = Join-Path $env:DUO_VOICE_DATA_ROOT 'logs' }
New-Item -ItemType Directory -Path $duoLogRoot -Force | Out-Null
# The requested desktop window stays visible. Capture launcher failures for double-click users.
$priorRunAsNode = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
try {
  [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null, 'Process')
  $launched = Start-Process -FilePath $electronBinary -ArgumentList $launchArguments -WorkingDirectory $projectRoot -PassThru -Wait -RedirectStandardOutput (Join-Path $duoLogRoot 'startup-output.log') -RedirectStandardError (Join-Path $duoLogRoot 'startup-errors.log')
} finally {
  [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $priorRunAsNode, 'Process')
}
if ($launched.ExitCode -ne 0) {
  throw "Duo Voice Harness exited with code $($launched.ExitCode). See $duoLogRoot\startup-errors.log."
}
