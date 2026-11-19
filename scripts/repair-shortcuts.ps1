param([string]$Version='')
$ErrorActionPreference='Stop'
$appRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if(-not $Version){$Version=(Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw | ConvertFrom-Json).version}
if($Version -notmatch '^\d+\.\d+\.\d+$'){throw '版本格式无效。'}
$appExe=(Resolve-Path -LiteralPath (Join-Path $appRoot "release\$Version\win-unpacked\知行.exe")).Path
$iconPath=$appExe
$startRoot=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$oldLink=Join-Path $startRoot 'Electron.lnk'
$newLink=Join-Path $startRoot '知行.lnk'
$backupFolder=Join-Path $appRoot '.runtime-audit\shortcut-backups'
New-Item -ItemType Directory -Path $backupFolder -Force | Out-Null
$shortcutShell=New-Object -ComObject WScript.Shell
function Set-ZhixingShortcut([string]$LinkPath,[string]$BackupName){
 $shortcut=$shortcutShell.CreateShortcut($LinkPath)
 if(Test-Path -LiteralPath $LinkPath){
  if(-not $shortcut.TargetPath.StartsWith($appRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw "现有入口不属于本项目，未修改：$LinkPath"}
  if($shortcut.TargetPath -ne $appExe -or $shortcut.IconLocation -ne "$iconPath,0" -or $shortcut.Arguments){
   $backup=Join-Path $backupFolder "$BackupName-before-$Version.lnk"
   if(-not(Test-Path -LiteralPath $backup)){Copy-Item -LiteralPath $LinkPath -Destination $backup}
  }
 }
 $shortcut.TargetPath=$appExe
 $shortcut.Arguments=''
 $shortcut.WorkingDirectory=Split-Path -Parent $appExe
 $shortcut.IconLocation="$iconPath,0"
 $shortcut.Description='知行 · AI 办公助手'
 $shortcut.Save()
 $verified=$shortcutShell.CreateShortcut($LinkPath)
 if($verified.TargetPath -ne $appExe -or $verified.IconLocation -ne "$iconPath,0"){throw '快捷方式回读校验失败。'}
 [pscustomobject]@{link=$LinkPath;target=$verified.TargetPath;icon=$verified.IconLocation}
}
$records=@()
if(Test-Path -LiteralPath $oldLink){
 $previous=$shortcutShell.CreateShortcut($oldLink)
 if($previous.TargetPath.StartsWith($appRoot+'\',[StringComparison]::OrdinalIgnoreCase)){
  $repaired=Set-ZhixingShortcut $oldLink 'Electron'
  if(Test-Path -LiteralPath $newLink){$records+=$repaired}
  else{Move-Item -LiteralPath $oldLink -Destination $newLink}
 }
}
$records+=Set-ZhixingShortcut $newLink 'StartMenu-Zhixing'
$records+=Set-ZhixingShortcut (Join-Path $appRoot '知行.lnk') 'Workspace-Zhixing'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ZhixingShortcutNotify {
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)]
 public static extern void SHChangeNotify(uint eventId,uint flags,[MarshalAs(UnmanagedType.LPWStr)] string item,IntPtr item2);
}
'@
foreach($changed in @($records.link | Select-Object -Unique) + @($appExe)){
 [ZhixingShortcutNotify]::SHChangeNotify(0x2000,0x1005,$changed,[IntPtr]::Zero)
}
$records | ConvertTo-Json
