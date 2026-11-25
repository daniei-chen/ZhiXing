# 知行 0.30.0 审计说明

面向外部审计的检查顺序与已知限制。结论都标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端；低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：`SHA256SUMS-release.txt` 覆盖 18 个资产；`ZhiXing-0.30.0-x64.exe` 的大小与 SHA-256 应与 `acceptance-summary-0.30.0.json` 一致。
2. **核对源码一致**：`packed-source-manifest.json` 与 `build-provenance.json`（`sourceDirty=false`）。
3. **跑源码层**：`npm test`、`npm run test:components`、`npm run test:sites`。
4. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`、`npm run test:review`（本版新增）、`npm run test:changes`、`npm run test:actions`。
5. **人工复核本版改动**：在项目会话里让模型写同一个文件两次、另写一个新文件；轮次结束后点改动卡片里的任意一行，右侧工作面板切到「改动」，左列是文件与行数，右列是逐行对比（新增带 `+` 底色、删除带 `−` 底色、远处相同的行折叠成 `⋯`）；切换左列文件，右侧内容随之变化。
6. **复核行号与保留行**：确认「没有被改动的行」不会出现在删除行里（本轮实包用例专门断言了这一点）。

## 本版改了什么（供复核）

- `electron/review-diff.mjs`（新）：`unifiedRows`／`collectDiffs`／`mergeDiffs` 与条数、字节、行数上限。
- `electron/runtime.mjs`：收集 `meta.diffs` 的前后文本（创建文件用 `write` 调用参数补），还原占位符、折算工作区相对名后随 `changeDiffs` 回传。
- `src/review-view.js`、`src/ReviewPanel.jsx`（新）；`src/Workbench.jsx` 新增「改动」视图；`src/App.jsx` 的 `openReview(path)` 与卡片点击；`src/conversation-state.js` 带上 `changeDiffs`；`src/styles.css`。
- `scripts/test-review-ui.mjs` 与 `npm run test:review`。

## 已知限制（不要当已通过）

- **没有 git 工作树快照**：终端、PowerShell、外部程序写入不进对比；对比粒度是「每次工具写入」，同一文件多次写入按时间拼接，不是轮次开始到结束的总差异。
- 没有并排视图、换行开关与独立 review tab 地址；review 内的「在默认应用中打开／定位」控件未接（该能力只在交付卡片上）。
- 超过 64 KB 或 4,000 行的文件只给行数；显示上限 2,000 行会截断并标注。
- 不产生 `meta.diffs` 的工具（如 `office_write_file`）不统计也不进对比。
- **本版没有为新安装包重跑安装生命周期**，现有 53 步证据属于 0.24.0。
- 真实云端层本版无新增证据；安装包未签名；`ENOTFOUND` 文案仍未端到端触发。
