#requires -Version 5.1
<#
.SYNOPSIS
Inspect or test the original Windows NSIS candidate with reversible host backups.
.DESCRIPTION
Inspect is read-only outside .preview/qa-<package-version>/install-evidence-*.
Run accepts the same Windows account with byte-verified backups of default data
and existing shortcuts. A separate Windows account is not required. Existing
same-appId installation registrations must be absent, so the tested installer
cannot select an unrelated registered installation for removal. Existing app
processes must finish normally before installer execution. The script never
terminates a process to satisfy this requirement.

Pass HostBackupManifest from a local, cold byte backup. No original user data is
decrypted. The test restores shortcut bytes after uninstall and verifies every
original default-data file. Uninstall uses --keep-shortcuts to avoid the global
WinShell::UninstAppUserModelId operation. Own shortcut cleanup is explicit.
Overlay installs use --updated to keep the updater's internal uninstaller on
its --keep-shortcuts path. No command contains --force-run or --delete-app-data.

Run requires a JSON manifest describing the authorized synthetic profile.
Generate that profile under the SAME Windows SID as the test runner.
Electron safeStorage ciphertext is not assumed portable across Windows users.
The source application must be closed. No enabled automations or real secrets
are allowed. Example manifest (replace values with actual fixture metadata)

{
  "schemaVersion": 1,
  "synthetic": true,
  "noRealCredentials": true,
  "noEnabledAutomations": true,
  "creatorSid": "S-1-5-21-...",
  "sourceAppVersion": "0.11.0",
  "profilePath": "D:\\qa\\synthetic-profile",
  "projectPaths": ["D:\\qa\\synthetic-project"],
  "expectedProjectIds": ["qa-project"],
  "expectedChatIds": ["qa-chat"],
  "expectedDraftKeys": ["chat:qa-chat"],
  "expectedEncryptedFiles": ["zhixing/workspace.bin", "zhixing/mcp.bin"]
}

Evidence, copied profiles, and probe scripts stay within a new install-evidence-*
directory. The installation uses a separate short root under .preview\i QA,
including Chinese and a space, so evidence filenames do not artificially add
70 characters to every installed dependency path. Existing source fixtures are
only read and hashed. Nothing is committed, published, or built.

The installed executable runs from an outside cwd with NODE_PATH/NODE_OPTIONS
cleared. A loopback-only CDP probe reads the real preload data APIs and requests
normal application close. It does not click controls or claim visual acceptance.
Each installed-app probe reopens the same isolated retained profile. Logical
hashes must remain stable across normal saving and later application launches.
After each independently joined normal exit, a recorded ciphertext baseline is
refreshed because saving can re-encrypt unchanged plaintext. NSIS operations
must preserve that complete latest profile byte-for-byte while it is closed.

An optional BaselineInstaller tests an actual historical installation before
upgrading to the candidate. Its version must match sourceAppVersion. Without
that input, historical migration is explicitly untested.

ResumeReport continues from a recorded same-version overlay that was stopped by
the product process guard before uninstall. Supply the original installer,
baseline, fixture, host backup, and packed source manifest. The preflight reads
and verifies the original evidence before changing the owned installation.
.EXAMPLE
pwsh -File scripts/qa-install-lifecycle.ps1 -Mode Inspect
.EXAMPLE
pwsh -File scripts/qa-install-lifecycle.ps1 -Mode Run `
  -HostBackupManifest 'D:\qa\protected-host-manifest.json' `
  -FixtureManifest 'D:\qa\manifest.json'
