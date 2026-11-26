# 知行 0.33.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.33.0` |
| 构建源码 | 见 `build-provenance.json` 的 `sourceCommit`（`sourceDirty=false`） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | `ZhiXing-0.33.0-x64.exe` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 492：491 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **溢出恢复（本版新增）** | `npm run test:overflow-recovery` | 4/4：提供方回 `HTTP 400 context_length_exceeded` 后，请求序列为「超限 → 摘要 → 重试」，界面给出答复无错误，重试请求 5→4 条并带摘要，之后可继续对话 |
| 手动压缩命令 | `npm run test:compact-command` | 5/5 |
| 错误文案端到端 | `npm run test:errors` | 本版未重跑（0.32.0 为 7 条） |
| 改动对比视图 | `npm run test:review` | 本版未重跑（0.30.0 为 6/6） |
| 改动文件卡片 | `npm run test:changes` | 本版未重跑（0.30.0 为 5/5） |
| 交付文件动作 | `npm run test:actions` | 本版未重跑（0.29.0 为 7/7） |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过 |
| 包内源码核对 | `verify-packed-sources.mjs` | 与构建提交一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 0 high、0 critical |
| 启动耗时 | `probe-startup.mjs` ×10 | 见 `acceptance-summary-0.33.0.json` |

## 证据范围

- 本版只加验收与文档，**产品代码未变**。
- 超限错误由本地假服务按真实错误形态构造（`HTTP 400` + `code=context_length_exceeded`），真实供应商的同一路径**没有**证据。
- 「重试不占提供方重试预算」只验证到「一次压缩 + 一次重试 + 成功」，**没有**直接观测 `llm/retry` 事件。
- 图像卸载与切换小窗口模型的压缩仍未实验；摘要由假服务生成。
- 安装生命周期**没有为新包重跑**，仍是 0.24.0 的 53 步证据。
- 安装包未签名；首次内容绘制仍为 `null`。

[本轮迭代](iteration-0.33.0.md) · [审计说明](audit-request-0.33.0.md) · [机制对照](harness-parity.md)
