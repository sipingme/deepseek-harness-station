$ErrorActionPreference = 'Stop'

if (-not $env:CI_API_V4_URL -or -not $env:CI_PROJECT_ID -or -not $env:CI_JOB_TOKEN) {
  throw 'GitLab CI package publishing variables are unavailable'
}

$version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
if ($env:CI_COMMIT_TAG -and $env:CI_COMMIT_TAG -cne "v$version") {
  throw 'Release tag must match package.json version'
}
$installer = Get-Item -LiteralPath "dist/DeepSeek-Harness-Station-$version-x64-Setup.exe"
if (-not $installer) {
  throw 'Windows installer was not found in dist'
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

$files = @($installer.FullName, $checksumPath)
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

if ($env:CI_COMMIT_TAG) {
  $releasesUrl = "$env:CI_API_V4_URL/projects/$env:CI_PROJECT_ID/releases"
  $releaseUrl = "$releasesUrl/$([Uri]::EscapeDataString($env:CI_COMMIT_TAG))"
  $notesPath = "docs/release-$version.zh-CN.md"
  $notes = if (Test-Path -LiteralPath $notesPath) { Get-Content -LiteralPath $notesPath -Raw -Encoding utf8 } else { "DeepSeek Harness Station $version" }
  $installerUrl = "$packageBaseUrl/$([Uri]::EscapeDataString($installer.Name))"
  $notes = "[Download Windows installer]($installerUrl)`n`n$notes"
  $existing = $null
  try {
    $existing = Invoke-RestMethod -Uri $releaseUrl -Headers $headers
  } catch {
    if ([int]$_.Exception.Response.StatusCode -ne 404) { throw }
  }
  $body = @{ name = "DeepSeek Harness Station $version"; description = $notes }
  if ($existing) {
    Invoke-RestMethod -Uri $releaseUrl -Method Put -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ($body | ConvertTo-Json -Depth 8) | Out-Null
  } else {
    $body.tag_name = $env:CI_COMMIT_TAG
    $body.assets = @{ links = @($files | ForEach-Object {
      $assetName = [IO.Path]::GetFileName($_)
      @{ name = $assetName; url = "$packageBaseUrl/$([Uri]::EscapeDataString($assetName))"; direct_asset_path = "/$assetName"; link_type = 'package' }
    }) }
    Invoke-RestMethod -Uri $releasesUrl -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ($body | ConvertTo-Json -Depth 8) | Out-Null
  }
  Write-Host "Published GitLab release $env:CI_COMMIT_TAG"
}
