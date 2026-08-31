$ErrorActionPreference = 'Stop'

if (-not $env:CI_API_V4_URL -or -not $env:CI_PROJECT_ID -or -not $env:CI_JOB_TOKEN) {
  throw 'GitLab CI package publishing variables are unavailable'
}

$installer = Get-ChildItem -LiteralPath 'dist' -Filter 'DeepSeek-Harness-Station-*-x64-Setup.exe' -File |
  Select-Object -First 1
if (-not $installer) {
  throw 'Windows installer was not found in dist'
}

$blockmapPath = "$($installer.FullName).blockmap"
if (-not (Test-Path -LiteralPath $blockmapPath -PathType Leaf)) {
  throw "Installer blockmap was not found: $blockmapPath"
}

$packageVersion = if ($env:CI_COMMIT_TAG) {
  $env:CI_COMMIT_TAG.TrimStart('v')
} else {
  $env:CI_COMMIT_SHORT_SHA
}
$packageName = 'deepseek-harness-station'
$packageBaseUrl = "$env:CI_API_V4_URL/projects/$env:CI_PROJECT_ID/packages/generic/$packageName/$packageVersion"
$headers = @{ 'JOB-TOKEN' = $env:CI_JOB_TOKEN }

$hash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash
$checksumPath = Join-Path $installer.DirectoryName 'SHA256SUMS.txt'
Set-Content -LiteralPath $checksumPath -Encoding ascii -Value "$hash  $($installer.Name)"

$files = @($installer.FullName, $blockmapPath, $checksumPath)
foreach ($path in $files) {
  $file = Get-Item -LiteralPath $path
  $uploadUrl = "$packageBaseUrl/$([Uri]::EscapeDataString($file.Name))"
  Write-Host "Publishing $($file.Name) ($([Math]::Round($file.Length / 1MB, 2)) MiB)"
  Invoke-WebRequest -Uri $uploadUrl -Method Put -Headers $headers -InFile $file.FullName -UseBasicParsing | Out-Null
}

$packagePage = "$env:CI_PROJECT_URL/-/packages"
Set-Content -LiteralPath (Join-Path $installer.DirectoryName 'PACKAGE.txt') -Encoding utf8 -Value @(
  "Package: $packageName $packageVersion"
  "Project packages: $packagePage"
  "SHA-256: $hash"
  "Installer: $($installer.Name)"
)

Write-Host "Published GitLab generic package $packageName $packageVersion"
Write-Host "Package registry: $packagePage"
