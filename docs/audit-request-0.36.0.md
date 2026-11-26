# 知行 0.36.0 审计说明

面向外部审计的检查顺序与已知限制。结论一律标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端，低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：`SHA256SUMS-release.txt` 覆盖 18 个资产；安装包 338,712,969 B / `476c62de…`，与 `acceptance-summary-0.36.0.json` 一致。
2. **核对源码一致**：`packed-source-manifest.json` 与 `build-provenance.json`（`sourceDirty=false`，`sourceCommit=4cfbb574…`）。
3. **看本版改了什么**：只新增了 `scripts/test-model-switch-ui.mjs` 与 `package.json` 的 `test:model-switch`，以及四件套文档与 `AGENTS.md`／能力地图的条目；**产品源码一行未改**（可用 `git diff v0.35.0 HEAD -- electron src` 核对）。
4. **跑源码层**：`npm test`、`npm run test:components`、`npm run test:sites`。
5. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`、`npm run test:model-switch`、`npm run test:model-window`。
6. **复核这一条结论**：`test:model-switch` 的第 2 例要求「压缩之后的那条请求不是摘要请求、模型是 `qa-small`、消息数更少」。若把 `electron/runtime.mjs` 里 pi-ai 的模型表去掉整条目录，该例应当失败（0.34.0 之前就是这样）。

## 本版改了什么（供复核）

- `scripts/test-model-switch-ui.mjs`（新增）：本地假 OpenAI 服务 + 真实内核 + 打包 EXE；两个型号 `qa-big`（131,072）与 `qa-small`（32,768）；5 轮约 13,500 tokens 历史；切换后断言「先压缩 → 提交更短 → 有答复 → 用量 32,768」。
- `package.json`：`test:model-switch` 脚本；版本号。
- 文档四件套与 `AGENTS.md`／`docs/harness-capability-map.md` 条目。

## 已知限制（不要当已通过）

- **这不是新能力**：切换压缩本来就是这个行为，本版只是第一次拿到证据。任何「修复了切换压缩」的说法都不成立。
- 成功路径只覆盖一种形状（历史略高于阈值、一次压缩收敛、32,768 窗口）。
- 极小窗口（8,192）压不成是数学结论，不是缺陷；本版未改阈值与保留比例。
- 切换后、请求前用量显示旧窗口，未修。
- 合成服务不回报 `usage`，真实厂商用量形状未验证。
- 图像卸载、真实云端、签名未覆盖。
- 本版没有重跑 `test:errors`、`test:overflow-recovery`、`test:compact-command`、`test:compaction`、`test:review`、`test:changes`、`test:actions`、`test:inline-refs`、`test:deliverables`、`test:execution-search`。
- **没有为本版重跑安装生命周期**（现有 53 步属于 0.24.0）。
- 长会话下的「无法确认内核已退出」未查实，门禁以减少轮次规避。
