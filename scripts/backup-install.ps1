# Back up or restore everything an installer touches, so an upgrade rehearsal can
# be undone completely. Shortcuts, registry keys and the app data directory are
# copied; the install directory itself is NOT (246 MB) but its path is recorded.
param(
  [Parameter(Mandatory = $true)][ValidateSet('Backup', 'Restore', 'Verify')][string]$Mode,
  [string]$State = 'D:\AI\codex\codex4\office-agent\.preview\install-state',
  [string]$InstallRoot = 'D:\应用\知行'
)
$ErrorActionPreference = 'Stop'
$AppId = '8d0162ad-33d7-58a5-95e7-2602977677c3'
$AppKey = "HKCU:\Software\$AppId"
$UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId"
$StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$DesktopLnk = Join-Path $env:USERPROFILE 'Desktop\知行.lnk'

function Get-ShortcutInfo([string]$path) {
  if (-not (Test-Path $path)) { return $null }
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($path)
  return [pscustomobject]@{
    path = $path
    target = $shortcut.TargetPath
    workdir = $shortcut.WorkingDirectory
    sha256 = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
  }
}

function Get-RegistrySnapshot([string]$key) {
  if (-not (Test-Path $key)) { return $null }
  $values = @{}
  $item = Get-ItemProperty $key -ErrorAction SilentlyContinue
  foreach ($property in $item.PSObject.Properties) {
    if ($property.Name -notlike 'PS*') { $values[$property.Name] = [string]$property.Value }
  }
  return $values
}

if ($Mode -eq 'Backup') {
  New-Item -ItemType Directory -Path $State -Force | Out-Null
  $startLnk = Join-Path $StartMenu '知行.lnk'
  $snapshot = [pscustomobject]@{
    takenAt = (Get-Date).ToString('o')
    installRoot = $InstallRoot
    installExists = Test-Path (Join-Path $InstallRoot '知行.exe')
    installFileCount = if (Test-Path $InstallRoot) { (Get-ChildItem $InstallRoot -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count } else { 0 }
    uninstallDisplayName = (Get-ItemProperty $UninstallKey -ErrorAction SilentlyContinue).DisplayName
    uninstallVersion = (Get-ItemProperty $UninstallKey -ErrorAction SilentlyContinue).DisplayVersion
    appKeyValues = Get-RegistrySnapshot $AppKey
    uninstallKeyValues = Get-RegistrySnapshot $UninstallKey
    appKeyExport = Join-Path $State 'app.reg'
    uninstallKeyExport = Join-Path $State 'uninstall.reg'
    startMenu = Get-ShortcutInfo $startLnk
    desktop = Get-ShortcutInfo $DesktopLnk
    dataFileCount = (Get-ChildItem (Join-Path $env:APPDATA '知行') -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
  }
  if (Test-Path $AppKey) { & reg export "HKCU\Software\$AppId" $snapshot.appKeyExport /y | Out-Null }
  if (Test-Path $UninstallKey) { & reg export "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId" $snapshot.uninstallKeyExport /y | Out-Null }
  if (Test-Path $startLnk) { Copy-Item $startLnk (Join-Path $State 'start-知行.lnk') -Force }
  if (Test-Path $DesktopLnk) { Copy-Item $DesktopLnk (Join-Path $State 'desktop-知行.lnk') -Force }
  $snapshot | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $State 'snapshot.json') -Encoding utf8NoBOM
  $snapshot | ConvertTo-Json -Depth 4
  exit 0
}

if ($Mode -eq 'Restore') {
  $snapshot = Get-Content (Join-Path $State 'snapshot.json') -Raw | ConvertFrom-Json
  if (Test-Path $snapshot.appKeyExport) { & reg import $snapshot.appKeyExport | Out-Null }
  if (Test-Path $snapshot.uninstallKeyExport) { & reg import $snapshot.uninstallKeyExport | Out-Null }
  $startLnk = Join-Path $StartMenu '知行.lnk'
  $savedStart = Join-Path $State 'start-知行.lnk'
  $savedDesktop = Join-Path $State 'desktop-知行.lnk'
  if (Test-Path $savedStart) { Copy-Item $savedStart $startLnk -Force }
  if (Test-Path $savedDesktop) { Copy-Item $savedDesktop $DesktopLnk -Force }
  [pscustomobject]@{
    restoredAt = (Get-Date).ToString('o')
    registryApp = Test-Path $AppKey
    registryUninstall = Test-Path $UninstallKey
    startMenuSha = (Get-ShortcutInfo $startLnk).sha256
    startMenuTarget = (Get-ShortcutInfo $startLnk).target
    expectedStartMenuSha = $snapshot.startMenu.sha256
    shortcutsMatch = ((Get-ShortcutInfo $startLnk).sha256 -eq $snapshot.startMenu.sha256) -and ([string](Get-ShortcutInfo $DesktopLnk).sha256 -eq [string]$snapshot.desktop.sha256)
  } | ConvertTo-Json -Depth 4
  exit 0
}

# Verify: compare the live machine with the recorded snapshot.
$saved = Get-Content (Join-Path $State 'snapshot.json') -Raw | ConvertFrom-Json
$startLnk = Join-Path $StartMenu '知行.lnk'
$desktopLnk = Join-Path $DesktopLnk '知行.lnk'
$live = [pscustomobject]@{
  installExists = Test-Path (Join-Path $InstallRoot '知行.exe')
  installVersion = if (Test-Path (Join-Path $InstallRoot '知行.exe')) { (Get-Item (Join-Path $InstallRoot '知行.exe')).VersionInfo.ProductVersion } else { $null }
  appKeyExists = Test-Path $AppKey
  uninstallKeyExists = Test-Path $UninstallKey
  startMenuTarget = (Get-ShortcutInfo $startLnk).target
  desktopTarget = (Get-ShortcutInfo $DesktopLnk).target
  dataFileCount = (Get-ChildItem (Join-Path $env:APPDATA '知行') -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
  snapshotDataFileCount = $saved.dataFileCount
  dataPreserved = ((Get-ChildItem (Join-Path $env:APPDATA '知行') -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count -ge $saved.dataFileCount)
}
$live | ConvertTo-Json -Depth 4
