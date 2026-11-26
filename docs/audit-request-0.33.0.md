# 知行 0.33.0 审计说明

面向外部审计的检查顺序与已知限制。结论都标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端；低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：`SHA256SUMS-release.txt` 覆盖 18 个资产；`ZhiXing-0.33.0-x64.exe` 的大小与 SHA-256 应与 `acceptance-summary-0.33.0.json` 一致。
2. **核对源码一致**：`packed-source-manifest.json` 与 `build-provenance.json`（`sourceDirty=false`）。
3. **跑源码层**：`npm test`、`npm run test:components`、`npm run test:sites`。
4. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`、`npm run test:overflow-recovery`（本版新增）、`npm run test:compact-command`。
5. **复核恢复机制**：脚本的假服务对第一条对话请求返回 `HTTP 400`、`{"error":{"code":"context_length_exceeded",...}}`；期望观察到的请求序列是「超限 → 摘要请求（最后一条 user 消息以 `You are now acting as a compaction engine` 开头）→ 重试（消息数更少、带摘要正文）」，界面只有一条答复、错误区为空，之后还能继续对话。
6. **核对错误识别口径**：`context_length_exceeded` 能被识别，是因为桌面版 `dsh-llm/lib/types/error.js` 的 `isContextWindowExceededError` 接受该结构化写法；若要换别的错误形态，先确认这条正则。

## 本版改了什么（供复核）

- `scripts/test-overflow-recovery-ui.mjs`（新）与 `npm run test:overflow-recovery`；`.preview/qa-0.33.0/probe-overflow.mjs`（排查用探针，不进发布门禁）。
- `package.json` 版本与脚本；`docs/iteration-0.33.0.md`、`docs/windows-acceptance-0.33.0.md`、`docs/harness-capability-map.md`、`AGENTS.md`。
- **产品代码没有任何改动**。

## 已知限制（不要当已通过）

- 超限错误由本地假服务按真实错误形态构造，**不是真实供应商返回的**；真实云端这条路径没有证据。
- 只验证「第一条消息就超限」；「对话中途超限」没有单独实验。
- 「溢出重试不占提供方重试预算」**没有直接观测**（需要看 `llm/retry` 事件计数），只证明了「一次压缩 + 一次重试 + 最终成功」。
- 图像卸载与「切换小窗口模型触发压缩」仍未实验。
- 摘要由假服务生成，不代表真实模型质量。
- 本版没有重跑 `test:errors`／`test:review`／`test:changes`／`test:actions` 等其它实包套件。
- **本版没有为新安装包重跑安装生命周期**，现有 53 步证据属于 0.24.0。
- 安装包未签名；首次内容绘制仍为 `null`。