.EXAMPLE
pwsh -File scripts/qa-install-lifecycle.ps1 -Mode Run `
  -HostBackupManifest 'D:\qa\protected-host-manifest.json' `
  -FixtureManifest 'D:\qa\old-manifest.json' `
  -BaselineInstaller 'D:\qa\real-historical-installer.exe'
#>
[CmdletBinding()]
param(
    [ValidateSet('Inspect', 'Run')][string]$Mode = 'Inspect',
    [string]$Installer,
    [string]$BaselineInstaller,
    [string]$FixtureManifest,
    [string]$HostBackupManifest,
    [string]$PackedSourceManifest,
    [string]$ResumeReport,
    [string]$InstallRoot,
    [string]$ExpectedTestUserSid,
    [ValidateRange(30, 1800)][int]$TimeoutSeconds = 1800
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageVersion = [string](Get-Content -LiteralPath (Join-Path $repository 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($packageVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Lifecycle acceptance requires an explicit numeric package version.' }
$evidenceParent = Join-Path $repository ('.preview\qa-' + $packageVersion)
$evidenceDirectory = Join-Path $evidenceParent ('install-evidence-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
if ($ResumeReport) {
    $ResumeReport = [IO.Path]::GetFullPath($ResumeReport)
    $evidenceDirectory = [IO.Path]::GetDirectoryName($ResumeReport)
    if ($Mode -ne 'Run' -or $InstallRoot -or -not $PackedSourceManifest -or
        [IO.Path]::GetFileName($ResumeReport) -cne 'report.json' -or
        [IO.Path]::GetDirectoryName($evidenceDirectory) -ine $evidenceParent -or
        [IO.Path]::GetFileName($evidenceDirectory) -cnotmatch '^install-evidence-\d{8}-\d{6}-[a-f0-9]{8}$') {
        throw 'Resume requires an original lifecycle report inside this version''s QA directory, with its original inputs and no new install root.'
    }
}
$reportPath = Join-Path $evidenceDirectory 'report.json'
$utf8 = New-Object Text.UTF8Encoding($false)
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$applicationId = 'cn.zhixing.office'
$applicationGuid = '8d0162ad-33d7-58a5-95e7-2602977677c3'
$productName = [string]([char]0x77E5) + [char]0x884C
$executableName = $productName + '.exe'
if (-not $Installer) { $Installer = Join-Path $repository ('release\' + $productName + '-' + $packageVersion + '-x64.exe') }

function Get-PropertyValue($Object, [string]$Name, $Default = $null) {
    if ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $Default
}

function Assert-NoReparsePath([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Reparse path is not permitted for lifecycle fixtures or output: $cursor"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor.TrimEnd('\'))
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Assert-InEvidence([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($evidenceDirectory.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Output is outside this run's evidence directory: $resolved"
    }
    Assert-NoReparsePath $resolved
    return $resolved
}

function Assert-InOwnedInstall([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    $ownedRoot = [IO.Path]::GetFullPath($installDirectory).TrimEnd('\')
    $shortParent = [IO.Path]::GetFullPath((Join-Path $repository '.preview\i QA')).TrimEnd('\')
    $inThisEvidence = $ownedRoot.StartsWith($evidenceDirectory.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
    $inShortNamespace = [IO.Path]::GetDirectoryName($ownedRoot) -ieq $shortParent
    if (-not $inThisEvidence -and -not $inShortNamespace) { throw 'Owned install root is outside the authorized QA namespaces.' }
    if ($resolved -ine $ownedRoot -and -not $resolved.StartsWith($ownedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Installation operation escapes this run''s exact owned root.'
    }
    Assert-NoReparsePath $resolved
    return $resolved
}

function Write-JsonFile([string]$Path, $Value) {
    [void](Assert-InEvidence $Path)
    [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 35), $utf8)
}

function Get-Asset([string]$Path) {
    $file = Get-Item -LiteralPath ([IO.Path]::GetFullPath($Path))
    if ($file.PSIsContainer) { throw "Installer must be a file: $Path" }
    return [ordered]@{
        path = $file.FullName
        bytes = $file.Length
        sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        productVersion = $file.VersionInfo.ProductVersion
        fileVersion = $file.VersionInfo.FileVersion
        modifiedAt = $file.LastWriteTimeUtc.ToString('o')
    }
}

function Assert-AssetIdentity($Expected, $Actual, [string]$Description) {
    foreach ($field in @('path', 'bytes', 'sha256', 'productVersion', 'fileVersion')) {
        Assert-Identical $Expected.$field $Actual.$field "$Description ($field)"
    }
}

function Get-ProductRegistry {
    $result = @()
    foreach ($hive in @('HKEY_CURRENT_USER', 'HKEY_LOCAL_MACHINE')) {
        foreach ($viewPrefix in @('Software', 'Software\WOW6432Node')) {
            foreach ($suffix in @($applicationGuid, ('Microsoft\Windows\CurrentVersion\Uninstall\' + $applicationGuid))) {
                $key = "Registry::$hive\$viewPrefix\$suffix"
                $exists = Test-Path -LiteralPath $key
                $properties = $null
                if ($exists) {
                    $properties = Get-ItemProperty -LiteralPath $key |
                        Select-Object InstallLocation, DisplayName, DisplayVersion, UninstallString, ShortcutName
                }
                $result += [ordered]@{ path = $key; exists = $exists; properties = $properties }
            }
        }
    }
    return $result
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

function Get-ProductProcesses {
    $result = @()
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='$executableName'")) {
        $ownerSid = $null
        try {
            $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid -ErrorAction Stop
            if ($owner.ReturnValue -eq 0) { $ownerSid = $owner.Sid }
        } catch { }
        $result += [ordered]@{
            pid = $process.ProcessId; parentPid = $process.ParentProcessId
            path = $process.ExecutablePath; ownerSid = $ownerSid
            conflictsWithTestAccount = (-not $ownerSid -or $ownerSid -eq $currentSid)
        }
    }
    return $result
}

function Get-EnvironmentSnapshot {
    return [ordered]@{
        registry = @(Get-ProductRegistry)
        shortcuts = @(Get-ProductShortcuts)
        processes = @(Get-ProductProcesses)
        defaultData = @($productName, 'office-agent') | ForEach-Object {
            $directory = Join-Path $env:APPDATA $_
            [ordered]@{ path = $directory; exists = (Test-Path -LiteralPath $directory) }
        }
    }
}

function Get-TreeHashes([string]$Root) {
    Assert-NoReparsePath $Root
    $rootPath = (Get-Item -LiteralPath $Root -Force).FullName.TrimEnd('\')
    $items = @(Get-ChildItem -LiteralPath $rootPath -Recurse -Force)
    foreach ($item in $items) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Fixture includes a reparse point: $($item.FullName)" }
    }
    return @($items | Where-Object { -not $_.PSIsContainer } | Sort-Object FullName | ForEach-Object {
        [ordered]@{
            relativePath = $_.FullName.Substring($rootPath.Length + 1).Replace('\', '/')
            bytes = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    })
}

function Assert-Identical($Expected, $Actual, [string]$Description) {
    $left = ConvertTo-Json -InputObject $Expected -Depth 30 -Compress
    $right = ConvertTo-Json -InputObject $Actual -Depth 30 -Compress
    if ($left -cne $right) { throw "Preservation check failed: $Description" }
}

function Copy-FixtureTree([string]$Source, [string]$Destination) {
    [void](Assert-InEvidence $Destination)
    [void](Get-TreeHashes $Source)
    [void](New-Item -ItemType Directory -Path $Destination)
    foreach ($item in @(Get-ChildItem -LiteralPath $Source -Force)) {
        Copy-Item -LiteralPath $item.FullName -Destination $Destination -Recurse
    }
}

function Save-Report {
    $report.updatedAt = (Get-Date).ToString('o')
    Write-JsonFile $reportPath $report
}

function Add-Step([string]$Name, [string]$Status, $Details) {
    $report.steps += [ordered]@{ name = $Name; status = $Status; time = (Get-Date).ToString('o'); details = $Details }
    Save-Report
}

function Start-OwnedProcess([string]$File, [string]$Arguments, [string]$Cwd, [switch]$RunAsNode) {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $File
    $start.Arguments = $Arguments
    $start.WorkingDirectory = $Cwd
    $start.UseShellExecute = $false
    $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    foreach ($name in @('NODE_PATH', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE')) { $start.EnvironmentVariables.Remove($name) }
    if ($RunAsNode) { $start.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1' }
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    [void]$process.Start()
    # Hold the Windows process handle before waiting. An attached Process with
    # a lazy handle can lose its exit status once Windows reaps the PID.
    [void]$process.Handle
    return $process
}

function Invoke-ObservedProcess([string]$File, [string]$Arguments, [string]$Cwd, [string]$Label, [switch]$RunAsNode) {
    $start = Get-Date
    $process = Start-OwnedProcess $File $Arguments $Cwd -RunAsNode:$RunAsNode
    $script:activeObservedProcess = $process
    Add-Step ($Label + '-started') 'observed' @{ pid = $process.Id; file = $File; arguments = $Arguments; cwd = $Cwd }
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        throw "$Label timed out. Process $($process.Id) was not killed. Do not run another installer until it is investigated."
    }
    if ($null -eq $process.ExitCode) { throw "$Label exit code was not observed." }
    $details = @{ pid = $process.Id; exitCode = $process.ExitCode; elapsedSeconds = [math]::Round(((Get-Date) - $start).TotalSeconds, 2) }
    Add-Step $Label $(if ($process.ExitCode -eq 0) { 'passed' } else { 'failed' }) $details
    $script:activeObservedProcess = $null
    if ($process.ExitCode -ne 0) { throw "$Label exited with code $($process.ExitCode)." }
}

function Assert-NoExistingProductProcess {
    $active = @(Get-ProductProcesses | Where-Object { $_.conflictsWithTestAccount })
    if ($active.Count) { throw 'An existing product process is still running. Wait for its owner to finish and close it normally. No process was stopped.' }
}

function Assert-ProtectedHostBytes([string]$Label) {
    foreach ($item in @($protectedHost.defaultData)) {
        $exists = Test-Path -LiteralPath $item.source
        if ($exists -ne $item.existed) { throw "Original default-data existence changed during $Label." }
        if ($exists) { Assert-Identical @($item.files) @(Get-TreeHashes $item.source) ("original default-data bytes during $Label") }
    }
    Add-Step ($Label + '-original-default-data') 'passed' @{ byteHashesUnchanged = $true; plaintextDecrypted = $false }
}

function Read-ProtectedHostBackup([switch]$OwnedInstallation) {
    if (-not $HostBackupManifest) { throw 'HostBackupManifest is required for reversible same-account installation testing.' }
    $backup = Get-Content -LiteralPath $HostBackupManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($backup.schemaVersion -ne 1 -or $backup.plaintextDecryptionPerformed -ne $false) { throw 'Unexpected host byte-backup manifest.' }
    $allowedRoots = @((Join-Path $env:APPDATA $productName), (Join-Path $env:APPDATA 'office-agent'))
    if (@($backup.defaultData).Count -ne $allowedRoots.Count) { throw 'Both NSIS default-data destinations must be represented in the backup.' }
    foreach ($item in @($backup.defaultData)) {
        $root = [IO.Path]::GetFullPath($item.source)
        if ($root -notin $allowedRoots) { throw 'Host backup points outside the two known NSIS default-data destinations.' }
        Assert-NoReparsePath $root
        if ($item.existed) {
            Assert-Identical @($item.files) @(Get-TreeHashes $item.backup) 'protected default-data backup integrity'
            Assert-Identical @($item.files) @(Get-TreeHashes $root) 'default data still matches the cold backup'
        } elseif (Test-Path -LiteralPath $root) { throw 'A previously absent default-data destination now exists. Refresh the host snapshot before testing.' }
    }
    $currentLinks = @(Get-ProductShortcuts)
    if (-not $OwnedInstallation -and $currentLinks.Count -ne @($backup.shortcuts).Count) { throw 'Shortcut inventory differs from its byte backup.' }
    foreach ($item in @($backup.shortcuts)) {
        $current = @($currentLinks | Where-Object { $_.path -ieq $item.source })
        if (-not $OwnedInstallation -and ($current.Count -ne 1 -or $current[0].sha256 -ne $item.sha256)) { throw 'Original shortcut changed after backup.' }
        if ((Get-FileHash -LiteralPath $item.backup -Algorithm SHA256).Hash -ne $item.sha256) { throw 'Original shortcut byte backup is invalid.' }
    }
    if (-not $OwnedInstallation) { Write-JsonFile (Join-Path $evidenceDirectory 'protected-host-manifest.json') $backup }
    return $backup
}

function Restore-ProtectedHost {
    # A failed run may leave a candidate process in its explicit synthetic
    # profile. Never terminate it, and never restore a potentially active real
    # default profile. The normal path reaches this only after all tests close.
    Assert-NoExistingProductProcess
    foreach ($item in @($protectedHost.defaultData)) {
        $root = [IO.Path]::GetFullPath($item.source)
        $allowedRoots = @((Join-Path $env:APPDATA $productName), (Join-Path $env:APPDATA 'office-agent'))
        if ($root -notin $allowedRoots) { throw 'Restoration destination is outside the verified original data roots.' }
        Assert-NoReparsePath $root
        $currentFiles = if (Test-Path -LiteralPath $root) { @(Get-TreeHashes $root) } else { @() }
        $expectedFiles = @($item.files)
        $index = 0
        foreach ($file in @($currentFiles)) {
            $expected = @($expectedFiles | Where-Object { $_.relativePath -ceq $file.relativePath })
            if ($expected.Count -eq 1 -and $expected[0].sha256 -eq $file.sha256) { continue }
            $from = [IO.Path]::GetFullPath((Join-Path $root $file.relativePath))
            if (-not $from.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Restoration file escapes the original root.' }
            $quarantine = Assert-InEvidence (Join-Path $evidenceDirectory ('host-changed-file-' + [guid]::NewGuid().ToString('N')))
            Copy-Item -LiteralPath $from -Destination $quarantine
            if (-not $expected.Count) { Remove-Item -LiteralPath $from }
            $index++
        }
        foreach ($file in $expectedFiles) {
            $destination = [IO.Path]::GetFullPath((Join-Path $root $file.relativePath))
            if (-not $destination.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup file escapes the original root.' }
            if ((Test-Path -LiteralPath $destination) -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -eq $file.sha256) { continue }
            [void](New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force)
            Copy-Item -LiteralPath (Join-Path $item.backup $file.relativePath) -Destination $destination -Force
        }
        if (-not $item.existed -and (Test-Path -LiteralPath $root)) {
            # Only empty directories remain. Every computed target is checked
            # against the two explicit AppData roots before nonrecursive delete.
            foreach ($directory in @(Get-ChildItem -LiteralPath $root -Directory -Recurse -Force | Sort-Object { $_.FullName.Length } -Descending)) {
                Assert-NoReparsePath $directory.FullName
                if (-not $directory.FullName.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup directory escaped its original root.' }
                Remove-Item -LiteralPath $directory.FullName -Force
            }
            Remove-Item -LiteralPath $root -Force
        }
    }
    foreach ($link in @(Get-ProductShortcuts)) {
        if (-not $link.target.StartsWith($installDirectory.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
        if (-not @($protectedHost.shortcuts | Where-Object { $_.source -ieq $link.path }).Count) { Remove-Item -LiteralPath $link.path }
    }
    foreach ($link in @($protectedHost.shortcuts)) {
        $currentHash = if (Test-Path -LiteralPath $link.source) { (Get-FileHash -LiteralPath $link.source -Algorithm SHA256).Hash } else { $null }
        if ($currentHash -ne $link.sha256) { Copy-Item -LiteralPath $link.backup -Destination $link.source -Force }
        Assert-Identical $link.sha256 (Get-FileHash -LiteralPath $link.source -Algorithm SHA256).Hash 'restored original shortcut bytes'
    }
    Assert-ProtectedHostBytes 'host-restoration'
    Add-Step 'original-shortcuts-restored' 'passed' @{ count = @($protectedHost.shortcuts).Count; byteHashesUnchanged = $true }
}

function Assert-Installed {
    $entryPath = "Registry::HKEY_CURRENT_USER\Software\$applicationGuid"
    if (-not (Test-Path -LiteralPath $entryPath)) { throw 'Per-user installation registration is missing.' }
    $entry = Get-ItemProperty -LiteralPath $entryPath
    if ([IO.Path]::GetFullPath($entry.InstallLocation).TrimEnd('\') -ine $installDirectory.TrimEnd('\')) {
        throw 'NSIS installed outside the owned test destination. Further installation operations are blocked.'
    }
    if (-not (Test-Path -LiteralPath $installedExe)) { throw 'Installed application executable is missing.' }
    foreach ($key in @(Get-ProductRegistry | Where-Object { $_.exists -and $_.path -like '*HKEY_LOCAL_MACHINE*' })) {
        throw "Unexpected machine-wide registration: $($key.path)"
    }
    foreach ($link in @(Get-ProductShortcuts)) {
        if ([IO.Path]::GetFullPath($link.target) -ine $installedExe) { throw "Unexpected product shortcut target: $($link.path)" }
    }
}

function Invoke-TestInstall($Asset, [string]$Label) {
    [void](Assert-InOwnedInstall $installDirectory)
    Assert-NoExistingProductProcess
    Assert-Identical $Asset.sha256 (Get-Asset $Asset.path).sha256 'installer bytes before execution'
    $upgrade = if (Test-Path -LiteralPath "Registry::HKEY_CURRENT_USER\Software\$applicationGuid") { ' --updated' } else { '' }
    if ($upgrade) { Assert-Installed }
    Invoke-ObservedProcess $Asset.path ("/S /currentuser --no-desktop-shortcut$upgrade /D=$installDirectory") $outsideDirectory $Label
    Assert-Installed
    Assert-ProtectedHostBytes $Label
    $installed = Get-Asset $installedExe
    $installedPackage = Get-Content -LiteralPath (Join-Path $installDirectory 'resources\app\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($installed.fileVersion -ne $Asset.fileVersion -or $installedPackage.version -ne $Asset.productVersion) { throw 'Installed executable/package version differs from installer version.' }
    Add-Step ($Label + '-registration') 'passed' @{ installedExecutable = $installed; registry = @(Get-ProductRegistry); shortcuts = @(Get-ProductShortcuts) }
    if ($PackedSourceManifest -and $Asset.productVersion -eq $packageVersion) {
        $appRoot = [IO.Path]::GetFullPath((Join-Path $installDirectory 'resources\app')).TrimEnd('\')
        foreach ($file in @($packedIdentity.files)) {
            $target = [IO.Path]::GetFullPath((Join-Path $appRoot $file.file))
            if (-not $target.StartsWith($appRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Source identity path escapes the installed application.' }
            Assert-NoReparsePath $target
            if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ine $file.sha256) { throw "Installed source differs from the tested directory: $($file.file)" }
        }
        $provenance = Get-Content -LiteralPath (Join-Path $appRoot 'build-provenance.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($provenance.sourceDirty -ne $false -or $provenance.sourceCommit -ne $packedIdentity.sourceCommit -or $provenance.lockSha256 -ne $packedIdentity.lockSha256) { throw 'Installed source provenance differs from the tested directory.' }
        Add-Step ($Label + '-tested-source-identity') 'passed' @{ matchedFiles = @($packedIdentity.files).Count; sourceFingerprint = $packedIdentity.sourceFingerprint; sourceCommit = $provenance.sourceCommit; lockSha256 = $provenance.lockSha256 }
    }
}

function Assert-NoOwnedApplication {
    $owned = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installDirectory.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
    })
    if ($owned.Count) { throw 'A process from the test install is still running. Upgrade/uninstall is blocked.' }
}

function Invoke-TestUninstall([string]$Label) {
    Assert-Installed
    Assert-NoOwnedApplication
    Assert-NoExistingProductProcess
    $uninstallKey = "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\$applicationGuid"
    $entry = Get-ItemProperty -LiteralPath $uninstallKey
    if ($entry.UninstallString -notmatch '^"([^"]+)"') { throw 'Unexpected uninstaller registration format.' }
    $uninstaller = [IO.Path]::GetFullPath($Matches[1])
    [void](Assert-InOwnedInstall $uninstaller)
    if ([IO.Path]::GetDirectoryName($uninstaller) -ine $installDirectory) { throw 'Uninstaller is outside the owned install directory.' }
    $copy = Assert-InEvidence (Join-Path $evidenceDirectory ($Label + '.exe'))
    Copy-Item -LiteralPath $uninstaller -Destination $copy
    # NSIS _?= must be last and unquoted. The copy is outside $INSTDIR.
    # Omit --delete-app-data and KEEP_APP_DATA so default retention is tested.
    # Keep Shell state for the same appId. Restore the byte-backed original
    # shortcuts ourselves after the official uninstaller removes its files/key.
    Invoke-ObservedProcess $copy ("/S /currentuser --keep-shortcuts _?=$installDirectory") $outsideDirectory $Label
    if (Test-Path -LiteralPath $installedExe) { throw 'Uninstall left the installed application executable in place.' }
    if (@(Get-ProductRegistry | Where-Object { $_.exists }).Count) { throw 'Uninstall left product registration in place.' }
    Restore-ProtectedHost
    Add-Step ($Label + '-registration-removed') 'passed' @{ registry = @(Get-ProductRegistry); shortcuts = @(Get-ProductShortcuts) }
}

Assert-NoReparsePath $evidenceDirectory
[void](New-Item -ItemType Directory -Path $evidenceDirectory -Force)
$report = [ordered]@{
    schemaVersion = 1; startedAt = (Get-Date).ToString('o'); updatedAt = $null
    mode = $Mode; status = 'inspecting'; repository = $repository
    sourceHead = (& git -C $repository rev-parse HEAD | Out-String).Trim()
    sourceStatus = @(& git -C $repository status --short)
    windowsVersion = [Environment]::OSVersion.VersionString
    currentUserSid = $currentSid; appId = $applicationId; appGuid = $applicationGuid
    candidate = $null; baselineInstaller = $null; environmentBefore = $null; blockers = @(); steps = @()
    coverage = [ordered]@{
        firstInstall = 'not_run'; sameVersionOverlay = 'not_run'; historicalUpgrade = 'not_run'
        uninstallRetention = 'not_run'; reinstallRetention = 'not_run'; outsideCwdStartup = 'not_run'
        projectHashes = 'not_run'; chatHashes = 'not_run'; draftHashes = 'not_run'; encryptedConfigHashes = 'not_run'
        visualAcceptance = 'outside_scope'; crossWindowsUserDecryption = 'outside_scope'
    }
}

try {
    $report.candidate = Get-Asset $Installer
    if ($report.candidate.productVersion -ne $packageVersion) { throw 'Candidate version does not match package.json.' }
    if ($PackedSourceManifest) {
        $packedIdentity = Get-Content -LiteralPath $PackedSourceManifest -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($packedIdentity.version -ne $packageVersion -or -not @($packedIdentity.files).Count) { throw 'Source identity manifest does not describe this candidate.' }
    }
    if ($BaselineInstaller) { $report.baselineInstaller = Get-Asset $BaselineInstaller }
    $configuration = Get-Content -LiteralPath (Join-Path $repository 'electron-builder.yml') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($configuration.appId -ne $applicationId -or $configuration.productName -ne $productName) { throw 'Installer identity assumptions no longer match electron-builder.yml.' }
    if ((Get-PropertyValue $configuration.nsis 'guid' $applicationGuid) -ne $applicationGuid) { throw 'Configured NSIS GUID changed. Reinspect installer identity.' }
    if ((Get-PropertyValue $configuration.nsis 'deleteAppDataOnUninstall' $false) -eq $true) { throw 'Configured uninstall now deletes app data. Reinspect before running.' }
    if ((Get-PropertyValue $configuration.nsis 'perMachine' $false) -eq $true) { throw 'Machine-wide installer is outside this test isolation contract.' }
    $resumeValidated = $false
    if ($ResumeReport) {
        [void](Assert-InEvidence $ResumeReport)
        Assert-NoExistingProductProcess
        $previous = Get-Content -LiteralPath $ResumeReport -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
        if ($previous.schemaVersion -ne 1 -or $previous.status -ne 'failed_or_incomplete' -or
            $previous.repository -ine $repository -or $previous.currentUserSid -ne $currentSid -or
            $previous.appGuid -ne $applicationGuid -or
            $previous.error -notlike 'An existing product process is still running.*' -or
            $previous.failureCleanup -notlike 'Needs investigation without killing any process: An existing product process is still running.*' -or
            $previous.coverage.sameVersionOverlay -ne 'passed' -or $previous.coverage.firstInstall -ne 'passed' -or
            $previous.coverage.historicalUpgrade -ne 'passed_same_account_fixture_only' -or $previous.coverage.uninstallRetention -ne 'not_run' -or
            $previous.steps[-1].name -ne 'same-version-overlay-normal-save-byte-baseline') {
            throw 'The prior report does not describe a protected stop immediately before uninstall.'
        }
        Assert-AssetIdentity $previous.candidate $report.candidate 'resumed candidate installer'
        Assert-AssetIdentity $previous.baselineInstaller $report.baselineInstaller 'resumed baseline installer'
        $originalBackup = Assert-InEvidence (Join-Path $evidenceDirectory 'protected-host-manifest.json')
        $originalBackupData = Get-Content -LiteralPath $originalBackup -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
        $providedBackupData = Get-Content -LiteralPath $HostBackupManifest -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
        Assert-Identical $originalBackupData $providedBackupData 'resumed protected host backup'
        $installDirectory = $previous.installDirectory
        [void](Assert-InOwnedInstall $installDirectory)
        $installedExe = Join-Path $installDirectory $executableName
        Assert-Installed
        $installedAsset = Get-Asset $installedExe
        $recordedAsset = @($previous.steps | Where-Object name -EQ 'same-version-overlay-registration')[0].details.installedExecutable
        Assert-AssetIdentity $recordedAsset $installedAsset 'resumed installed executable'
        $appRoot = [IO.Path]::GetFullPath((Join-Path $installDirectory 'resources\app')).TrimEnd('\')
        foreach ($file in @($packedIdentity.files)) {
            $target = [IO.Path]::GetFullPath((Join-Path $appRoot $file.file))
            if (-not $target.StartsWith($appRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'A source manifest path escapes the application.' }
            [void](Assert-InOwnedInstall $target)
            if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ine $file.sha256) { throw 'Resumed installed sources differ from the candidate.' }
        }
        $protectedHost = Read-ProtectedHostBackup -OwnedInstallation
    } else {
    $report.environmentBefore = Get-EnvironmentSnapshot
    $report.blockers = @(
        if (@($report.environmentBefore.registry | Where-Object { $_.exists }).Count) { 'Existing same-identity install/uninstall registration.' }
        if (@($report.environmentBefore.processes | Where-Object { $_.conflictsWithTestAccount }).Count) { 'Existing product processes must finish and close normally before installation, as requested by their owner.' }
    )
    Add-Step 'environment-inspection' 'observed' @{ blockers = $report.blockers; noProductWritesPerformed = $true }
    if ($Mode -eq 'Inspect') {
        $report.status = if ($report.blockers.Count) { 'waiting_existing_processes_or_registration' } else { 'ready_for_same_account_backed_up_run' }
        Save-Report
        Write-Output "Inspection saved to $reportPath"
        return
    }
    if ($report.blockers.Count) { throw ($report.blockers -join ' ') }
    $protectedHost = Read-ProtectedHostBackup
    }
    if ($ExpectedTestUserSid -and $ExpectedTestUserSid -ne $currentSid) { throw 'Expected fixture owner SID does not match the current Windows account.' }
    if (-not $FixtureManifest) { throw 'A same-account synthetic fixture manifest is required.' }
    $fixture = Get-Content -LiteralPath $FixtureManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($fixture.schemaVersion -ne 1 -or $fixture.synthetic -ne $true -or $fixture.noRealCredentials -ne $true -or $fixture.noEnabledAutomations -ne $true) {
        throw 'Fixture must explicitly attest synthetic data, no real credentials, and no enabled automations.'
    }
    if ($fixture.creatorSid -ne $currentSid) { throw 'Fixture belongs to a different Windows SID. Recreate it under the test account.' }
    $initialAsset = if ($report.baselineInstaller) { $report.baselineInstaller } else { $report.candidate }
    if ($fixture.sourceAppVersion -ne $initialAsset.productVersion) { throw 'Fixture source version does not match the initial installer.' }
    $fixture | Add-Member -NotePropertyName candidateVersion -NotePropertyValue $packageVersion -Force
    foreach ($name in @('projectPaths', 'expectedProjectIds', 'expectedChatIds', 'expectedDraftKeys', 'expectedEncryptedFiles')) {
        if ($null -eq $fixture.PSObject.Properties[$name]) { throw "Fixture manifest is missing $name." }
    }
    if (-not @($fixture.expectedProjectIds).Count -or -not @($fixture.expectedChatIds).Count) {
        throw 'At least one synthetic project record and chat are required.'
    }
    if (-not @($fixture.expectedEncryptedFiles | Where-Object { $_ -match '^zhixing[/\\](mcp|providers)\.bin$' }).Count) {
        throw 'Fixture must contain encrypted MCP or provider configuration in addition to workspace.bin.'
    }
    $sourceProfile = (Get-Item -LiteralPath $fixture.profilePath).FullName
    Assert-NoReparsePath $sourceProfile
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='$executableName'")) {
        if ($process.CommandLine -and $process.CommandLine.IndexOf($sourceProfile, [StringComparison]::OrdinalIgnoreCase) -ge 0) { throw 'Source fixture profile is still open.' }
    }
    foreach ($relativePath in @($fixture.expectedEncryptedFiles) + @('zhixing/workspace.bin')) {
        $file = [IO.Path]::GetFullPath((Join-Path $sourceProfile $relativePath))
        if (-not $file.StartsWith($sourceProfile.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture encrypted file escapes the source profile.' }
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Fixture encrypted file is missing: $relativePath" }
    }
    $profileDirectory = Assert-InEvidence (Join-Path $evidenceDirectory 'retained-profile')
    $outsideDirectory = Assert-InEvidence (Join-Path $evidenceDirectory 'outside cwd')
    $sourceHashes = @(Get-TreeHashes $sourceProfile)
    $projectHashes = @($fixture.projectPaths | ForEach-Object { [ordered]@{ root = $_; files = @(Get-TreeHashes $_) } })
    $probeFile = Assert-InEvidence (Join-Path $evidenceDirectory 'read-profile.cjs')
    if ($ResumeReport) {
        $savedFixture = Get-Content -LiteralPath (Assert-InEvidence (Join-Path $evidenceDirectory 'fixture-manifest.json')) -Raw -Encoding UTF8 | ConvertFrom-Json
        Assert-Identical $savedFixture $fixture 'resumed synthetic fixture manifest'
        $priorSource = @(Get-Content -LiteralPath (Assert-InEvidence (Join-Path $evidenceDirectory 'retained-profile-before.json')) -Raw -Encoding UTF8 | ConvertFrom-Json)
        $priorProject = @(Get-Content -LiteralPath (Assert-InEvidence (Join-Path $evidenceDirectory 'synthetic-projects-before.json')) -Raw -Encoding UTF8 | ConvertFrom-Json)
        $profileHashes = @(Get-Content -LiteralPath (Assert-InEvidence (Join-Path $evidenceDirectory 'same-version-overlay-after-normal-close-profile.json')) -Raw -Encoding UTF8 | ConvertFrom-Json)
        Assert-Identical $priorSource $sourceHashes 'resumed original synthetic profile'
        Assert-Identical $priorProject $projectHashes 'resumed synthetic project bytes'
        Assert-Identical $profileHashes @(Get-TreeHashes $profileDirectory) 'resumed settled profile bytes'
        $baselineRead = Get-Content -LiteralPath (Assert-InEvidence (Join-Path $evidenceDirectory 'same-version-overlay-logical.json')) -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($baselineRead.appVersion -ne $packageVersion) { throw 'Resumed probe version is incorrect.' }
        $priorReportPath = Assert-InEvidence (Join-Path $evidenceDirectory 'report-before-resume.json')
        if (Test-Path -LiteralPath $priorReportPath) { throw 'An earlier resume is already recorded.' }
        Copy-Item -LiteralPath $ResumeReport -Destination $priorReportPath
        $report = $previous
        $report.status = 'running'
        [void]$report.Remove('error')
        [void]$report.Remove('failureCleanup')
        $resumeValidated = $true
        Add-Step 'lifecycle-resumed-before-uninstall' 'observed' @{ priorReport = 'report-before-resume.json'; reason = 'A separate QA product process completed normally.'; sourceAndFixtureRechecked = $true }
    } else {
    $installDirectory = if ($InstallRoot) { [IO.Path]::GetFullPath($InstallRoot) }
        else { Join-Path $repository ('.preview\i QA\' + $productName + '-' + [guid]::NewGuid().ToString('N').Substring(0, 4)) }
    [void](Assert-InOwnedInstall $installDirectory)
    if (Test-Path -LiteralPath $installDirectory) { throw 'The new owned install destination already exists. Do not overwrite a previous run or unrelated directory.' }
    $report.installDirectory = $installDirectory
    $installedExe = Join-Path $installDirectory $executableName
    [void](New-Item -ItemType Directory -Path $outsideDirectory)
    Copy-FixtureTree $sourceProfile $profileDirectory
    Assert-Identical $sourceHashes @(Get-TreeHashes $sourceProfile) 'source profile stable while copying'
    Assert-Identical $sourceHashes @(Get-TreeHashes $profileDirectory) 'copied profile bytes'
    $profileHashes = @(Get-TreeHashes $profileDirectory)
    Write-JsonFile (Join-Path $evidenceDirectory 'retained-profile-before.json') $profileHashes
    Write-JsonFile (Join-Path $evidenceDirectory 'synthetic-projects-before.json') $projectHashes
    Write-JsonFile (Join-Path $evidenceDirectory 'fixture-manifest.json') $fixture

    }
    $probeCode = @'
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const [profile, manifestFile, outputFile, action = 'read'] = process.argv.slice(2);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function hash(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
(async () => {
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  let target;
  for (let retry = 0; retry < 180; retry++) {
    try {
      const port = Number((await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid owned debugging port');
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) }).then(response => response.json());
      target = targets.find(item => item.type === 'page' && item.url === 'zhixing://app/index.html');
      if (target) break;
    } catch { }
    await pause(250);
  }
  if (!target) throw Error('Installed app did not expose its expected local renderer');
  const endpoint = new URL(target.webSocketDebuggerUrl);
  if (endpoint.hostname !== '127.0.0.1' || endpoint.protocol !== 'ws:') throw Error('Unexpected debugging endpoint');
  const socket = new WebSocket(endpoint);
  await once(socket, 'open', { signal: AbortSignal.timeout(5000) });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(Error(message.error.message)); else request.resolve(message.result);
  });
  function evaluate(expression, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(Error('Profile API timed out')); }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    }).then(result => {
      if (result.exceptionDetails) throw Error(result.exceptionDetails.text || 'Profile API failed');
      return result.result?.value;
    });
  }
  try {
    for (let retry = 0; retry < 120; retry++) {
      if (await evaluate('Boolean(window.zhixing && document.readyState === "complete")')) break;
      if (retry === 119) throw Error('Application preload did not become ready');
      await pause(250);
    }
    const readExpression = '(async()=>({state:await window.zhixing.loadWorkspace(),mcp:await window.zhixing.listMcp(),runtime:await window.zhixing.runtimeStatus(),automations:await window.zhixing.listAutomations()}))()';
    let snapshot = await evaluate(readExpression);
    let smoke;
    if (action === 'run-smoke') {
      const provider = snapshot.runtime.providers?.[0];
      if (!provider || !['127.0.0.1','localhost','[::1]'].includes(new URL(provider.baseUrl).hostname)) throw Error('Installed Harness smoke requires the authorized loopback provider');
      const mcp = await evaluate('window.zhixing.checkMcp()', 180000);
      if (!Array.isArray(mcp.tools) || !JSON.stringify(mcp.tools).includes('lookup')) throw Error('The installed MCP check did not discover the synthetic lookup tool');
      const options = {sessionId: require('node:crypto').randomUUID(), prompt: 'QA_NORMAL', model: 'zhixing-qa', modelProviderId: provider.id, reasoning: 'high', privacyMode: 'redact', workspaceId: 'office-home', mode: 'office', permission: 'ask', customTerms: []};
      const preparation = await evaluate(`window.zhixing.prepareRun(${JSON.stringify(options)})`, 180000);
      if (!preparation.preparationId || preparation.blocked || preparation.providerId !== provider.id || preparation.model !== options.model || preparation.reasoning !== options.reasoning) throw Error('Installed Harness request preparation did not preserve the explicit selection');
      const run = {runId: require('node:crypto').randomUUID(), preparationId: preparation.preparationId};
      const result = await evaluate(`window.zhixing.runPrepared(${JSON.stringify(run)})`, 180000);
      if (!result.text?.includes('QA_NORMAL_RESPONSE')) throw Error('The actual installed Harness run did not return QA_NORMAL_RESPONSE');
      smoke = {status: 'passed_actual_installed_harness_and_mcp', sessionId: options.sessionId, runId: run.runId, requestedModel: options.model, requestedEffort: options.reasoning, providerId: provider.id, loopbackOnly: true, mcpToolCount: mcp.tools.length, mcpLookupDiscovered: true, normalResponseObserved: true, sourceFixtureModified: false};
    }
    if (action === 'create-drafts') {
      if (snapshot.runtime.appVersion !== manifest.candidateVersion) throw Error('Drafts may only be generated after the actual candidate upgrade');
      const state = snapshot.state;
      const workspaceId = state.workspaceId;
      const projects = state.projects.filter(project => project.workspaceId === workspaceId && !['office-general','government-general'].includes(project.id)).slice(0, 3);
      const scopes = [null, ...projects.map(project => project.id)];
      const keys = [];
      state.drafts = {...state.drafts};
      scopes.forEach((projectId, index) => {
        const draftId = `qa-v${manifest.candidateVersion.replaceAll('.', '')}-retention-${index}`;
        const key = `new:${workspaceId}:${projectId || 'home'}:${draftId}`;
        state.drafts[key] = {draftId,kind:'new',workspaceId,projectId,chatId:null,revision:1,text:`\u5347\u7ea7\u540e${manifest.candidateVersion}\u5408\u6210\u4e2d\u6587\u8349\u7a3f ${index + 1}`,files:[],updatedAt:Date.now()};
        keys.push(key);
      });
      if (keys.length !== 4) throw Error('The historical fixture needs three custom projects for four new-version draft scopes');
      await evaluate(`window.zhixing.saveWorkspace(${JSON.stringify(state)})`);
      try { await evaluate('location.reload(); true'); } catch { }
      let loaded = false;
      for (let retry = 0; retry < 120; retry++) {
        try {
          if (await evaluate('Boolean(window.zhixing && document.readyState === "complete" && document.querySelector("textarea"))')) {
            snapshot = await evaluate(readExpression);
            if (keys.every(key => snapshot.state?.drafts?.[key]?.text)) { loaded = true; break; }
          }
        } catch { }
        await pause(100);
      }
      if (!loaded) throw Error('New-version drafts did not load after saving and reloading');
      manifest.expectedDraftKeys = keys;
      await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    }
    const state = snapshot.state;
    if (!state || state.settings?.persist !== true) throw Error('Synthetic persistent workspace was not readable');
    if (state.automations?.some(item => item.enabled) || snapshot.automations?.tasks?.some(item => item.enabled)) throw Error('Enabled automation found in fixture');
    function records(ids, values, key = 'id') {
      return ids.map(id => {
        const record = values.find(value => value[key] === id);
        if (!record) throw Error('Expected synthetic record is missing');
        return record;
      });
    }
    const projects = records(manifest.expectedProjectIds, state.projects);
    const chats = records(manifest.expectedChatIds, state.chats);
    if (!chats.some(chat => chat.messages?.length) || chats.some(chat => chat.messages?.some(message => message.pending))) throw Error('Fixture needs synthetic history and no pending messages');
    const draftKeys = action === 'read-no-drafts' ? [] : manifest.expectedDraftKeys;
    const drafts = draftKeys.map(key => {
      const draft = state.drafts?.[key];
      if (!draft || typeof draft.text !== 'string' || !Array.isArray(draft.files)) throw Error('Expected synthetic draft record is missing');
      // 0.12.1 adds an attachment generation with the defined legacy default
      // zero. Preserve and compare every old field and any nonzero generation.
      return [key, {...draft, filesRevision: Number.isSafeInteger(draft.filesRevision) ? draft.filesRevision : 0}];
    });
    if (drafts.length && !drafts.some(([, draft]) => draft.text.length || draft.files.length)) throw Error('Fixture has no retained draft content');
    const providers = snapshot.runtime.providers || [];
    if (Number.isInteger(manifest.expectedProviderCount) && providers.length !== manifest.expectedProviderCount) throw Error('Encrypted provider configuration did not restore its expected records');
    if (Number.isInteger(manifest.expectedMcpCount) && snapshot.mcp.length !== manifest.expectedMcpCount) throw Error('Encrypted MCP configuration did not restore its expected records');
    // Older versions omit this public status flag. Compare its effective false
    // default, while retaining byte checks on the encrypted provider registry.
    const output = {
      appVersion: snapshot.runtime.appVersion,
      ...(smoke ? {smoke} : {}),
      counts: {
        projects: projects.length, chats: chats.length,
        messages: chats.reduce((count, chat) => count + (chat.messages || []).length, 0),
        drafts: drafts.length,
        draftsWithText: drafts.filter(([, draft]) => draft.text.length).length,
        draftsWithAttachments: drafts.filter(([, draft]) => draft.files.length).length,
        draftAttachments: drafts.reduce((count, [, draft]) => count + draft.files.length, 0),
        mcp: snapshot.mcp.length, providers: providers.length
      },
      hashes: { projects: hash(projects), chats: hash(chats), drafts: hash(drafts), settings: hash(state.settings), publicMcp: hash(snapshot.mcp.map(server => ({...server, credentialReentryRequired: Boolean(server.credentialReentryRequired)}))), publicProviders: hash(providers.map(provider => ({...provider, credentialReentryRequired: Boolean(provider.credentialReentryRequired)}))) },
      evidenceBoundary: 'Actual preload reads and ciphertext readability. No UI, external account, or visual acceptance.'
    };
    await fs.writeFile(outputFile, JSON.stringify(output, null, 2));
    // Close through the product lifecycle. Do not simulate a successful quit.
    // Older builds destroy the renderer before the close IPC response returns.
    // Return this CDP response first, then request normal product shutdown.
    // The parent independently joins and checks the actual application exit.
    await evaluate('setTimeout(()=>{void window.zhixing.windowControl("close")},100); true');
  } finally { socket.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
'@
    [IO.File]::WriteAllText($probeFile, $probeCode, $utf8)
    $sequence = 0
    function Read-ProfileAt([string]$ProfilePath, [string]$Label, [string]$Action = 'read') {
        Assert-Installed
        Assert-NoOwnedApplication
        # Never trust a copied stale debugging port from fixture generation.
        $portFile = Join-Path $ProfilePath 'DevToolsActivePort'
        if (Test-Path -LiteralPath $portFile) { Remove-Item -LiteralPath $portFile }
        $output = Join-Path $evidenceDirectory ($Label + '-logical.json')
        $appArguments = '--user-data-dir="' + $ProfilePath + '" --remote-debugging-address=127.0.0.1 --remote-debugging-port=0'
        $app = Start-OwnedProcess $installedExe $appArguments $outsideDirectory
        $arguments = '"' + $probeFile + '" "' + $ProfilePath + '" "' + (Join-Path $evidenceDirectory 'fixture-manifest.json') + '" "' + $output + '" ' + $Action
        Invoke-ObservedProcess $installedExe $arguments $outsideDirectory ($Label + '-data-probe') -RunAsNode
        if (-not $app.WaitForExit(45000)) { throw 'Application did not finish normal quit after the read-only data probe.' }
        if ($null -eq $app.ExitCode) { throw 'Application exit code was not observed.' }
        if ($app.ExitCode -ne 0) { throw "Application exited with $($app.ExitCode)." }
        Assert-NoOwnedApplication
        $logical = Get-Content -LiteralPath $output -Raw -Encoding UTF8 | ConvertFrom-Json
        Add-Step ($Label + '-outside-cwd-read-and-close') 'passed' $logical
        return $logical
    }

    function Read-InstalledProfile([string]$Label, [switch]$SkipDrafts) {
        $script:sequence++
        $action = if ($SkipDrafts) { 'read-no-drafts' } else { 'read' }
        $logical = Read-ProfileAt $profileDirectory $Label $action
        $script:profileHashes = @(Get-TreeHashes $profileDirectory)
        Write-JsonFile (Join-Path $evidenceDirectory ($Label + '-after-normal-close-profile.json')) $script:profileHashes
        Add-Step ($Label + '-normal-save-byte-baseline') 'observed' @{ fileCount = $script:profileHashes.Count; reason = 'Real application normal close may re-encrypt unchanged data; subsequent NSIS stages must preserve these settled bytes.' }
        return $logical
    }

    function Assert-Retained([string]$Label) {
        $currentProfileHashes = @(Get-TreeHashes $profileDirectory)
        $currentProjectHashes = @($fixture.projectPaths | ForEach-Object { [ordered]@{ root = $_; files = @(Get-TreeHashes $_) } })
        Write-JsonFile (Join-Path $evidenceDirectory ($Label + '-profile.json')) $currentProfileHashes
        Write-JsonFile (Join-Path $evidenceDirectory ($Label + '-projects.json')) $currentProjectHashes
        Assert-Identical $profileHashes $currentProfileHashes ($Label + ' retained profile ciphertext and files')
        Assert-Identical $projectHashes $currentProjectHashes ($Label + ' synthetic source projects')
        Assert-Identical $sourceHashes @(Get-TreeHashes $sourceProfile) ($Label + ' original fixture profile')
        Add-Step ($Label + '-bytes-preserved') 'passed' @{ profileFileCount = $currentProfileHashes.Count; projectCount = $currentProjectHashes.Count }
    }

    if (-not $ResumeReport) {
    $report.status = 'running'
    Save-Report
    Invoke-TestInstall $initialAsset 'first-install'
    Assert-Retained 'first-install'
    $missingHistoricalDrafts = [bool]$report.baselineInstaller -and -not @($fixture.expectedDraftKeys).Count
    $baselineRead = Read-InstalledProfile 'first-install' -SkipDrafts:$missingHistoricalDrafts
    if ($baselineRead.appVersion -ne $initialAsset.productVersion) { throw 'Initial installed runtime version differs from its installer.' }
    $report.coverage.firstInstall = 'passed'
    $report.coverage.outsideCwdStartup = 'passed'
    if ($report.baselineInstaller) {
        Invoke-TestInstall $report.candidate 'historical-to-candidate-upgrade'
        Assert-Retained 'historical-upgrade'
        $read = Read-InstalledProfile 'historical-upgrade' -SkipDrafts:$missingHistoricalDrafts
        if ($read.appVersion -ne $packageVersion) { throw 'Upgraded runtime version differs from the candidate.' }
        Assert-Identical $baselineRead.hashes $read.hashes 'historical profile project/chat/draft/settings/configuration logical hashes'
        $report.coverage.historicalUpgrade = 'passed_same_account_fixture_only'
        if ($missingHistoricalDrafts) {
            # Older fixtures can lack persisted drafts. Create new candidate
            # drafts only after upgrade and do not claim historical migration.
            $draftRead = Read-ProfileAt $profileDirectory 'create-candidate-drafts' 'create-drafts'
            $fixture = Get-Content -LiteralPath (Join-Path $evidenceDirectory 'fixture-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            $profileHashes = @(Get-TreeHashes $profileDirectory)
            Write-JsonFile (Join-Path $evidenceDirectory 'retained-profile-after-candidate-draft-creation.json') $profileHashes
            $baselineRead = $draftRead
            Add-Step 'new-version-draft-baseline' 'passed' @{ createdByVersion = $draftRead.appVersion; scopeCount = $draftRead.counts.drafts; historicalVersionDraftPersistenceClaimed = $false }
        } else {
            $baselineRead = $read
            Add-Step 'historical-draft-retention' 'passed' @{ sourceVersion = $initialAsset.productVersion; candidateVersion = $packageVersion; scopeCount = $read.counts.drafts; draftsWithAttachments = $read.counts.draftsWithAttachments }
        }
    } else {
        Add-Step 'historical-upgrade' 'not_run' 'No historical installer/profile pair was supplied. Asset presence alone is insufficient.'
    }
    Invoke-TestInstall $report.candidate 'same-version-overlay'
    Assert-Retained 'same-version-overlay'
    $read = Read-InstalledProfile 'same-version-overlay'
    Assert-Identical $baselineRead.hashes $read.hashes 'same-version profile logical hashes'
    $report.coverage.sameVersionOverlay = 'passed'
    }
    Invoke-TestUninstall 'uninstall-default-retention'
    Assert-Retained 'after-uninstall'
    $report.coverage.uninstallRetention = 'passed'
    Invoke-TestInstall $report.candidate 'reinstall'
    Assert-Retained 'after-reinstall'
    $read = Read-InstalledProfile 'reinstall'
    Assert-Identical $baselineRead.hashes $read.hashes 'reinstalled profile logical hashes'
    $report.coverage.reinstallRetention = 'passed'
    $report.coverage.projectHashes = 'passed'
    $report.coverage.chatHashes = 'passed'
    $report.coverage.draftHashes = if (@($fixture.expectedDraftKeys).Count) { 'passed' } else { 'not_covered_fixture_contains_no_drafts' }
    $report.coverage.encryptedConfigHashes = 'passed_ciphertext_retention_and_app_readability'
    Invoke-TestUninstall 'final-test-install-cleanup'
    Assert-Retained 'final-cleanup'
    $report.environmentAfter = Get-EnvironmentSnapshot
    Assert-Identical $report.environmentBefore.registry $report.environmentAfter.registry 'original installation registration footprint'
    Assert-Identical $report.environmentBefore.shortcuts $report.environmentAfter.shortcuts 'original shortcut footprint'
    Assert-Identical $report.environmentBefore.defaultData $report.environmentAfter.defaultData 'default profile existence footprint'
    Assert-Identical $report.candidate.sha256 (Get-Asset $Installer).sha256 'original candidate installer after all stages'
    $report.status = if ($report.coverage.draftHashes -ne 'passed') { 'partial_missing_draft_fixture' }
        elseif (-not $report.baselineInstaller) { 'partial_historical_upgrade_not_run' }
        else { 'passed_configured_nonvisual_lifecycle' }
    Save-Report
    Write-Output "Lifecycle evidence saved to $reportPath"
} catch {
    $failureMessage = $_.Exception.Message
    if ($ResumeReport -and -not (Get-Variable -Name resumeValidated -ValueOnly -ErrorAction SilentlyContinue)) {
        [Console]::Error.WriteLine("Resume preflight rejected: $failureMessage")
        exit 2
    }
    $startedSteps = @($report.steps | ForEach-Object { $_.name })
    $report.status = if ($startedSteps -contains 'first-install-started') { 'failed_or_incomplete' } else { 'blocked_before_install' }
    $report.error = $failureMessage
    $inFlight = Get-Variable -Name activeObservedProcess -ValueOnly -ErrorAction SilentlyContinue
    if ($inFlight -and -not $inFlight.HasExited) {
        $report.failureCleanup = 'Not attempted while an observed process is still running. Join and inspect that exact process before restoring or running another installer.'
    } elseif (($startedSteps -contains 'first-install-started') -and (Get-Variable -Name protectedHost -ErrorAction SilentlyContinue)) {
        try {
            if (Test-Path -LiteralPath "Registry::HKEY_CURRENT_USER\Software\$applicationGuid") { Invoke-TestUninstall 'failure-cleanup' }
            else { Restore-ProtectedHost }
            $report.failureCleanup = 'original bytes and shortcuts restored; failure remains recorded'
        } catch { $report.failureCleanup = 'Needs investigation without killing any process: ' + $_.Exception.Message }
    }
    Save-Report
    [Console]::Error.WriteLine("$($report.error) Evidence: $reportPath")
    exit 2
}
