# 知行 0.25.0 审计说明

面向外部审计的检查顺序与已知限制。所有结论都标明证据层：源码 / 合成运行 / Windows 实包 / 真实云端；低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：安装包 `ZhiXing-0.25.0-x64.exe` 应为 338,703,462 bytes、SHA-256 `991d145dd66a2ecfb1119ae1eb92ca268fa999f3bc746d8a432eb9f0fc9f6f5b`；`SHA256SUMS-release.txt` 覆盖全部 18 个资产。
2. **核对源码一致**：`packed-source-manifest.json` 记录包内 98 个文件与 `9f9407093f22240e7b18f5fb9d5bc8209b12273fc0a1923843e9f0e753595840` 的指纹，构建源码是 `2608f4e7c7b99c025cdb15dc32673cd9a09fd5f6`、`sourceDirty=false`。
3. **跑源码层**：`npm test`（452 项）、`npm run test:components`（14 项）、`npm run test:sites`（4 项）。
4. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`（354 项）、`npm run test:execution-search`（5 项，本版新增）、`node scripts/test-native-files-export-ui.mjs`。
5. **人工复核本版改动**：执行面板输入框 `aria-label="搜索轨迹"` 占位「搜索」；输入关键词后摘要为「匹配 N / M 条」；无匹配时是「没有匹配「X」的记录」；两个按钮「收起所有事件」「展开所有事件」。
6. **复核脱敏与凭据路径**：本版没有改隐私网关、脱敏规则、凭据存储；`src/trace-filter.js` 只读事件标签／状态／分类，不碰正文与工具参数。

## 本版改了什么（供复核）

- 新增 `src/trace-filter.js` 与 `tests/trace-filter.test.mjs`（6 个用例）。
- `src/ExecutionPanel.jsx`：检索框、匹配摘要、空结果提示、受控展开状态、子任务与后台作业同条件过滤。
- `src/styles.css`：`.execution-search`。
- 新增 `scripts/test-execution-search-ui.mjs` 与 `npm run test:execution-search`。

## 已知限制（不要当已通过）

- 桌面版 Trajectory 的**按轮次分组记录表**、**记录检查器**（输入／输出／思考／token 用量／TTFT）、**时间概览**（缩放、拖选、吞吐）、**按档折叠**（轮次／调用／子调用分别控制）、`run_code` 的**代码视图与语法高亮**，本版都没有做；对标表「轨迹视图」一行为「部分」。
- 检索不跨交办、不分页搜索更早的历史；不区分大小写但不做分词与高亮。
- **本版没有为新安装包重跑安装生命周期**，现有 53 步证据属于 0.24.0。本版改动只在渲染层与一个纯函数模块，但没有验证就不写「已通过」。
- 真实云端层本版无新增证据（未在真实供应商会话上跑检索验收）。
- Windows 安装包未签名（`NotSigned`）；`ENOTFOUND` 文案仍未端到端触发，本机代理把所有域名解析到 `198.18.0.13` 的 fake-IP 段。
- 01:06 的 GitHub API 中断与补发过程记录在 `AGENTS.md`，与 0.25.0 的构建无关。
