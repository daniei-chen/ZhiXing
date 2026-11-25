# 知行 0.14.11 · 安装生命周期复跑（验收版）

## 为什么发这个版本

待办里 P0-2 是「安装生命周期在 Electron 升级后复跑」。0.14.2 和 0.14.5 跑过，之后每次发版只做了安装器实装，没有再跑完整的「首装 → 同版本覆盖 → 卸载保留 → 重装 → 清理」链路。这一版不改产品代码，只把这条链路在**当前安装包**上完整跑一遍，结论按四层证据写清楚。

## 怎么跑的

- 候选安装包就是本版发布的 `ZhiXing-0.14.11-x64.exe`（`sourceCommit` 与发布源码一致，`sourceDirty=false`）。
- 合成档案由本版构建自己重读并重存（`.preview/qa-0.14.11/lifecycle-fixture`，`sourceAppVersion: 0.14.11`），一个项目、一个会话、一条草稿，没有真实凭据、没有启用中的自动化。
- 冷备份按字节取两次：先取一次含两条快捷方式的（用来还原用户环境），删掉快捷方式后再取一次干净备份（生命周期脚本前置检查要求快捷方式清单与备份一致）。
- 生命周期命令：`scripts/qa-install-lifecycle.ps1 -Mode Run`，候选安装包 + fixture 清单 + 干净主机备份 + 包内源码清单。

## 结果

报告 `.preview/qa-0.14.11/install-evidence-20261125-093006-e4d41133/report.json`：44 步，31 步通过、1 步 `not_run`、其余为过程记录；状态 `partial_historical_upgrade_not_run`，与 0.14.5 的口径一致。

| 覆盖项 | 结果 |
| --- | --- |
| `firstInstall` | passed |
| `sameVersionOverlay` | passed |
| `historicalUpgrade` | **not_run**（没有更老的安装包作基线） |
| `uninstallRetention` | passed（默认数据保留、快捷方式按字节还原、注册项移除） |
| `reinstallRetention` | passed |
| `outsideCwdStartup` | passed（从工作目录外启动） |
| `projectHashes` / `chatHashes` / `draftHashes` | passed |
| `encryptedConfigHashes` | `passed_ciphertext_retention_and_app_readability` |
| `visualAcceptance` | outside_scope |
| `crossWindowsUserDecryption` | outside_scope |

跑完后主机回到「无安装、无快捷方式」的干净状态（脚本按冷备份还原），随后把 0.14.11 装回 `D:\应用\知行`，两条快捷方式按字节还原，SHA-256 与备份一致（`C39575C1…` / `DB05A293…`），启动 4 个进程，`app.start` 记录 `previousVersion 0.14.10`、`updated true`。

## 边界

- **本版没有产品代码改动**：`git diff v0.14.10..HEAD -- src electron` 为空。0.14.10 的实包验收（归档 6 项、ZIP 4 项、原生文件 5 项、错误文案 4 项、聊天失败 2 项、更新缓存 3 项、临时目录 2 项）仍然代表当前代码；本版只补安装生命周期这一层。
- `historicalUpgrade` 仍是 `not_run`：仓库里没有更早的可安装基线包，无法演练「从旧版升级」；同版本覆盖（`sameVersionOverlay`）不能替代它。
- `visualAcceptance`、`crossWindowsUserDecryption` 仍是 `outside_scope`：没有做逐像素界面验收，也没有验证跨 Windows 用户的加密数据解密。
- 真实子任务归档仍未通过（子会话始终没有发出模型请求），本轮没有再动它。
- 安装器未签名；真实云端未覆盖。
- 只在 Windows x64 实包验证。

[Windows 验收](windows-acceptance-0.14.11.md) · [能力地图](harness-capability-map.md)
