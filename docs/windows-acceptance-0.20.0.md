# 知行 0.20.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.20.0` |
| 构建源码 | `95dbd85bc2cb5d08cf585b3e6ebba712692fd1af`（`sourceDirty=false`；之后只改了两个实包验收脚本） |
| 包内源码 | 96 个文件，指纹 `5a5d258fc735999b35e7c228d75217acdd70fb60afa03e2b8f940e6f4f685ddb` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,697,383 bytes，SHA-256 `843ce90505a38db73c4a930221c6d3c7b769651410f2faaa31cb1b3f27abc759` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `5d9c6e33e67786872eaf9de3fca9aecb5aac60917e10e76a100262ca9aa36397` |
| blockmap | 314,820 bytes，SHA-256 `6390245958d92ffb60bfdb8c00bd5e47945c25b0d4018bbf86f638b5aeddaf32` |
| `latest.yml` | 342 bytes，SHA-256 `5930db7ba3ecc685944e724e45b88634c906eff040562f1690a5c24a6e5451ca` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 430：429 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| 详情 + 占位符降级 + 导出/分享说明（实包 + 本地假服务） | `npm run test:restore-gap` | 5/5 |
| 详情 + 供应商页档位 + 模型移除 + 状态行（实包 + 真实云端） | `npm run test:ui-status` | 7/7 |
| 工具结果脱敏（实包 + 真实云端） | `npm run test:tool-redaction` | 4/4 |
| 真实云端工作区工具（实包） | `npm run test:workspace-tools` | 4/4 |
| 工具时间线（实包 + 本地假服务） | `npm run test:tools-ui` | 2/2 |
| 错误文案（实包 + 真实网络故障） | `npm run test:errors` | 6/6 |
| 原生文件导出（实包） | `test-native-files-export-ui.mjs` | 5 项 PASS |
| 临时目录清理（实包） | `npm run test:temp` | 3/3 |
| 包内源码核对 | `verify-packed-sources.mjs` | 96 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 1,178 / 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 861 ms · 窗口 965 ms · 可交互 1,142 ms（中位）；首次内容绘制仍为 `null`（未采到） |

## 详情块明细

| 场景 | 断言 |
| --- | --- |
| 有无法归属占位符（本地假服务） | 详情展开后：状态「已完成」、耗时匹配「N 秒／不到 1 秒」、`原文还原` 行含「1 处」 |
| 真实云端一轮 | 详情存在、状态「已完成」、耗时有值、**没有** `原文还原` 行 |
| 没有工具/子任务/产出 | `summaryRows` 不生成空行（单测） |
| 不足 1 秒 | 显示「不到 1 秒」，不四舍五入成「1 秒」（单测） |

## 安装与进程

| 项 | 值 |
| --- | --- |
| 安装 | `ZhiXing-0.20.0-x64.exe`，退出码 0，628 秒 |
| 安装后 `知行.exe` | 246,511,104 bytes，SHA-256 `5d9c6e33e67786872eaf9de3fca9aecb5aac60917e10e76a100262ca9aa36397`（与发布资产一致） |
| 快捷方式 | 桌面 `C39575C1…`、开始菜单 `DB05A293…`，按字节还原 |
| 日志 | `app.start {"version":"0.20.0","previousVersion":"0.19.0","updated":true}` |
| 进程 | 安装后首启观测到 **5 个**（多一个音频 utility）；正常重启后稳定 **4 个**：主进程 1、GPU 1、网络 utility 1、渲染 1 |

安装后首启那次多出一个 `audio.mojom.AudioService` utility（比主进程晚 11 秒启动）。已做三次对照：同一二进制配全新临时档案 4 个、配真实档案副本（237 MB）4 个、用户安装正常重启后 25 秒与 65 秒都是 4 个。所以它**不是版本差异、不是档案内容、不是安装位置**，而是当时那次会话的瞬时行为；触发条件仍未查实。详见 [第 5 个进程的追查](process-count-investigation.md)。

## 证据范围

- 耗时依赖消息上的 `startedAt`；旧消息显示「未记录」，不回填。
- 工具调用数是轨迹事件条数，不代表工具种类或成功与否。
- 详情不含本次请求的脱敏内容（请求文本不落盘）。
- 安装生命周期本版未重跑：最近一次完整证据是 0.19.0 安装包上的 53 步（0.14.0 基线）。
- `ENOTFOUND` 文案仍未端到端触发。
- 启动探测未采到首次内容绘制（`null`）。
- `visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名。

[本轮迭代](iteration-0.20.0.md) · [能力地图](harness-capability-map.md) · [安装生命周期（0.19.0）](lifecycle-acceptance-0.19.0.md)
