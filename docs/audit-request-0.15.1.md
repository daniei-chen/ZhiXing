# 知行 0.15.1 外部审计说明

本版把这一轮的工具调用直接列在回答下方（默认展开的「N 次工具调用」列表），并把「工具已出结果」时的状态行回落到「思考中」。 [Windows 验收](windows-acceptance-0.15.1.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.15.0-to-v0.15.1.patch` 核对差异，重点看 `src/run-status.js`（`toolTimeline`、状态行回落规则）、`src/App.jsx` 的 `tool-strip` 渲染、`src/styles.css` 的四条样式，以及 `tests/run-status.test.mjs`。
2. 复跑 `npm test`（408 项）与 `npm run test:packed`（353 项）。
3. 复跑工具时间线：`npm run test:tools-ui -- ".\release\win-unpacked\知行.exe"`。脚本自带本地假 OpenAI 服务，用 SSE 返回一次 `todo_write` 的 tool_call，然后断言消息下方出现「调用 · 更新工作计划」与「更新工作计划 · 完成」两行。
4. **重点质疑**：这不是真实云端。我另外用真实供应商试过让模型调用 `glob`，模型明确回答「本次会话没有 glob 工具」——文件工具按工作区挂载，测试会话没有绑定项目。所以「真实云端 + 工作区 + 文件工具」这一层仍然没有证据。
5. **重点质疑**：时间线只呈现事件里已有的标签和耗时，不含工具参数、结果正文；这些仍只在右侧执行面板。
6. 耗时小于 100 ms 的条目故意不显示秒数（避免「完成0.0s」），因此并非所有条目都有耗时。
7. 安装生命周期本版未重跑；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名；依赖未变（1,178／1,162，0 high、0 critical、32 moderate）。
