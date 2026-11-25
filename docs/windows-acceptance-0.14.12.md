# 知行 0.14.12 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.14.12` |
| 构建源码 | `eb4c328f1e2288660c9406fe77a0ac506bb866bf`（`sourceDirty=false`） |
| 包内源码 | 96 个文件，指纹 `f68e7981860edfd3303b8bca65b74cd2bd209fbb77f5c95d8ebf100aec385b76`（与 0.14.10／0.14.11 相同，本版无代码改动） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,693,559 bytes，SHA-256 `b2737583eca1544e6259868af48f675018c2b98a36f25af9b671274c97662881` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `e30ad9b43569d6a23bd4643dfea03e39272fabbaa55c8f3ca669ed384dc283a8` |
| blockmap | 314,859 bytes，SHA-256 `caebf803ca8580b4f341ed3914bcee4d6adc52afe49da4529e427dd8682c3a66` |
| `latest.yml` | 345 bytes，SHA-256 `cd583d52cf2015bf99648e81826ddff7ec87dafebfa1924b6535cb8abef93caf` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 399：398 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 351：350 通过、1 跳过、0 失败 |
| 包内源码核对 | `verify-packed-sources.mjs` | 96 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 998 ms · 窗口 1,106 ms · 可交互 1,302 ms（中位） |
| **安装生命周期（带历史基线）** | `qa-install-lifecycle.ps1 -Mode Run -BaselineInstaller 0.14.0` | **53 步：38 passed、0 not_run**，状态 `passed_configured_nonvisual_lifecycle` |

## 安装生命周期明细

| 项 | 结果 |
| --- | --- |
| 候选安装包 | `ZhiXing-0.14.12-x64.exe`（`b2737583…`） |
| 历史基线 | `ZhiXing-0.14.0-x64.exe`，338,681,277 bytes，`AAC2E671…`，`productVersion 0.14.0` |
| fixture | 由 0.14.0 创建：3 个自定义项目、1 条会话（含历史消息）、1 条草稿；`sourceAppVersion 0.14.0`；无真实凭据、无启用自动化 |
| 覆盖 | firstInstall / sameVersionOverlay / **historicalUpgrade** / uninstallRetention / reinstallRetention / outsideCwdStartup 全部 passed |
| 哈希 | 项目、会话、草稿在基线→候选升级、卸载、重装后一致 |
| 加密配置 | 密文保持且应用仍可读 |
| 新版本草稿作用域 | 升级后创建 4 个作用域（首页 + 3 个项目）草稿并在重读后全部保留 |
| 报告 | `.preview/qa-0.14.12/install-evidence-20261125-102142-d574e377/report.json` |
| 耗时 | 10:21:42 → 10:38:39（17 分） |

## 用户环境

| 检查 | 结果 |
| --- | --- |
| 安装位置 | `D:\应用\知行`（带 `/D=`），`知行.exe` SHA-256 `e30ad9b4…dc283a8` 与发布资产一致 |
| 安装耗时 | 退出码 0，190 秒 |
| 快捷方式 | 两条按字节还原，SHA-256 与备份一致（`C39575C1…`、`DB05A293…`） |
| 启动 | 4 个进程常驻；`app.start` 记录 `version 0.14.12`、`previousVersion 0.14.11`、`updated true` |

## 证据范围

- 本版无产品代码改动；0.14.10 的七套实包验收继续代表当前代码。
- `historicalUpgrade` 结论口径是 `passed_same_account_fixture_only`：同账户、合成档案、单机；只测 0.14.0 → 0.14.12。
- 跨账户解密、逐像素界面验收仍 `outside_scope`。
- 真实子任务归档仍未通过；归档实包验收是合成子会话记录。
- 安装器未签名；真实云端未覆盖。

[本轮迭代](iteration-0.14.12.md) · [能力地图](harness-capability-map.md)
