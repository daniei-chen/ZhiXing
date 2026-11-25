# 知行 0.31.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.31.0` |
| 构建源码 | 见 `build-provenance.json` 的 `sourceCommit`（`sourceDirty=false`） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | `ZhiXing-0.31.0-x64.exe` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 492：491 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **手动压缩命令（本版新增）** | `npm run test:compact-command` | 5/5：空会话不发请求、带参数给中文用法提示、真实对话后恰好一次摘要请求并给出条数与 token 数、压缩后请求带检查点且消息数减少 |
| 自动压缩 | `npm run test:compaction` | 本版未重跑（0.23.0 为 4 例，阈值 54,272 tokens 实测触发） |
| 改动对比视图 | `npm run test:review` | 本版未重跑（0.30.0 为 6/6） |
| 改动文件卡片 | `npm run test:changes` | 本版未重跑（0.30.0 为 5/5） |
| 交付文件动作 | `npm run test:actions` | 本版未重跑（0.29.0 为 7/7） |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过 |
| 包内源码核对 | `verify-packed-sources.mjs` | 与构建提交一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 0 high、0 critical |
| 启动耗时 | `probe-startup.mjs` ×10 | 见 `acceptance-summary-0.31.0.json` |

## 证据范围

- 本版只新增「手动 `/compact`」的实包验收与压缩口径核对，**产品行为未变**。
- 图像卸载**未核对**（造不出 `IMAGE_OFFLOAD_REQUIRED` 的真实语义）；溢出恢复与切换模型的压缩也没做实验。
- `/compact` 的成功与空历史文案沿用内核英文；桌面版是否本地化未核对。
- 实包证据来自本地假 OpenAI 服务 + 真实内核；摘要由假服务生成，**不代表真实模型**。
- 安装生命周期**没有为新包重跑**，仍是 0.24.0 的 53 步证据。
- 安装包未签名；`ENOTFOUND` 文案仍未端到端触发。

[本轮迭代](iteration-0.31.0.md) · [审计说明](audit-request-0.31.0.md) · [机制对照](harness-parity.md)
