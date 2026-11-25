# 知行 0.27.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.27.0` |
| 构建源码 | `d6fa3a35c24043f9e95f5234fe8f6a4454548331`（`sourceDirty=false`） |
| 包内源码 | 98 个文件，指纹 `cd5026e23d69f6759427dfcb110c9a0eefeddc6ff6a7660a87d30e84320be52a` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,704,414 bytes，SHA-256 `0292ce5645b9768f1145d857876074a01ac7c07c2be8b820efb2a85ba26e6681` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `d15355107adcc2c289b3bc90778dd2464c7ebfa6c4d4f5280ed00f45e6a5e01e` |
| blockmap | 314,800 bytes，SHA-256 `200155c5d5d2188229a7de83dd52ec2b20df51eaeae4841c19ea4d35a54fc3bf` |
| `latest.yml` | 342 bytes，SHA-256 `f6014afc9518d7d89289a47fbde60ec691635b9eed2882e58a9d341bea1bd8c0` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 464：463 通过、1 跳过、0 失败（新增 `inline-references` 7/7） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **行内文件引用（本版新增）** | `npm run test:inline-refs` | 5/5：真实 `present` 交付四个文件（两个同名 `明细.xlsx`）；正文正好两个可点击引用（`季度汇总.docx`、`说明.pdf`）；`title` 为完整路径、`role="link"`；重名与未交付路径保持普通代码；代码块内容不受影响 |
| 交付卡片 | `npm run test:deliverables` | 本版未重跑（0.26.0 为 5/5；本版只改 `AnswerText` 与新增纯函数模块） |
| 执行轨迹检索 | `npm run test:execution-search` | 本版未重跑（0.25.0 为 5/5） |
| 消息反馈 | `npm run test:feedback` | 本版未重跑（0.24.0 为 7/7） |
| 压缩事件 | `npm run test:compaction` | 本版未重跑（0.23.0 为 4/4） |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过 |
| 包内源码核对 | `verify-packed-sources.mjs` | 98 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 1,178 / 1,162 包；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 807 ms · 窗口 909 ms · 可交互 1,080 ms（中位）；首次内容绘制仍为 `null` |

## 证据范围

- 打包验收只覆盖「唯一 basename」这一路解析。**绝对路径在正文里会被脱敏链路替换成 `【敏感值待核实】`**，所以「精确目标路径」只在单测里覆盖，未在实包上端到端验证。
- 候选集只有 `present` 交付的文件；git 改动、普通文件写入、工具参数原文都不参与匹配。
- 行内引用点击打开文档弹窗，不是右侧 Sidebar 预览。
- 实包证据来自本地假 OpenAI 服务 + 真实内核 + 真实 `present` 工具；**未在真实云端会话上跑这套验收**。
- 安装生命周期沿用 0.24.0 的 53 步证据，**没有为新包重跑**，按「未覆盖」记录。
- Windows 安装包未签名；`ENOTFOUND` 文案仍无法在本机端到端触发。

[本轮迭代](iteration-0.27.0.md) · [审计说明](audit-request-0.27.0.md) · [机制对照](harness-parity.md)
