# 知行 0.28.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.28.0` |
| 构建源码 | 见 `build-provenance.json` 的 `sourceCommit`（`sourceDirty=false`） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | `ZhiXing-0.28.0-x64.exe` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 476：475 通过、1 跳过、0 失败（新增 `change-summary` 7 项、`changed-files` 5 项） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **改动文件卡片（本版新增）** | `npm run test:changes` | 5/5：真实内核写三次文件（同一路径两次、另一文件一次）；卡片「本轮改动 2 个文件」「+11 −0」；两行 `+8 −0`、`+3 −0`；工作区文件内容与模型最后一次写入一致；点击后工作面板视图为 `files` |
| 行内文件引用 | `npm run test:inline-refs` | 本版未重跑（0.27.0 为 5/5；本版未改 `AnswerText` 与 `inline-references`） |
| 交付卡片 | `npm run test:deliverables` | 本版未重跑（0.26.0 为 5/5） |
| 执行轨迹检索 | `npm run test:execution-search` | 本版未重跑（0.25.0 为 5/5） |
| 消息反馈／压缩／异常文案／聊天失败 | — | 本版未重跑（沿用 0.23.0–0.24.0 证据） |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过 |
| 包内源码核对 | `verify-packed-sources.mjs` | 与构建提交一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 0 high、0 critical |
| 启动耗时 | `probe-startup.mjs` ×10 | 见 `acceptance-summary-0.28.0.json` |

## 证据范围

- 本版新增的「改动文件卡片」只覆盖**文件工具**（`write` / `edit`）的改动；终端或外部程序写入不进卡片，因为没有 git 快照。
- 同一路径多次写入的行数是累加值，不是最终文件的真实差异。
- 卡片点击打开工作面板的文件页，不是桌面版的 review tab，也没有逐文件对比视图。
- 实包证据来自本地假 OpenAI 服务 + 真实内核；**未在真实云端会话上跑**。
- 安装生命周期**没有为新包重跑**，现有证据仍是 0.24.0 的 53 步。
- 安装包未签名；`ENOTFOUND` 文案仍未端到端触发。

[本轮迭代](iteration-0.28.0.md) · [审计说明](audit-request-0.28.0.md) · [机制对照](harness-parity.md)
