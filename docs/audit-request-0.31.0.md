# 知行 0.31.0 审计说明

面向外部审计的检查顺序与已知限制。结论都标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端；低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：`SHA256SUMS-release.txt` 覆盖 18 个资产；`ZhiXing-0.31.0-x64.exe` 的大小与 SHA-256 应与 `acceptance-summary-0.31.0.json` 一致。
2. **核对源码一致**：`packed-source-manifest.json` 与 `build-provenance.json`（`sourceDirty=false`）。
3. **跑源码层**：`npm test`、`npm run test:components`、`npm run test:sites`。
4. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`、`npm run test:compact-command`（本版新增）。
5. **人工复核手动压缩**：新建会话，先问两轮长一点的问题，然后在输入框输入 `/compact` 并回车。应看到：一次摘要请求（日志里最后一条 user 消息是压缩指令）、界面出现 `Compacted N history items (~M tokens).`、随后继续提问时请求里带「automatically generated checkpoint」前言且消息数变少。
6. **复核空历史与参数**：新会话直接 `/compact` 不发任何模型请求；输入 `/compact now` 只出现中文「使用 /compact 压缩当前会话。此命令无需参数。」。
7. **复核压缩参数**：`electron/compaction-policy.mjs` 的 `thresholdRatio`／`retainRatio`／`headroomTokens` 与 `electron/runtime.mjs` 里工具结果修剪器的 `thresholdChars`／`headChars`／`tailChars`，应与 `docs/iteration-0.31.0.md` 的对照表一致。

## 本版改了什么（供复核）

- `scripts/test-compact-command-ui.mjs`（新）与 `npm run test:compact-command`；`scripts/probe-compact-command.mjs`（排查用探针，不进发布门禁）。
- `package.json` 版本与脚本；`docs/iteration-0.31.0.md`、`docs/windows-acceptance-0.31.0.md`、`docs/harness-parity.md`、`docs/harness-capability-map.md`、`AGENTS.md`。
- **产品代码没有任何改动**（本版只加验收与文档）。

## 已知限制（不要当已通过）

- **图像卸载未核对**：需要适配器返回 `IMAGE_OFFLOAD_REQUIRED` 的真实语义，本地假服务造不出来；只核对了挂载方式与桌面版相同、无额外配置。
- **溢出恢复（`maxOverflowRetries`）与切换小窗口模型触发的压缩未做实验**：只核对了取值等于桌面版默认。
- `compactionRetries`、`auto` 同样只是取值一致，未逐项实验。
- `/compact` 的成功与空历史文案是内核固定英文；桌面版是否在 UI 层本地化**未核对**，所以没有改成中文。
- 8k 级窗口的 headroom 收缩是知行自己的处理（桌面版按模型覆盖 `headroomTokens`），等价性未验证。
- 手动压缩的实包证据来自本地假服务，摘要由假服务生成，**不代表真实模型的摘要质量**。
- **本版没有为新安装包重跑安装生命周期**，现有 53 步证据属于 0.24.0。
- 真实云端层本版无新增证据；安装包未签名；`ENOTFOUND` 文案仍未端到端触发。
