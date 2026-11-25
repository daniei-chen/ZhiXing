# 知行 0.17.0 安装生命周期复跑

本轮不改产品代码：把挂了两版（自 0.14.12 起）的安装生命周期验收在 Electron 44.11.5 / Harness 0.2.2-rc.5 上重跑了一遍，并把历史升级路径（0.14.0 → 0.17.0）补上。

## 做了什么

1. **冷备份**：关停应用后删除两条产品快捷方式并逐字节备份，再跑 `backup-host-bytes.ps1`（快捷方式必须在备份前删掉，否则前置检查的数量校验不通过——见 AGENTS.md 0.14.5）。
2. **卸载用户环境**：`Uninstall 知行.exe /S /currentuser --keep-shortcuts`，19 秒，退出码 0。
3. **第一次跑（无基线）**：用候选版自己建三项目合成档案（`sourceAppVersion=0.17.0`），44 步、31 通过、0 失败、1 未跑（`historicalUpgrade`），状态 `partial_historical_upgrade_not_run`。证据：`.preview/qa-0.17.0/install-evidence-20261125-160457-15e68357/`。
4. **第二次跑（带历史基线）**：装 0.14.0 到 `D:\qa-baseline-0140`（312 秒），用**基线自己**建三项目档案（`sourceAppVersion=0.14.0`），卸载基线并清掉它留下的快捷方式，再带 `-BaselineInstaller release\ZhiXing-0.14.0-x64.exe` 重跑。53 步、38 通过、0 失败、0 未跑，状态 `passed_configured_nonvisual_lifecycle`。
5. **装回**：`/D=D:\应用\知行`，288 秒，退出码 0；两条快捷方式按字节还原；4 个进程；日志 `app.start version 0.17.0`。

## 覆盖范围（第二次跑）

| 项 | 结果 |
| --- | --- |
| 首次安装 | passed |
| 同版本覆盖安装 | passed |
| **历史升级（0.14.0 → 0.17.0）** | `passed_same_account_fixture_only` |
| 卸载后数据保留 | passed |
| 重装后数据保留 | passed |
| 从安装目录之外的工作目录启动 | passed |
| 项目哈希 | passed |
| 会话哈希 | passed |
| 草稿哈希 | passed |
| 加密配置 | `passed_ciphertext_retention_and_app_readability` |
| 逐像素界面验收 | `outside_scope` |
| 跨 Windows 账户解密 | `outside_scope` |

候选安装包就是已发布的 `ZhiXing-0.17.0-x64.exe`（338,695,868 bytes，SHA-256 `9407AAC4…14618A7F`）；基线是 `ZhiXing-0.14.0-x64.exe`（338,681,277 bytes，SHA-256 `AAC2E671…85E6799`）。证据：`.preview/qa-0.17.0/install-evidence-20261125-163141-54c0f2d5/report.json`。

## 边界

- 口径仍是 `passed_same_account_fixture_only`：同一 Windows 账户、合成档案、无真实凭据、无启用中的自动化；换账户解密、逐像素界面**没有覆盖**。
- 合成档案来自 0.13.2 的模板项目，只验证结构迁移（项目/会话/草稿/加密配置的哈希稳定），不验证真实用户的历史数据。
- 历史升级只验了 0.14.0 → 0.17.0 这一条路径；0.15.x、0.16.x 的中间版本升级没有单独跑。
- 安装器仍未签名；安装过程会在 `%TEMP%` 留 `nsXXXX.tmp`（本版启动时按 0.14.13 的规则清理，但没有在本轮重新验证清理结果）。
- 本轮没有新版本、没有新 tag：安装包与源码与已发布的 0.17.0 完全一致，重发会造成同一版本两份资产。
