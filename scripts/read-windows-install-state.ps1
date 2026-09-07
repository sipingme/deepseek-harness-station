param([string]$Product = 'DeepSeek Harness Station')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$registryRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
)
$registrations = @($registryRoots | ForEach-Object {
  Get-ItemProperty -Path "$_\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq $product } |
    Select-Object DisplayName, DisplayVersion, UninstallString, DisplayIcon
})
$desktop = [Environment]::GetFolderPath('Desktop', 'DoNotVerify')
$programs = [Environment]::GetFolderPath('Programs', 'DoNotVerify')
$candidateLinks = @(
  (Join-Path $desktop "$product.lnk"),
  (Join-Path $programs "$product.lnk")
)
$menu = Join-Path $programs $product
if (Test-Path -LiteralPath $menu) {
  $candidateLinks += @(Get-ChildItem -LiteralPath $menu -Filter '*.lnk' | ForEach-Object { $_.FullName })
}
$shortcutReader = New-Object -ComObject WScript.Shell
$shortcuts = @($candidateLinks | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | ForEach-Object {
  $shortcut = $shortcutReader.CreateShortcut($_)
  @{ path = $_; target = $shortcut.TargetPath; icon = $shortcut.IconLocation }
})
@{
  registrations = $registrations
  shortcuts = $shortcuts
  desktop = $desktop
  programs = $programs
  appData = [Environment]::GetFolderPath('ApplicationData')
  running = @(Get-Process -Name $product -ErrorAction SilentlyContinue).Count -gt 0
} | ConvertTo-Json -Depth 5 -Compress
