# 知行 0.18.0 外部审计说明

本版两件事：供应商页里能选当前模型的思考强度；把挂了两版的错误文案端到端复验跑通。([Windows 验收](windows-acceptance-0.18.0.md))

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.17.0-to-v0.18.0.patch` 核对差异，重点看 `src/provider-reasoning.js`（档位来源必须是运行时扁平清单）、`src/ProviderSettings.jsx` 的 `provider-effort` 区块、`tests/provider-reasoning.test.mjs`。
2. 复跑 `npm test`（422 项）与 `npm run test:packed`（354 项）。
3. 复跑 `npm run test:ui-status -- ".\release\win-unpacked\知行.exe"`（需自备真实云端环境变量）：六项里第五项是「供应商页里能选当前模型的思考强度，并写回工作区设置」。
4. 复跑 `npm run test:errors -- ".\release\win-unpacked\知行.exe"`：真实 401（`api.deepseek.com` + 假 Key）、关闭端口、12 秒超时、不存在域名四个故障，界面显示可行动文案，主进程日志保留真实错误码。
5. **重点质疑 1**：`ENOTFOUND` 这条文案在本机没有触发过——不存在的域名返回 `ECONNRESET`。不要把它记成已验证。
6. **重点质疑 2**：档位只写进工作区设置并高亮，没有做「不同档位对模型输出有什么影响」的对照实验。
7. **重点质疑 3**：供应商页只管理当前模型的档位，没有按模型保存偏好；换模型后旧档位可能不受支持，界面会提示但不自动改。
8. **重点质疑 4**：安装生命周期本版未重跑，证据仍是 0.17.0 的 53 步（0.14.0 → 0.17.0）；两版差异在渲染层，但这不构成安装路径的证据。
9. 启动探测本轮 `rendererFirstContentfulPaintMs` 为 `null`（未采到），其余中位数：初始化 912 ms、窗口 1,020 ms、可交互 1,197 ms。
10. `visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名；依赖无变化（1,178／1,162，0 high、0 critical、32 moderate）。
