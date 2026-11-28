# 安装包生命周期手工验收（装 → 升级 → 卸载）

> **前提：必须在一台空白 Windows 机器或干净快照上执行。**
> 这个安装包在已有同 `appId` 安装的机器上会**先卸载旧版本**，然后才装到 `/D` 指定的目录。
> 在一台已经装着知行的机器上执行本文的命令，被卸载的是那台机器上原有的安装，不是 `/D` 指定的目录。

本文给出一条可复现的手工路径：`0.40.0` → `0.43.0` → 卸载，每一步都有可核对的检查点。
自动化等价物是 `scripts/qa-install-lifecycle.ps1`（`-Mode Inspect` / `-Mode Run`），本文用于无法运行该脚本时的人工复核。

## 1. 为什么必须空白机器

安装包的 `appId` 是 `cn.zhixing.office`（`electron-builder.yml:2`）。electron-builder 用
`UUID.v5(appId, 50e065bc-3134-11e6-9bab-38c9862bdaf3)` 生成固定的注册表 GUID
（`node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js:261`），本仓库恒为
`8d0162ad-33d7-58a5-95e7-2602977677c3`（`scripts/qa-install-lifecycle.ps1:112` 也硬编码了同一个值）。

安装器在 `templates/nsis/installSection.nsh:52` 无条件执行 `!insertmacro uninstallOldVersion SHELL_CONTEXT`。
该宏从 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<GUID>` 读出 `UninstallString`
（`templates/nsis/include/installUtil.nsh:155`），只要读到了就执行它：

```
ExecWait '"$uninstallerFileNameTemp" /S /KEEP_APP_DATA $0 _?=$installationDir' $R0
```

也就是说：**只要注册表里存在同 GUID 的卸载项，安装器就会先跑那个卸载器**，`/D` 指定的目录只决定新版本装到哪里。
`scripts/qa-install-lifecycle.ps1` 的脚本注释也写明了这条前提——"Existing same-appId installation registrations
must be absent, so the tested installer cannot select an unrelated registered installation for removal."

所以：**先确认注册表里没有同 GUID 的项，再开始。** 有的话，本文的测试不能用那台机器。

## 2. 机器准备与取证（装之前）

在 PowerShell 里做一次基线取证，结果存文件，后面每一步都拿它对比。

```powershell
$root = 'D:\qa\zx-install'
$guid = '8d0162ad-33d7-58a5-95e7-2602977677c3'
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$installKey   = "HKCU:\Software\$guid"

Test-Path -LiteralPath $root                       # 期望 False
Test-Path -LiteralPath $uninstallKey               # 期望 False（否则本机不能用于本文测试）
Test-Path -LiteralPath $installKey                 # 期望 False
Get-Process | Where-Object ProcessName -like '*知行*'   # 期望空
Get-Service | Where-Object { $_.Name -like '*zhixing*' -or $_.DisplayName -like '*知行*' }  # 期望空
Get-ScheduledTask | Where-Object { $_.TaskName -like '*知行*' -or $_.TaskPath -like '*zhixing*' }  # 期望空
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' | Format-List   # 记下现有项
```

同时记下：`%APPDATA%\知行` 是否存在（用户数据目录，见第 4 节）、开始菜单与桌面是否已有 `知行.lnk`。

## 3. 第一步：装 0.40.0

从 release 取 `ZhiXing-0.40.0-x64.exe`（`https://github.com/daniei-chen/ZhiXing/releases/download/v0.40.0/ZhiXing-0.40.0-x64.exe`）。
NSIS 静默安装：`/S` 在前，`/D=` 必须是**最后一个参数且不加引号**。

```powershell
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath '.\ZhiXing-0.40.0-x64.exe' -ArgumentList "/S /D=$root" -Wait -PassThru
$sw.Stop()
"exit=$($p.ExitCode) seconds=$([math]::Round($sw.Elapsed.TotalSeconds,1))"
```

**检查点 A（装完）**

| 核对项   | 命令                                                                                                                       | 期望                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 目录存在 | `Test-Path $root`                                                                                                          | `True`                                                           |
| 主程序   | `Test-Path "$root\知行.exe"`                                                                                               | `True`                                                           |
| 版本号   | `(Get-Item "$root\知行.exe").VersionInfo.ProductVersion`                                                                   | `0.40.0`                                                         |
| 卸载器   | `Get-ChildItem "$root\Uninstall*.exe"`                                                                                     | 存在                                                             |
| 卸载项   | `Get-ItemProperty $uninstallKey`                                                                                           | `DisplayName` 以 `知行 0.40.0` 开头，`DisplayVersion` = `0.40.0` |
| 安装信息 | `Get-ItemProperty $installKey`                                                                                             | `InstallLocation` = `$root`                                      |
| 快捷方式 | `Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\知行.lnk"`、`Test-Path "$env:USERPROFILE\Desktop\知行.lnk"` | 均 `True`                                                        |
| 进程     | `Get-Process \| Where-Object ProcessName -like '*知行*'`                                                                   | 静默安装后应为空                                                 |

退出码按 NSIS 约定：`0` 表示成功。

