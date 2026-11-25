# 知行 0.19.0 外部审计说明

本版把「有占位符无法归属」的说明带进导出与分享，避免接收方把 `【敏感值待核实】` 当成用户原文。([Windows 验收](windows-acceptance-0.19.0.md))

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.18.0-to-v0.19.0.patch` 核对差异，重点看 `src/privacy-warning.js` 的 `exportNote`／`sumUnrestored` 与 `src/App.jsx` 里三处接入点（`openExport` 两条路径、`shareCurrentChat`）。
2. 复跑 `npm test`（424 项）与 `npm run test:packed`（354 项）。
3. 复跑 `npm run test:restore-gap -- ".\release\win-unpacked\知行.exe"`：本地假服务回收一个外来令牌，四项断言分别是正文保留、日志处数、导出正文含「本段有 1 处…」、分享正文含「本会话有 1 处…」。
4. 复跑 `npm run test:errors`（真实 401／ECONNREFUSED／TIMEOUT／不存在主机名）。
5. **重点质疑 1**：说明只加在正文尾部，没有逐个占位符就地标注；读者要靠这句话自己定位。
6. **重点质疑 2**：只验证了审阅弹窗里给出的正文；文件真正落到接收方手上之后的样子不在验收范围内。
7. **重点质疑 3**：Markdown（Harness 会话）格式没有单独验证说明在渲染后的位置。
8. **重点质疑 4**：安装生命周期本版未重跑，证据仍是 0.17.0 的 53 步；`ENOTFOUND` 文案仍未端到端触发。
9. `visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名；依赖无变化（1,178／1,162，0 high、0 critical、32 moderate）。
