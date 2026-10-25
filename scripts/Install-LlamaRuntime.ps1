# Rule: install the pinned upstream runtime inside this repository; preserve an existing install.
[CmdletBinding()]
param([string]$Release = 'b10964')
$ErrorActionPreference = 'Stop'
if ($Release -notmatch '^b[0-9]+$') { throw 'Use an upstream build tag such as b10964.' }
$duoRoot = Split-Path $PSScriptRoot -Parent
$runtimeRoot = Join-Path $duoRoot 'runtime\llama.cpp'
$destination = Join-Path $runtimeRoot 'win-x64'
if (Test-Path -LiteralPath (Join-Path $destination 'llama-server.exe')) {
  Write-Host "Runtime already installed: $destination"
  exit 0
}
if ((Test-Path -LiteralPath $destination) -and (Get-ChildItem -LiteralPath $destination -Force | Select-Object -First 1)) {
  throw "An incomplete runtime exists at $destination. Inspect it before installing."
}
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$metadata = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/$Release" -Headers @{ 'User-Agent' = 'duo-voice-harness-setup' }
$assetName = "llama-$Release-bin-win-vulkan-x64.zip"
$asset = $metadata.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
if (-not $asset) { throw "The official release does not contain $assetName." }
$download = Join-Path $runtimeRoot $assetName
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $download
$actual = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
if ($asset.digest -and $asset.digest.StartsWith('sha256:') -and $actual -ne $asset.digest.Substring(7)) {
  throw 'The downloaded archive does not match the upstream SHA256 digest.'
}
$staging = Join-Path $runtimeRoot ('unpack-' + [guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $download -DestinationPath $staging
$server = Get-ChildItem -LiteralPath $staging -Recurse -File -Filter 'llama-server.exe' | Select-Object -First 1
if (-not $server) { throw 'The downloaded archive contains no llama-server.exe.' }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-ChildItem -LiteralPath $server.DirectoryName -File | Copy-Item -Destination $destination
@{ release=$Release; url=$asset.browser_download_url; archiveSha256=$actual } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'upstream.json') -Encoding UTF8
Write-Host "Installed $Release Windows Vulkan runtime at $destination. Model weights are selected separately."