## 4. 第二步：造用户数据（不造数据就没法证明"升级保留数据"）

应用把用户数据放在 `%APPDATA%\知行\zhixing`：`electron/main.cjs:4` 执行 `app.setName('知行')`，
`electron/main.cjs:9` 把根目录定为 `path.join(app.getPath('userData'), 'zhixing')`。
`scripts/qa-install-lifecycle.ps1` 里的期望加密文件是 `zhixing/workspace.bin`、`zhixing/mcp.bin`。

最小做法：启动一次应用，建一个项目、发一条消息，然后**正常退出**（数据在退出时落盘）。

```powershell
Start-Process -FilePath "$root\知行.exe"
# 在界面里建一个项目、写一条聊天，然后关闭窗口
```

**检查点 B（造完数据）**

```powershell
$data = Join-Path $env:APPDATA '知行'
Test-Path $data                                  # True
Get-ChildItem -Recurse -Force $data | Select-Object FullName, Length | Format-Table
Get-FileHash "$data\zhixing\workspace.bin" -Algorithm SHA256
```

把 `workspace.bin` 的 SHA256 记下来——升级后要对比它是否**逐字节不变**（或至少仍在、能被新版本读出来）。
同时记下项目/聊天数量，升级后要在界面里看到它们还在。

除了单个文件，再对整个数据目录算一次**整树摘要**，升级前后对比。用下面这个函数（按相对路径排序、
逐文件算 SHA256，再对清单整体算一次，结果稳定）：

```powershell
function Get-TreeHash([string]$Path) {
  $lines = Get-ChildItem -LiteralPath $Path -Recurse -File -Force | ForEach-Object {
    [pscustomobject]@{
      Rel  = $_.FullName.Substring($Path.Length).TrimStart('\')
      Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
  } | Sort-Object Rel | ForEach-Object { '{0}  {1}' -f $_.Hash, $_.Rel }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  [BitConverter]::ToString(
    [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
  ).Replace('-','')
}

Get-TreeHash (Join-Path $env:APPDATA '知行\zhixing')
```

记下这个值。升级后用同一个函数再算一次，两个值应当相同。

## 5. 第三步：升级到 0.43.0

```powershell
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath '.\ZhiXing-0.43.0-x64.exe' -ArgumentList "/S /D=$root" -Wait -PassThru
$sw.Stop()
"exit=$($p.ExitCode) seconds=$([math]::Round($sw.Elapsed.TotalSeconds,1))"
```

升级时安装器会先跑旧版本的卸载器，命令行形如
`"<旧目录>\Uninstall 知行.exe" /S /KEEP_APP_DATA /currentuser --keep-shortcuts --updated _?=<旧目录>`
（拼接逻辑在 `installUtil.nsh:193-207`，执行在 `:224`）。这里**没有** `--delete-app-data`，
所以用户数据不会被删——原因见第 7 节「别被参数名骗了」。

**检查点 C（升完）**

| 核对项         | 期望                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ |
| 版本号         | `(Get-Item "$root\知行.exe").VersionInfo.ProductVersion` = `0.43.0`                  |
| 卸载项         | `DisplayVersion` = `0.43.0`，`UninstallString` 指向新目录                            |
| 用户数据还在   | `%APPDATA%\知行\zhixing\workspace.bin` 存在，SHA256 与检查点 B 一致                  |
| 用户数据整树   | `Get-TreeHash (Join-Path $env:APPDATA '知行\zhixing')` 与升级前相同（方法见第 4 节） |
| 界面里数据还在 | 启动应用，项目和聊天都在，能打开                                                     |
| 快捷方式       | 仍指向 `$root\知行.exe`                                                              |
| 进程           | 无残留进程                                                                           |

## 6. 第四步：卸载

卸载器在安装目录里，名字是 `Uninstall 知行.exe`。

```powershell
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath "$root\Uninstall 知行.exe" -ArgumentList '/S' -Wait -PassThru
$sw.Stop()
"exit=$($p.ExitCode) seconds=$([math]::Round($sw.Elapsed.TotalSeconds,1))"
```

**检查点 D（卸完）**

| 核对项       | 命令                                                               | 期望                                |
| ------------ | ------------------------------------------------------------------ | ----------------------------------- |
| 安装目录     | `Test-Path $root`                                                  | `False`                             |
| 卸载项       | `Test-Path $uninstallKey`                                          | `False`                             |
| 安装信息     | `Test-Path $installKey`                                            | `False`                             |
| 快捷方式     | 开始菜单/桌面 `知行.lnk`                                           | 已删除                              |
| 进程         | `Get-Process \| Where-Object ProcessName -like '*知行*'`           | 空                                  |
| 服务         | `Get-Service \| Where-Object { $_.Name -like '*zhixing*' }`        | 空                                  |
| 计划任务     | `Get-ScheduledTask \| Where-Object { $_.TaskName -like '*知行*' }` | 空                                  |
| 开机启动项   | `Get-ItemProperty 'HKCU:\...\Run'`                                 | 与第 2 节基线一致                   |
| **用户数据** | `Test-Path "$env:APPDATA\知行\zhixing"`                            | **`True`（按设计保留，见第 7 节）** |

