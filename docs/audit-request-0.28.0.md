# 知行 0.28.0 审计说明

面向外部审计的检查顺序与已知限制。所有结论都标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端；低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：以 `SHA256SUMS-release.txt` 覆盖的 18 个资产为准，`ZhiXing-0.28.0-x64.exe` 的大小与 SHA-256 应与 `acceptance-summary-0.28.0.json` 一致。
2. **核对源码一致**：`packed-source-manifest.json` 记录包内文件与指纹，构建提交见 `build-provenance.json`（`sourceDirty=false`）。
3. **跑源码层**：`npm test`、`npm run test:components`、`npm run test:sites`。
4. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`、`npm run test:changes`（本版新增）、`node scripts/test-native-files-export-ui.mjs`。
5. **人工复核本版改动**：在项目工作区会话里让模型写两个文本文件（其中一个写两次），轮次结束后正文下方应出现「本轮改动 2 个文件 · +X −Y」的卡片，行内显示相对路径与每文件行数；点击某一行，工作面板切到「文件」页。
6. **复核隐私路径**：本版没有改脱敏规则与凭据存储；改动路径在输出前经会话保险库还原，占位符无法归属时该条不进卡片（不会把占位符当路径显示）。

## 本版改了什么（供复核）

- 新增 `electron/change-summary.mjs`（行级 LCS、条目抽取、按路径合并、总计）与 `tests/change-summary.test.mjs`（7 项）。
- `electron/runtime.mjs`：记录 `write` / `edit` 调用参数，收集 `tool/result` 的 `meta.diffs`，输出前还原路径并折算工作区相对名，随 `finalization.changes` 回传。
- 新增 `src/changed-files.js`（5 项单测）与 `src/ChangedFiles.jsx`；`src/conversation-state.js`、`src/App.jsx`、`src/styles.css` 接入。
- 新增 `scripts/test-changed-files-ui.mjs` 与 `npm run test:changes`。

## 已知限制（不要当已通过）

- **没有 git 快照**：终端、PowerShell、外部程序写入的文件不会出现在卡片里。
- 同一路径多次写入的行数是累加值，不等于最终文件的真实增删差异。
- 没有 review tab 与逐文件对比；点击只打开工作面板文件页。
- 不产生 `meta.diffs` 的工具（如 `office_write_file`）不统计。
- 超过 4,000 行或 64 KB 的改动只给估算值，并标「约」。
- **本版没有为新安装包重跑安装生命周期**，现有 53 步证据属于 0.24.0。
- 真实云端层本版无新增证据。
- 安装包未签名（`NotSigned`）；`ENOTFOUND` 文案仍未端到端触发。
