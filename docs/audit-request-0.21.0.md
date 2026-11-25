# 知行 0.21.0 外部审计说明

本版在回答的「详情」里加了「发送方式」行：脱敏模式会写明本轮在本机替换了多少处敏感信息，非脱敏模式直说。数据只取消息上已记录的 `privacyMode`／`protectCount`，不推断。（[Windows 验收](windows-acceptance-0.21.0.md)）

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.20.0-to-v0.21.0.patch` 核对差异，重点看 `src/run-summary.js` 的 `mode`／`protectedCount`、`tests/run-summary.test.mjs` 的「发送方式」用例、以及两个实包脚本里新增的断言。
2. 复跑 `npm test`（431 项）、`npm run test:packed`（354 项）、`npm run test:components`、`npm run test:sites`。
3. 复跑 `npm run test:restore-gap -- ".\release\win-unpacked\知行.exe"`：详情里「发送方式」应以「脱敏模式」开头。
4. 复跑 `npm run test:ui-status -- ".\release\win-unpacked\知行.exe"`（需真实云端环境变量）：真实一轮的「发送方式」应为「脱敏模式」。
5. **重点质疑 1**：老消息没有 `privacyMode`，详情里不会出现这一行；这是有意不回填，不是漏渲染。
6. **重点质疑 2**：「本机替换 N 处」是发送前本机替换的实体数，不等于「N 处敏感信息被彻底保护」，也不覆盖附件未解析、图片未识别的情况。
7. **重点质疑 3**：非脱敏模式只是模式名；若凭证被拦截，那一轮根本不会发出去。
8. **重点质疑 4**：安装生命周期本版未重跑（证据是 0.19.0 的 53 步）；`ENOTFOUND` 文案仍未端到端触发。
9. `visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名；依赖无新增（1,178／1,162，0 high、0 critical、32 moderate）。
