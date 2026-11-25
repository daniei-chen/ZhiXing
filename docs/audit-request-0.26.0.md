# 知行 0.26.0 审计说明

面向外部审计的检查顺序与已知限制。所有结论都标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端；低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：安装包 `ZhiXing-0.26.0-x64.exe` 应为 338,703,627 bytes、SHA-256 `c923b49e73fb11cc68bcea73ff404bc1544d366296ac9c7c4945588172a3c833`；`SHA256SUMS-release.txt` 覆盖全部 18 个资产。
2. **核对源码一致**：`packed-source-manifest.json` 记录包内 98 个文件与 `a3439ea236d858e5cd5578a9369453ad411607c446a4678ec7e6c18af44452ee` 的指纹，构建源码是 `0c0ea9b13cbe53e1e7a49fd1d38b60010fa1cf5b`、`sourceDirty=false`。
3. **跑源码层**：`npm test`（457 项）、`npm run test:components`（14 项）、`npm run test:sites`（4 项）。
4. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`（354 项）、`npm run test:deliverables`（5 项，本版新增）、`node scripts/test-native-files-export-ui.mjs`。
5. **人工复核本版改动**：回答问题后在气泡末尾看交付卡片——文件名 + 说明（无说明显示类型）、多交付两列、超过四个出现「展开全部 N 个交付」、展开后变「收起」。
6. **复核隐私与凭据路径**：本版没有改隐私网关、脱敏规则、凭据存储；`src/deliverable-cards.js` 只读交付记录里的路径与说明，不读文件内容。

## 本版改了什么（供复核）

- 新增 `src/deliverable-cards.js`、`src/DeliveryCards.jsx`、`tests/deliverable-cards.test.mjs`（5 个用例）。
- `src/App.jsx`：交付按钮行换成 `<DeliveryCards/>`。
- `src/styles.css`：`.deliverable-files`、`.deliverable-card`、`.deliverable-more`。
- 新增 `scripts/test-deliverable-cards-ui.mjs` 与 `npm run test:deliverables`。

## 已知限制（不要当已通过）

- 桌面版的**改动文件卡片**（本轮改了哪些文件、行数、点击开 review tab）、**收尾正文行内代码引用变链接**、**在默认应用打开／定位**控件，知行都没有；对标表「交付物视图」仍为「部分」。
- 卡片点击打开的是文档弹窗，不是右侧 Sidebar 预览。
- 文件类型只按扩展名判定；说明只取交付记录的 `description`。
- **本版没有为新安装包重跑安装生命周期**，现有 53 步证据属于 0.24.0。
- 真实云端层本版无新增证据。
- 安装包未签名（`NotSigned`）；`ENOTFOUND` 文案仍未端到端触发。
