# 知行 0.15.2 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.15.2` |
| 构建源码 | `cd87fb6044056400a326876049a4913b06555b95`（`sourceDirty=false`） |
| 包内源码 | 96 个文件，指纹 `012c107882a9a703f56cfba97937401b3759da28965e413c70373536725828f7` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,694,730 bytes，SHA-256 `6b3f18c48ed978d3a9a282ed027fccaf79b1d204066065b3445072c807ae7191` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `d8eb3a33e5e7f7d71667f2f5cab8d5904239dc0e9df3724ae889409922fdb8e3` |
| blockmap | 314,858 bytes，SHA-256 `842d9c9661b64fe7df2ea562a25264c06f2c643237bde967ce31b14389258396` |
| `latest.yml` | 342 bytes，SHA-256 `7791539dd06ae77a201aab5c46923a2b278124cb0da863945286082d07e25caf` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 408：407 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 353：352 通过、1 跳过、0 失败 |
| 原生文件导出（实包） | `test-native-files-export-ui.mjs` | 5 项 PASS |
| 临时目录清理（实包） | `npm run test:temp` | 3/3 |
| 工具时间线（实包 + 真实内核） | `npm run test:tools-ui` | 2/2 |
| 状态行与模型选择（实包 + 真实云端） | `npm run test:ui-status` | 4/4 |
| **真实云端 + 项目工作区工具调用（实包）** | `npm run test:workspace-tools` | **4/4** |
| 包内源码核对 | `verify-packed-sources.mjs` | 96 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 867 ms · 窗口 970 ms · 可交互 1,155 ms（中位） |

## 真实云端工作区验收明细

| 项 | 值 |
| --- | --- |
| 端点 | `zhihui.kaogong.art` |
| 模型 | `deepseek-v4.1-flash` |
| 工作区 | 临时目录，含 `会议纪要.md`、`预算说明.md`、`notes.txt` |
| 会话 | 项目会话（首页会话没有文件工具） |
| 工具记录 | 调用 · 查找项目文件 / 查找项目文件 · 完成0.2s / 调用 · 列出目录 / 列出目录 · 完成 |
| 回答 | 带回 md 数量 2 |
| 证据 | `.preview/qa-0.15.2/real-cloud-workspace/run-mwvpecd5/` |

## 证据范围

- 只验了文件列举类工具（`glob`、目录列举），没有验写入、覆盖、`apply_patch`、终端、MCP。
- 没有验脱敏在工具结果路径上的行为（工作区文件不含敏感信息）。
- 工作区由脚本注入，不是从「新建项目」对话框手工创建的界面路径。
- 安装生命周期本轮未重跑；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名。

[本轮迭代](iteration-0.15.2.md) · [能力地图](harness-capability-map.md)
