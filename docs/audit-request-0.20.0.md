# 知行 0.20.0 外部审计说明

本版给每条回答加了「详情」折叠块：状态、耗时、工具记录、子任务、产出、无法归属的占位符处数、错误码。([Windows 验收](windows-acceptance-0.20.0.md))

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.19.0-to-v0.20.0.patch` 核对差异，重点看 `src/run-summary.js`、`src/App.jsx` 的 `run-summary` 区块、`src/conversation-state.js` 里补的 `finishedAt`、`tests/run-summary.test.mjs`。
2. 复跑 `npm test`（430 项）、`npm run test:packed`（354 项）、`npm run test:components`、`npm run test:sites`。
3. 复跑 `npm run test:restore-gap -- ".\release\win-unpacked\知行.exe"`：详情里应看到状态「已完成」、耗时、以及「1 处占位符无法归属本次任务」。
4. 复跑 `npm run test:ui-status -- ".\release\win-unpacked\知行.exe"`（需真实云端环境变量）：真实回答的详情应有状态与耗时，且**没有**「原文还原」行。
5. **重点质疑 1**：耗时来自消息上的 `startedAt` 与终态事件时间；旧消息没有起点，显示「未记录」而不回填。
6. **重点质疑 2**：工具调用数是轨迹事件条数（调用与结果各算一条），不代表工具种类或成功率。
7. **重点质疑 3**：详情不含本次请求的脱敏内容——请求文本刻意不落盘，只在审阅弹窗里可见。
8. **重点质疑 4**：安装生命周期本版未重跑（证据仍是 0.17.0 的 53 步，0.19.0 又复跑过一次 53 步）；`ENOTFOUND` 文案仍未端到端触发。
9. `visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名；依赖无新增（1,178／1,162，0 high、0 critical、32 moderate）。