卸载器会删掉 `$INSTDIR`（`templates/nsis/uninstaller.nsh:187`）和两个注册表键（`:250`、`:254`）。

## 7. 别被参数名骗了：升级为什么能保留数据

`installUtil.nsh:224` 那行命令里有个 `KEEP_APP_DATA`，名字看着像保险。**它不是。**
`app-builder-lib@26.18.0` 的模板里除了 `installUtil.nsh:224`、`:230` 两处 `ExecWait` 把它传给子进程之外，
没有任何代码读它——卸载器里没有对应的 `GetParameters`/`GetOptions` 分支。把数据保住的是下面两条，
和这个参数名没有关系：

- **A：升级调用里没有 `--delete-app-data`。** `installUtil.nsh:202-207` 是
  `${if} ${isDeleteAppData}` / `${else}` 两支，正常安装（命令行不带该参数）走 `else`，追加 `--updated`。
- **B：`DELETE_APP_DATA_ON_UNINSTALL` 没有被定义。** `electron-builder.yml` 的 `nsis` 段没有
  `deleteAppDataOnUninstall`，所以 `uninstaller.nsh:223` 的 `!ifdef` 不成立，`:225` 的
  `StrCpy $isDeleteAppData "1"` 不会执行。

两条同时成立，`uninstaller.nsh:216-243` 那段删 `$APPDATA\...` 的代码就走不到（`$isDeleteAppData` 一直是 `0`）。

> 未核对：`${isUpdated}` 与 `${isDeleteAppData}` 这两个 LogicLib 测试的**定义**不在本仓库也不在
> `node_modules` 里（随 electron-builder 的 NSIS 分支提供），本机缓存是空的，没法给出定义处的 file:line。
> 能引用的是它们的用法（`installUtil.nsh:202`、`uninstaller.nsh:224`）和 `installUtil.nsh:205` 的注释：
> "always pass --updated flag - to ensure that if DELETE_APP_DATA_ON_UNINSTALL is defined, user data will be not removed"。

### 谁改了哪一处就会破坏它

| 改动                                                                   | 后果                                                                                                                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron-builder.yml` 的 `nsis` 段加 `deleteAppDataOnUninstall: true` | B 失效。升级时安装器仍会追加 `--updated`，`uninstaller.nsh:224` 的 `${ifnot} ${isUpdated}` 还挡得住；但**普通卸载**会删 `%APPDATA%\知行`，用户的项目和 vault 全丢 |
| `installUtil.nsh:202-207` 被改成无条件追加 `--delete-app-data`         | A 失效，升级当场删数据                                                                                                                                            |
| `uninstaller.nsh:223-226` 的 `${ifnot} ${isUpdated}` 判断被删掉        | 只要 B 成立（宏被定义），升级也会删数据                                                                                                                           |
| `electron/main.cjs:4` 的 `app.setName('知行')` 被改                    | 数据目录换位置，`$APPDATA\${APP_FILENAME}` 的删除范围与用户数据不再重合。表现是"旧数据变成孤儿"而不是丢数据，但升级后用户看不到自己的项目                         |

判断方法：改完 `electron-builder.yml` 或升级安装脚本后，重跑第 4 节到第 5 节的整树 SHA256 对比
（`Get-TreeHash`）。两个值不一样，就是数据被动了。

### 逐项核对时的口径

`%APPDATA%\知行\zhixing` 在卸载后仍然存在，是设计行为，不是 bug——记成"预期保留"，
不要算成卸载残留。如果它**消失了**，那才是数据丢失，属于必须停手的缺陷。

## 8. 与自动化脚本的关系

`scripts/qa-install-lifecycle.ps1` 做的事和本文一致，但有额外前置：

- `-Mode Inspect` 只读，写证据到 `.preview/qa-<版本>/install-evidence-*`；
- `-Mode Run` 需要 `-FixtureManifest`（合成的用户档案，`synthetic: true`、`noRealCredentials: true`），
  并要求 `creatorSid` 与运行者是同一个 Windows SID；
- 卸载用 `--keep-shortcuts`，升级用 `--updated`，全程不出现 `--force-run` / `--delete-app-data`；
- 冷备份用 `scripts/backup-host-bytes.ps1`，安装目录备份用 `scripts/backup-install.ps1`。

本文适用于不能跑脚本的场合（比如只拿到安装包、没有源码树的机器）。两条路径的检查点应当一致。

## 9. 记录模板

每次执行记一条：

```text
日期 / 机器（快照名）/ Windows 版本
0.40.0 安装：exit=<code> 耗时=<s> 目录=<root> 版本=<ProductVersion>
用户数据：workspace.bin sha256=<hash> 项目数=<n> 聊天数=<n>
0.43.0 升级：exit=<code> 耗时=<s> 版本=<ProductVersion> 数据保留=<是/否> sha256=<hash>
卸载：exit=<code> 耗时=<s> 目录残留=<是/否> 注册表残留=<是/否> 快捷方式残留=<是/否>
用户数据目录：<保留/消失>
其他残留：<逐项列出，没有就写"无">
```
