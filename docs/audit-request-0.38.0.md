# 知行 0.38.0 审计说明

面向外部审计的检查顺序与已知限制。结论一律标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端，低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：`SHA256SUMS-release.txt` 覆盖 18 个资产，与 `acceptance-summary-0.38.0.json` 一致。
2. **核对源码一致**：`packed-source-manifest.json` 与 `build-provenance.json`（`sourceDirty=false`）。
3. **看本版改了什么**：`electron/runtime.mjs` 新增 `sessionBusyMessage`，并在 `run`／`preview`（两处）／`runPrepared` 四个入口改用它；`tests/runtime-finalization.test.mjs` 的那条匹配从 `/会话|运行|执行/` 改成「含『内核还没确认退出』且不含『正在执行／正在运行／请先停止』」。
4. **跑源码层**：`npm test`，重点 `node --test tests/runtime-finalization.test.mjs`（19 例）。
5. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`、`npm run test:components`、`npm run test:sites`。
6. **复核这一条结论**：把 `sessionBusyMessage` 换回固定句子，`runtime-finalization.test.mjs` 的第一条用例应失败。

## 本版改了什么（供复核）

- 拒绝文案：「该会话正在执行，请先停止当前任务。」→ 「上一轮的内核还没确认退出，恢复文件已保留。可以点「重试清理」，或稍等几秒再发一次；新建聊天可以立即使用。」，仅当该会话确有 `cleanup_pending`／`shutdownPending` 记录时启用。
- 隔离语义、关闭时序（10 秒上限、1s／3s／10s 重试）、恢复文件保留策略均未改。

## 已知限制（不要当已通过）

- **触发条件未复现**：18 轮短对话探针一次未触发；实包层没有造出「关闭超时」这个状态，本版的用户可见效果属于未覆盖。
- 没有改「优雅关闭超时后是否更早强杀」——涉及是否会截断内核最后一次历史写入，没有实验证据不动。
- 界面横幅与「重试清理」按钮未做视觉核对。
- 本版没有重跑 `test:model-switch`、`test:model-window`、`test:errors`、`test:overflow-recovery`、`test:compact-command`、`test:compaction`、`test:review`、`test:changes`、`test:actions`、`test:inline-refs`、`test:deliverables`、`test:execution-search`、`test:feedback`。
- **没有为本版重跑安装生命周期**（现有 53 步属于 0.24.0）。
- 图像卸载、真实云端、签名未覆盖。
