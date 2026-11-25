# 知行 0.19.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.19.0` |
| 构建源码 | `efb1b4714012084690b7dfbe02bc35f059a8b046`（构建时 `sourceDirty=false`；之后只改了 `scripts/test-restore-gap-ui.mjs` 的关闭弹窗方式并新增用例） |
| 包内源码 | 96 个文件，指纹 `504f2f9a3b4eb517e1af2d2ab8f3177a0a92ef8d16bb4f090909fe9a152c15bd` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,696,366 bytes，SHA-256 `da7687442be14fc48e3d570a94a726314c7295aa6c583619b33fbf4a4b0290c3` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `b2cd7dd1a487a515430abcd028df9fc68671c1d5de54b49aaefebc6ba10b0e69` |
| blockmap | 314,713 bytes，SHA-256 `a8f314a4b1579c17bc14a7fb44b3d66b8c3530c11d05d7316a031b043db99731` |
| `latest.yml` | 342 bytes，SHA-256 `ab3e52eec24776ae3777b3a50fb4e1e30c12a418e338d97ab388942607ab3a4e` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 424：423 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| 导出/分享说明 + 占位符降级（实包 + 本地假服务） | `npm run test:restore-gap` | 4/4 |
| 供应商页档位 + 模型移除 + 状态行（实包 + 真实云端） | `npm run test:ui-status` | 6/6 |
| 工具结果脱敏（实包 + 真实云端） | `npm run test:tool-redaction` | 4/4 |
| 真实云端工作区工具（实包） | `npm run test:workspace-tools` | 4/4 |
| 工具时间线（实包 + 本地假服务） | `npm run test:tools-ui` | 2/2 |
| 错误文案（实包 + 真实网络故障） | `npm run test:errors` | 6/6 |
| 原生文件导出（实包） | `test-native-files-export-ui.mjs` | 5 项 PASS |
| 临时目录清理（实包） | `npm run test:temp` | 3/3 |
| 包内源码核对 | `verify-packed-sources.mjs` | 96 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 1,178 / 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 935 ms · 窗口 1,047 ms · 可交互 1,229 ms（中位）；**首次内容绘制本轮仍为 `null`** |

## 导出与分享说明明细

| 路径 | 断言 |
| --- | --- |
| 单条回答「导出成果」 | 审阅弹窗正文尾部含「（本段有 1 处占位符无法归属对应任务，已按【敏感值待核实】保留。）」 |
| 会话菜单「分享或转发…」 | 正文尾部含「（本会话有 1 处占位符无法归属对应任务，已按【敏感值待核实】保留。）」 |
| 无占位符时 | `exportNote(0)` 返回空串，正文一个字符都不加（单测） |

## 证据范围

- 说明只加在正文尾部，没有逐个占位符就地标注。
- 只验证审阅弹窗给出的正文；文件落地接收方之后的样子不在验收内。
- Markdown（Harness 会话）格式未单独验证尾部说明位置。
- 安装生命周期本版未重跑，证据仍是 0.17.0 的 53 步（0.14.0 → 0.17.0）。
- `ENOTFOUND` 文案仍未端到端触发。
- 启动探测未采到首次内容绘制（`null`）。
- `visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名。

[本轮迭代](iteration-0.19.0.md) · [能力地图](harness-capability-map.md) · [安装生命周期（0.17.0）](lifecycle-acceptance-0.17.0.md)
