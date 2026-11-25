# 知行 0.17.0 外部审计说明

本版修一个体验与安全边界的问题：模型复述外来占位符时，原来整段回答会变成「已停止还原」；现在不还原、但保留正文并提示处数。 [Windows 验收](windows-acceptance-0.17.0.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.16.0-to-v0.17.0.patch` 核对差异，重点看 `electron/runtime.mjs` 的还原段（`unrestored`、`privacy.restore-unknown`、`result` 字段）、`src/privacy-warning.js`、`src/App.jsx` 的提示渲染、`tests/runtime-finalization.test.mjs` 改写后的两条用例。
2. 复跑 `npm test`（416 项）与 `npm run test:packed`（353 项）。
3. 复跑 `npm run test:restore-gap -- ".\release\win-unpacked\知行.exe"`：本地假服务故意回一个外来令牌 `⟦ZX-qa-unknown⟧`，断言界面**不报错**、正文保留、令牌变 `【敏感值待核实】`、提示带「1 处」、日志有 `privacy.restore-unknown`。
4. 复跑真实云端两套（自备环境变量）：`npm run test:tool-redaction` 与 `npm run test:ui-status`，确认正常还原链路没有因这次改动退化。
5. **重点质疑 1**：`unrestored` 只统计令牌个数，不做语义核对；提示里说「原文没有还原」是事实（令牌不在本任务映射里），但用户无法据此判断这处内容到底重不重要。
6. **重点质疑 2**：提示只出现在气泡下方；导出、分享、请求详情里没有同样的标记，审计时不要把它当成全链路提示。
7. **重点质疑 3**：真实云端四套证据里没有一条故意让模型复述令牌；本版的复现依赖本地假服务。0.16.0 的失败是真实云端复现的，机制同源，但本版没有在真实云端重跑「复述」场景。
8. 安装生命周期本版未重跑；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名；依赖未变（1,178／1,162，0 high、0 critical、32 moderate）。
