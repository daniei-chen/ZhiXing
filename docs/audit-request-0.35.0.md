# 知行 0.35.0 审计说明

面向外部审计的检查顺序与已知限制。结论一律标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端，低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：`SHA256SUMS-release.txt` 覆盖 18 个资产；安装包 338,713,060 B / `cf20938e…`，与 `acceptance-summary-0.35.0.json` 一致。
2. **核对源码一致**：`packed-source-manifest.json` 与 `build-provenance.json`（`sourceDirty=false`，`sourceCommit=3037dbe4…`）。
3. **看这一版改了什么**：`electron/run-failure.mjs` 的 `HINTED_CODES` 新增 `MODEL_SWITCH_COMPACTION_FAILED`；`src/error-copy.js` 新增对应中文文案；`tests/error-copy.test.mjs` 新增两条断言；`scripts/test-model-window-ui.mjs` 第 3 例加强。
4. **跑源码层**：`npm test`（重点看 `tests/error-copy.test.mjs` 8/8）、`npm run test:components`、`npm run test:sites`。
5. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`、`npm run test:model-window`、`npm run test:overflow-recovery`、`npm run test:compact-command`。
6. **复核这一句**：`test:model-window` 的第 3 例会在真实内核抛出 `MODEL_SWITCH_COMPACTION_FAILED` 之后断言正文含「装不下这段对话历史」、且**不含**「检查服务地址、模型 ID、API Key 或额度」。若把 `src/error-copy.js` 的那条映射删掉，该例应当失败——这是它存在的意义。

## 本版改了什么（供复核）

- `electron/run-failure.mjs`：`HINTED_CODES` 增加 `'MODEL_SWITCH_COMPACTION_FAILED'`（白名单只放能指向下一步的代码）。
- `src/error-copy.js`：新增 `（MODEL_SWITCH_COMPACTION_FAILED）` → 「换到的新模型装不下这段对话历史，压缩也没能腾出空间。请改用上下文更大的模型，或新建聊天后继续。」
- `tests/error-copy.test.mjs`：文案表加 `windowSwitch`；用例表加这条句子；新增「切换压缩失败码被主进程带进句子」用例（含 `CONTENT_REFUSED` 不得臆造提示的反例）。
- `scripts/test-model-window-ui.mjs`：第 3 例从「显示未完成」升级为两条文本断言。
- `package.json` 版本、四件套文档、能力地图、`AGENTS.md`。

## 已知限制（不要当已通过）

- 只覆盖 `MODEL_SWITCH_COMPACTION_FAILED` 一条。其它未被实验触发的失败码（如 `IMAGE_OFFLOAD_REQUIRED`）仍显示通用句，这是有意的保守。
- 文案是**文本断言**，没有视觉核对；窄窗口下的换行与溢出未看。
- 切换压缩的**成功路径未验证**：0.34.0 的合成摘要（3 字）被「summary is not smaller than the shadowed content」拒绝，本轮未再攻。
- 图象卸载、真实云端、真实厂商字段写法仍未覆盖。
- 本版没有重跑 `test:errors`、`test:review`、`test:changes`、`test:actions`、`test:inline-refs`、`test:deliverables`、`test:execution-search`。
- **没有为本版重跑安装生命周期**（现有 53 步属于 0.24.0）。
- 安装包未签名；首次内容绘制为 `null`。
