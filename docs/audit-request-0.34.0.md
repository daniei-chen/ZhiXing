# 知行 0.34.0 审计说明

面向外部审计的检查顺序与已知限制。结论标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端，低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：`SHA256SUMS-release.txt` 覆盖 18 个资产；`ZhiXing-0.34.0-x64.exe` 的大小与 SHA-256 应与 `acceptance-summary-0.34.0.json` 一致。
2. **核对源码一致**：`packed-source-manifest.json` 与 `build-provenance.json`（`sourceDirty=false`，`sourceCommit=c65fa6ca…`）。
3. **看这一版改了什么**：`electron/model-catalog.mjs` 的 `modelLimits`、`electron/providers.mjs` 的 `runtimeModelRows`、`electron/runtime.mjs` 里 `llm-pi-ai` 的 `models` 取值。
4. **跑源码层**：`npm test`（含 `tests/model-catalog-limits.test.mjs`）、`npm run test:components`、`npm run test:sites`。
5. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`、`npm run test:model-window`、`npm run test:overflow-recovery`、`npm run test:compact-command`。
6. **复核切换行为**：`test:model-window` 的假服务在 `/v1/models` 里声明 `qa-big`（`context_length` 131072）与 `qa-small`（8192）。期望：运行时模型表两条都带各自窗口；大窗口聊四轮后切到小窗口发送，先出现摘要请求、**没有**直接发给 `qa-small` 的非摘要请求；日志出现 `MODEL_SWITCH_COMPACTION_FAILED`，该轮界面显示「未完成」；新建会话用小窗口时用量显示 `8,192`。

## 本版改了什么（供复核）

- `electron/model-catalog.mjs`：新增 `export function modelLimits(item)` 并在 `decodeModels` 里合并进模型记录（`contextWindow`／`maxTokens`）。
- `electron/providers.mjs`：新增 `runtimeModelRows(provider)`，`resolveProvider` 返回 `models`（整条可见目录）。
- `electron/runtime.mjs`：`prepareRuntime` 接收 `models:modelRows`，`llm-pi-ai` 的模型表用它。
- `tests/model-catalog-limits.test.mjs`（新，6 例）；`scripts/test-model-window-ui.mjs`（新）与 `npm run test:model-window`；`package.json` 版本与脚本；文档四件套与能力地图、`AGENTS.md`。

## 已知限制（不要当已通过）

- **模型切换压缩的成功路径未验证**。假摘要 3 个字，检查点前言约 100 tokens，内核选中的被替换区间约 103 tokens，被「summary is not smaller than the shadowed content (103 >= 103)」拒绝。真实历史应当能成功，但没有证据。
- 窗口与输出上限的字段覆盖面只在假服务上验证（`context_length`、`max_output_tokens`）；Anthropic 的 `limit.context` 等写法只有单元测试，**没有真实响应**。
- 窗口可信区间（8,192–2,000,000）与输出上限区间（1–262,144）是工程判断。
- 压缩失败时界面文案是通用句，真实失败码只在日志。
- 图像卸载未核对；真实云端未参与本版任何测试。
- 本版没有重跑 `test:errors`、`test:review`、`test:changes`、`test:actions`、`test:inline-refs`、`test:deliverables`、`test:execution-search` 等实包套件。
- **没有为本版重跑安装生命周期**（现有 53 步属于 0.24.0）。
- 安装包未签名；首次内容绘制为 `null`。
