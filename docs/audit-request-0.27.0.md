# 知行 0.27.0 审计说明

面向外部审计的检查顺序与已知限制。所有结论都标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端；低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：安装包 `ZhiXing-0.27.0-x64.exe` 应为 338,704,414 bytes、SHA-256 `0292ce5645b9768f1145d857876074a01ac7c07c2be8b820efb2a85ba26e6681`；`SHA256SUMS-release.txt` 覆盖全部 18 个资产。
2. **核对源码一致**：`packed-source-manifest.json` 记录包内 98 个文件与 `cd5026e23d69f6759427dfcb110c9a0eefeddc6ff6a7660a87d30e84320be52a` 的指纹，构建源码是 `d6fa3a35c24043f9e95f5234fe8f6a4454548331`、`sourceDirty=false`。
3. **跑源码层**：`npm test`（464 项）、`npm run test:components`（14 项）、`npm run test:sites`（4 项）。
4. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`（354 项）、`npm run test:inline-refs`（5 项，本版新增）、`node scripts/test-native-files-export-ui.mjs`。
5. **人工复核本版改动**：让模型交付若干文件并在结尾用反引号点名它们——唯一文件名应显示为带虚下划线的可点引用，悬停可见完整路径；同名文件与未交付的路径保持普通代码；代码块内容不受影响。
6. **复核隐私与凭据路径**：本版没有改隐私网关、脱敏规则、凭据存储；`src/inline-references.js` 只比较交付记录里的路径与 token 文本，不读文件内容。

## 本版改了什么（供复核）

- 新增 `src/inline-references.js`、`tests/inline-references.test.mjs`（7 个用例）。
- `src/AnswerText.jsx`：`code` 渲染分支改为独立 `Code` 组件（读 `BlockCode` context），命中交付文件时渲染 `code.inline-file-ref`。
- `src/App.jsx`：助手正文传入该消息的 `deliverables` 与 `openDeliverable`。
- `src/styles.css`：`.inline-file-ref` 样式。
- 新增 `scripts/test-inline-references-ui.mjs` 与 `npm run test:inline-refs`。

## 已知限制（不要当已通过）

- 候选集只有 `present` 交付的文件；**git 改动、普通文件写入不会变成链接**（知行没有改动文件卡片与 review tab）。
- 「该目标记录的精确参数」这一路匹配未实现（知行不保存工具参数原文）。
- **绝对路径在正文里会被脱敏链路替换成 `【敏感值待核实】`**，所以实包验收未覆盖「精确目标路径」，该分支只有单测。
- 行内引用点击打开文档弹窗，不是右侧 Sidebar 预览；歧义时不链接，无交互式消歧。
- **本版没有为新安装包重跑安装生命周期**，现有 53 步证据属于 0.24.0。
- 真实云端层本版无新增证据。
- 安装包未签名（`NotSigned`）；`ENOTFOUND` 文案仍未端到端触发。
