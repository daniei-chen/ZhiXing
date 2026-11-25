# 知行 0.29.0 审计说明

面向外部审计的检查顺序与已知限制。结论都标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端；低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：`SHA256SUMS-release.txt` 覆盖 18 个资产；`ZhiXing-0.29.0-x64.exe` 的大小与 SHA-256 应与 `acceptance-summary-0.29.0.json` 一致。
2. **核对源码一致**：`packed-source-manifest.json` 与 `build-provenance.json`（`sourceDirty=false`）。
3. **跑源码层**：`npm test`、`npm run test:components`、`npm run test:sites`。
4. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`、`npm run test:actions`（本版新增）、`node scripts/test-native-files-export-ui.mjs`。
5. **人工复核本版改动**：在项目会话里让模型 `present` 一个真实文件；轮次结束后卡片右上角出现「文件操作」按钮，点开有「预览」「在默认应用中打开」「在文件管理器中显示」三项；点第三项应在资源管理器中选中该文件并提示「已在文件管理器中显示。」；删掉文件后再点同一项应提示找不到位置。
6. **复核权限面**：打开／定位只接受主进程签发的 `zx-delivery-v1` 引用（含 HMAC），路径来自交付记录而非界面传入；引用不属于当前会话时拒绝且不读取文件。

## 本版改了什么（供复核）

- `electron/deliverable-access.mjs`：新增 `verify`／`locate`（引用解析、签名校验、文件身份校验）。
- `electron/main.cjs`：`deliverables:action`（`open` → `shell.openPath`；`reveal` → `shell.showItemInFolder`；未知动作与无默认应用分别报 `DELIVERABLE_ACTION`／`DELIVERABLE_OPEN`）；`electron/preload.cjs` 暴露 `deliverableAction`。
- `src/file-actions.js` 与 `tests/file-actions.test.mjs`；`src/DeliveryCards.jsx` 的菜单与状态；`src/App.jsx` 的 `deliverableAction`；`src/styles.css`。
- `scripts/test-deliverable-actions-ui.mjs` 与 `npm run test:actions`。

## 已知限制（不要当已通过）

- **「在默认应用中打开」的成功路径未在实包验收里点击**（会拉起用户默认应用），只核对菜单项存在且可点。
- 没有 `skipped`（同文件重复请求合并）与 `nativeUnavailable`（无桌面会话）两种状态。
- 文件管理器不区分平台名称（只走 Windows explorer）。
- 动作入口是「⋯」菜单而不是右键上下文菜单。
- 改动文件卡片里的行没有这两个动作；只有 `present` 交付的文件有。
- **本版没有为新安装包重跑安装生命周期**，现有 53 步证据属于 0.24.0。
- 真实云端层本版无新增证据；安装包未签名；`ENOTFOUND` 文案仍未端到端触发。
