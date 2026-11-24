# 知行 0.14.8 外部审计说明

本版新增「子会话归档」。排版在 `src/subagent-archive.js`，写盘在 `electron/main.cjs` 的 `subagent:archive`，入口在 `src/ExecutionPanel.jsx`，标题经 `src/Workbench.jsx` 与 `src/App.jsx` 传入。 [Windows 验收](windows-acceptance-0.14.8.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.14.7-to-v0.14.8.patch` 核对差异，应当只有 `src/subagent-archive.js`、`src/ExecutionPanel.jsx`、`src/Workbench.jsx`、`src/App.jsx`、`electron/main.cjs`、`electron/preload.cjs`、`tests/subagent-archive.test.mjs`、`scripts/test-subagent-archive-ui.mjs`、`package.json` 与文档。
2. 读 `archiveMarkdown`，核对：截断消息是否明确标注、空消息是否有占位、是否会把界面上没显示的内容写进归档（不应有）。
3. 读 `subagent:archive`，核对空内容与 2 MB 上限、文件名过滤、强制 `.md`、取消时不写文件。
4. 重跑实包验收：`npm run test:archive -- "<repo>\release\win-unpacked\知行.exe"`。
5. **重点质疑**：实包验收里的子会话记录是脚本用 `saveWorkspace` 注入的合成数据，不是真实跑完模型子任务后的产物；归档是真的，子任务没真跑。不要把它读成「真实子任务归档已验证」。
6. 已知限制：归档只含子会话对话，不含工具参数、原始返回与产物文件；归档文本是界面显示（已脱敏、可能截断）的版本；没有批量/定时归档，不写入项目资料库；安装器未签名；`historical-upgrade` 仍为 `not_run`；真实云端未覆盖。
7. 依赖未变：1,178／1,162，0 high、0 critical、32 moderate；本版没有引入新依赖。
