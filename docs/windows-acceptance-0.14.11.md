# 知行 0.14.11 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.14.11` |
| 构建源码 | `25f0194634fcf399bcdb3fe77bd2dff88ee290fa`（`sourceDirty=false`） |
| 包内源码 | 96 个文件，指纹 `f68e7981860edfd3303b8bca65b74cd2bd209fbb77f5c95d8ebf100aec385b76`（与 0.14.10 相同，本版没有代码改动） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,693,535 bytes，SHA-256 `d3d9b19369ac628e690aec98d8e48391eca613ca5767010eb25c4a69305dc30e` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `fc98646c6c225b77d79ce63a17ba7d1b19096c65a3979cda7280e6d5ca27276f` |
| blockmap | 314,863 bytes，SHA-256 `81a309037c10eaf34b66d987c1716a6aa8ed8366367e77b25b0b521928a94c55` |
| `latest.yml` | 345 bytes，SHA-256 `6d3036c25c413aeb29f6c7569128489c040d30bcdefc1d4d0d09ab98290aeb1c` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 399：398 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 351：350 通过、1 跳过、0 失败 |
| 包内源码核对 | `verify-packed-sources.mjs` | 96 个文件一致，指纹与 0.14.10 相同 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 954 ms · 窗口 1,061 ms · 可交互 1,248 ms（中位） |
| **安装生命周期** | `qa-install-lifecycle.ps1 -Mode Run` | 44 步：31 passed、1 `not_run`、状态 `partial_historical_upgrade_not_run` |

## 安装生命周期明细

| 项 | 结果 |
| --- | --- |
| 候选安装包 | `ZhiXing-0.14.11-x64.exe`（`d3d9b193…`） |
| fixture | 1 项目 / 1 会话 / 1 草稿，`sourceAppVersion 0.14.11`，无真实凭据、无启用自动化 |
| `firstInstall` | passed |
| `sameVersionOverlay` | passed（`--updated` 覆盖安装） |
| `historicalUpgrade` | **not_run** |
| `uninstallRetention` | passed |
| `reinstallRetention` | passed |
| `outsideCwdStartup` | passed |
| 项目/会话/草稿哈希 | passed |
| 加密配置 | `passed_ciphertext_retention_and_app_readability` |
| 报告 | `.preview/qa-0.14.11/install-evidence-20261125-093006-e4d41133/report.json` |

## 用户环境

| 检查 | 结果 |
| --- | --- |
| 安装位置 | `D:\应用\知行`（带 `/D=`），`知行.exe` SHA-256 `fc98646c…5ca27276f` 与发布资产一致 |
| 安装耗时 | 退出码 0，233 秒 |
| 快捷方式 | 两条按字节还原，SHA-256 与备份一致（`C39575C1…`、`DB05A293…`） |
| 启动 | 4 个进程常驻；`app.start` 记录 `version 0.14.11`、`previousVersion 0.14.10`、`updated true` |

## 证据范围

- 本版没有产品代码改动（`git diff v0.14.10..HEAD -- src electron` 为空）；0.14.10 的实包验收继续代表当前代码。
- 归档实包验收用的是脚本注入的合成子会话记录；真实模型子任务归档仍未通过。
- `historicalUpgrade` 仍 `not_run`；`visualAcceptance` 与跨 Windows 用户解密仍 `outside_scope`。
- 安装器未签名；真实云端未覆盖。

[本轮迭代](iteration-0.14.11.md) · [能力地图](harness-capability-map.md)
