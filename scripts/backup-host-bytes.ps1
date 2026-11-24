#requires -Version 7.0
<#
.SYNOPSIS
Take the cold byte backup that qa-install-lifecycle.ps1 requires as HostBackupManifest.
.DESCRIPTION
The lifecycle script refuses to run unless both NSIS default-data destinations and
every product shortcut are copied byte-for-byte first, so an upgrade rehearsal can
put the machine back exactly as it was. This helper produces that manifest with the
same tree-hash shape the lifecycle script compares against:

  {schemaVersion=1, plaintextDecryptionPerformed=false, defaultData[], shortcuts[]}

Run it only with the product closed. It never decrypts anything and never touches
the installation directory.
.EXAMPLE
pwsh -File scripts/backup-host-bytes.ps1 -Destination '.preview\qa-0.14.1\lifecycle-backup'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Destination,
    [string]$InstallRoot = 'D:\应用\知行'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$productName = [string]([char]0x77E5) + [char]0x884C
$executableName = $productName + '.exe'
$destination = [IO.Path]::GetFullPath($Destination)
$manifestPath = Join-Path $destination 'protected-host-manifest.json'

$running = @(Get-CimInstance Win32_Process -Filter "Name='$executableName'" | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith([IO.Path]::GetFullPath($InstallRoot).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
})
if ($running.Count) { throw "Close $productName normally before taking a cold backup. $($running.Count) process(es) still running." }

function Get-TreeHashes([string]$Root) {
    $rootPath = (Get-Item -LiteralPath $Root -Force).FullName.TrimEnd('\')
    $items = @(Get-ChildItem -LiteralPath $rootPath -Recurse -Force)
    foreach ($item in $items) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing to back up a reparse point: $($item.FullName)" }
    }
    return @($items | Where-Object { -not $_.PSIsContainer } | Sort-Object FullName | ForEach-Object {
        [ordered]@{
            relativePath = $_.FullName.Substring($rootPath.Length + 1).Replace('\', '/')
            bytes = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    })
}

function Get-ProductShortcuts {
    $roots = @(
        [Environment]::GetFolderPath('Desktop'),
        [Environment]::GetFolderPath('CommonDesktopDirectory'),
        [Environment]::GetFolderPath('Programs'),
        [Environment]::GetFolderPath('CommonPrograms')
    ) | Where-Object { $_ } | Select-Object -Unique
    $result = @()
    $shell = New-Object -ComObject WScript.Shell
    try {
        foreach ($root in $roots) {
            if (-not (Test-Path -LiteralPath $root)) { continue }
            foreach ($link in @(Get-ChildItem -LiteralPath $root -Filter '*.lnk' -File -Recurse -ErrorAction Stop)) {
                $shortcut = $shell.CreateShortcut($link.FullName)
                try {
                    if ($link.BaseName -ne $productName -and $shortcut.TargetPath -notlike "*\$executableName") { continue }
                    $result += [ordered]@{
                        path = $link.FullName; target = $shortcut.TargetPath
                        sha256 = (Get-FileHash -LiteralPath $link.FullName -Algorithm SHA256).Hash
                    }
                } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
            }
        }
    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
    return $result
}

if (Test-Path -LiteralPath $destination) {
    # Only ever replace an earlier backup of the same shape, never an arbitrary directory.
    $existing = @(Get-ChildItem -LiteralPath $destination -Force)
    if ($existing.Count -and -not (Test-Path -LiteralPath $manifestPath)) { throw "Destination is not empty and holds no previous host backup: $destination" }
    Remove-Item -LiteralPath $destination -Recurse -Force
}
[void](New-Item -ItemType Directory -Path $destination)

$defaultData = @()
foreach ($leaf in @($productName, 'office-agent')) {
    $source = Join-Path $env:APPDATA $leaf
    $existed = Test-Path -LiteralPath $source
    $backup = Join-Path $destination ('default-data-' + $leaf)
    $files = @()
    if ($existed) {
        $files = @(Get-TreeHashes $source)
        [void](New-Item -ItemType Directory -Path $backup)
        foreach ($item in @(Get-ChildItem -LiteralPath $source -Force)) {
            Copy-Item -LiteralPath $item.FullName -Destination $backup -Recurse
        }
        $copied = @(Get-TreeHashes $backup)
        $left = ConvertTo-Json -InputObject $files -Depth 20 -Compress
        $right = ConvertTo-Json -InputObject $copied -Depth 20 -Compress
        if ($left -cne $right) { throw "Backup copy of $source differs from the source bytes. Close the app and retry." }
    }
    $defaultData += [ordered]@{ source = $source; existed = $existed; backup = $backup; files = $files }
}

$shortcuts = @()
foreach ($link in @(Get-ProductShortcuts)) {
    $name = 'shortcut-' + [IO.Path]::GetFileNameWithoutExtension($link.path) + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.lnk'
    $copy = Join-Path $destination $name
    Copy-Item -LiteralPath $link.path -Destination $copy -Force
    if ((Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash -ne $link.sha256) { throw "Shortcut copy differs: $($link.path)" }
    $shortcuts += [ordered]@{ source = $link.path; backup = $copy; sha256 = $link.sha256 }
}

$manifest = [ordered]@{
    schemaVersion = 1
    plaintextDecryptionPerformed = $false
    takenAt = (Get-Date).ToString('o')
    installRoot = $InstallRoot
    defaultData = $defaultData
    shortcuts = $shortcuts
}
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($manifestPath, (ConvertTo-Json -InputObject $manifest -Depth 30), $utf8)
[ordered]@{
    manifest = $manifestPath
    defaultData = @($defaultData | ForEach-Object { [ordered]@{ source = $_.source; existed = $_.existed; files = @($_.files).Count } })
    shortcuts = @($shortcuts | ForEach-Object { $_.source })
} | ConvertTo-Json -Depth 6
