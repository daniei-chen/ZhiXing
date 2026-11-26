# 知行 0.39.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.39.0`（产品代码与 `0.38.0` 相同，仅版本号与文档） |
| 构建源码 | `d739d785e47f185488ace19d275592535766c923`（`sourceDirty=false`） |
| 包内源码指纹 | `edb7a25d5ae471781d372c5abedb7b134b25afb9c52fa9a675d13d7c64e04390`（100 个文件，与 0.38.0 完全一致） |
| 安装包 | `ZhiXing-0.39.0-x64.exe` 338,713,599 B · `9e28459a25820e9d2282b1a23802bdd97415fe1f92483eb3ae99f4b0285b235c` |
| 增量包 | `ZhiXing-0.39.0-x64.exe.blockmap` 314,767 B · `5bb8bc48fa11dd90b450d49c87e16c8bed4934eb9914fc523f160724237ce086` |
| 更新描述 | `latest.yml` 342 B · `b5ef8298e6be5aa6d45ee5e79afb0a364569da7f232db03596af2b08ae0932f9` |
| 应用可执行 | `知行.exe` 246,511,104 B · `c54577eda6bb1befbdb9dab28b91ec364f8dce666fccc97d14f9f2998fc0ef72` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 签名 | `NotSigned` |

## 安装生命周期（本轮主要工作）

| 项 | 值 |
| --- | --- |
| 候选包 | `release\ZhiXing-0.38.0-x64.exe`（**不是** 0.39.0） |
| 基线包 | `release\ZhiXing-0.14.0-x64.exe` |
| fixture | `.preview\qa-0.17.0\fixture-candidate\manifest.json`（`sourceAppVersion=0.14.0`，三个合成项目） |
| 状态 | `passed_configured_nonvisual_lifecycle` |
| 步骤 | 50：35 通过、15 观察、0 失败、0 未跑 |
| 耗时 | 15:15:44 → 15:42:16（约 26 分 32 秒） |
| 覆盖 | `firstInstall`／`sameVersionOverlay`／`uninstallRetention`／`reinstallRetention`／`outsideCwdStartup`／`projectHashes`／`chatHashes`／`draftHashes` 均 passed；`historicalUpgrade = passed_same_account_fixture_only`；`encryptedConfigHashes = passed_ciphertext_retention_and_app_readability`；`visualAcceptance`／`crossWindowsUserDecryption = outside_scope` |
| 证据 | `.preview/qa-0.38.0/install-evidence-20261126-151544-9a68c361/` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 505：504 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过（脚本退出码 0；结果文件只记状态，不声明条数） |
| 包内源码核对 | `verify-packed-sources.mjs` | 100 个文件，指纹 `edb7a25d…` 与 0.38.0 相同 |
| 依赖审计 | `audit-production-dependencies.mjs`（仓库／随包） | 1,178／1,162 个包，0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 调试端口 739 ms、CDP 1,020 ms、可交互 1,241 ms（中位）；首次内容绘制 `null` |
| 切换压缩成功路径 | `npm run test:model-switch` | 本版未重跑（0.37.0 为 5/5） |
| 切换压缩失败路径 | `npm run test:model-window` | 本版未重跑（0.37.0 为 4/4） |
| 错误文案端到端 | `npm run test:errors` | 本版未重跑（0.32.0 为 6/6） |

## 证据范围

- 本轮的工作是**验证**，不是改产品：`0.39.0` 与 `0.38.0` 的产品代码完全相同，差别只有版本号与文档。
- 生命周期结论**取自在 0.38.0 安装包上的运行**；`0.39.0` 的安装包本身**没有重跑生命周期**，不能把这条结论当成「0.39.0 验证过」。
- 口径为同账户合成档案：`historicalUpgrade` 只覆盖 0.14.0 → 0.38.0 一条路径，不含真实凭据；跨账户解密与逐像素界面核对 `outside_scope`；15 条 `observed` 是只观察不断言的项目。
- 图像卸载、真实云端、签名未覆盖。
- 长会话「内核退出没在 10 秒内确认」本版未复现、未推进（0.38.0 只改了拒绝文案）。
- `visualAcceptance` 与 `crossWindowsUserDecryption` 仍为 `outside_scope`。

[本轮迭代](iteration-0.39.0.md) · [审计说明](audit-request-0.39.0.md) · [机制对照](harness-parity.md)
