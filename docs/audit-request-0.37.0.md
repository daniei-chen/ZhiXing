# 知行 0.37.0 审计说明

面向外部审计的检查顺序与已知限制。结论一律标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端，低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：`SHA256SUMS-release.txt` 覆盖 18 个资产；安装包 338,713,479 B / `4158d7cf…`，与 `acceptance-summary-0.37.0.json` 一致。
2. **核对源码一致**：`packed-source-manifest.json` 与 `build-provenance.json`（`sourceDirty=false`，`sourceCommit=17d5a096…`），指纹 `594e05c9…`。
3. **看本版改了什么**：`src/context-window.js`（新增纯函数）、`src/App.jsx` 一处接线（用量的分母改由选中型号决定）、`tests/context-window.test.mjs`（6 例）、`scripts/test-model-switch-ui.mjs` 新增一条「切换后立刻显示新型号窗口」的断言。
4. **跑源码层**：`npm test`（重点看 `tests/context-window.test.mjs`）、`npm run test:components`、`npm run test:sites`。
5. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`、`npm run test:model-switch`、`npm run test:model-window`。
6. **复核这一条结论**：把 `src/App.jsx` 里的 `contextUsageText(...)` 换回 `(message.context.pressure?.contextWindow || 128000).toLocaleString()`，`test:model-switch` 的第 1 例应失败（会读到 131,072）。

## 本版改了什么（供复核）

- `src/context-window.js`：`modelContextWindow(runtime, settings)` 按「型号 → 供应商」取窗口，同名型号按供应商精确匹配；`contextWindowTokens` 依次退回实测值与 128,000；`contextUsageText` 统一文案排版。
- `src/App.jsx`：输入区用量改用上面两个函数，删除原先直接读 `pressure.contextWindow` 的写法。
- `tests/context-window.test.mjs`：6 个用例，含「同名型号按供应商区分」与「全未知用 128,000」。
- `scripts/test-model-switch-ui.mjs`：第 1 例改为「切换后立刻按新型号显示窗口」，用例总数 4 → 5。

## 已知限制（不要当已通过）

- 只改分母。分子仍是上一次实测值，换型号后不会立刻为新窗口重测。
- 型号目录没有声明窗口的供应商仍会退回实测值或 128,000，分母可能与会话实际窗口不一致。
- 断言是文本断言，没有视觉核对。
- 极小窗口（8,192）压缩不收敛的行为未变。
- 本版没有重跑 `test:errors`、`test:overflow-recovery`、`test:compact-command`、`test:compaction`、`test:review`、`test:changes`、`test:actions`、`test:inline-refs`、`test:deliverables`、`test:execution-search`、`test:feedback`。
- **没有为本版重跑安装生命周期**（现有 53 步属于 0.24.0）。
- 图像卸载、真实云端、签名未覆盖；首次内容绘制仍为 `null`。
- 长会话下「无法确认内核已退出」的触发条件未查实。
