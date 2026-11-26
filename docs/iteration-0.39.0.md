# 知行 0.39.0 · 安装生命周期在 0.38.0 安装包上重跑

## 解决什么问题

「安装生命周期」这项证据从 **0.24.0** 起就没再跑过——中间过了十四个版本（0.25.0 → 0.38.0），期间改过关闭时序、交付动作、改动对比、压缩文案、用量口径。它一直是待办池里的 P0-2：不是能力缺失，而是「升级、卸载、重装、快捷方式、数据保留」这些**只有真安装器才能证明**的事情，上一次的结论是十四个版本前的包。

这一轮把它在**当前已发布的 0.38.0 安装包**上完整重跑了一遍。

## 怎么跑

1. 关掉用户安装，把桌面与开始菜单两条产品快捷方式按字节备份（`sha256` 记进 `inventory.json`）后删除——安装器用 `--no-desktop-shortcut`，不会重写桌面那条，留着会让前置检查报「指向了旧安装目录」。
2. 用 `scripts/backup-host-bytes.ps1` 取冷备份（此时应用已关、快捷方式已删，清单里 `shortcuts` 为空，与前置检查期望一致）。
3. 用安装自带的卸载器卸载用户安装：`Uninstall 知行.exe /S /currentuser --keep-shortcuts`，20 秒退出码 0，`D:\应用\知行` 消失。
4. `-Mode Inspect` 得 `ready_for_same_account_backed_up_run`（0 条不通过）。
5. `-Mode Run`：候选包 `release\ZhiXing-0.38.0-x64.exe`，基线包 `release\ZhiXing-0.14.0-x64.exe`，fixture 用 `.preview\qa-0.17.0\fixture-candidate\manifest.json`（`sourceAppVersion=0.14.0`，三个合成项目）。
6. 跑完把 0.38.0 装回 `D:\应用\知行`，两条快捷方式按备份字节还原（`matched=True`），启动确认 4 个进程。

## 结果

`status = passed_configured_nonvisual_lifecycle`，**50 步：35 通过、15 观察、0 失败、0 未跑**，耗时 15:15:44 → 15:42:16（约 26 分 32 秒）。

覆盖项：

| 项 | 结果 |
| --- | --- |
| `firstInstall` | passed |
| `sameVersionOverlay` | passed |
| `historicalUpgrade` | `passed_same_account_fixture_only`（0.14.0 → 0.38.0） |
| `uninstallRetention`／`reinstallRetention` | passed |
| `outsideCwdStartup` | passed |
| `projectHashes`／`chatHashes`／`draftHashes` | passed |
| `encryptedConfigHashes` | `passed_ciphertext_retention_and_app_readability` |
| `visualAcceptance` | `outside_scope` |
| `crossWindowsUserDecryption` | `outside_scope` |

证据：`.preview/qa-0.38.0/install-evidence-20261126-151544-9a68c361/`（`report.json`、`protected-host-manifest.json`、`first-install-*.json`、`retained-profile/`）。

## 边界

- **这一版没有产品代码改动**。之所以发 0.39.0，是因为证据必须随版本归档；`0.39.0` 与 `0.38.0` 的差别只有版本号与文档。上面那条结论是**在 0.38.0 安装包上跑出来的**，`0.39.0` 的安装包本身**没有重跑生命周期**。
- 口径仍是「同账户合成档案」：`historicalUpgrade` 是 `passed_same_account_fixture_only`，fixture 由 0.14.0 自己创建，不含真实凭据；跨账户解密与逐像素界面核对仍是 `outside_scope`。
- 只验了 **0.14.0 → 0.38.0** 一条升级路径，没有验「0.30.0 → 0.38.0」这类中间版本。
- 15 条 `observed` 是脚本按设计只观察不断言的项目（进程清退、日志字段等），不能当成「已验证」。
- 用户环境的恢复过程本身不在证据里：装回耗时 304 秒、退出码 0、4 个进程、日志 `previousVersion":"0.38.0","updated":false`（因为装的还是 0.38.0，不是升级）。
- 上一轮遗留的「内核退出没在 10 秒内确认」仍未复现，本轮没有推进。
