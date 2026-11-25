# 知行 0.22.0 外部审计说明

本版把压缩口径对齐 DeepSeek Harness 桌面版的出厂默认：桌面版挂 `compaction-basic` 不带配置（阈值比例 0.8、保留比例 0.16、headroom 65,536），知行原来把 headroom 写死成 8,192，等于在同一窗口下把压缩点从 54,272 tokens 推到 102,400 tokens；同时补挂桌面版基础层本来就有的 `image-offload`。([Windows 验收](windows-acceptance-0.22.0.md) · [机制对照](harness-parity.md))

1. 先核对**证据来源**：本版结论来自解析本机 `resources/app.asar` 里的 `dsh-base/cordis.patch.yml`、`dsh-web-app/presets/cordis.patch.yml` 与 `dsh-compaction-basic/lib/index.js`（默认值 `DEFAULT_THRESHOLD_RATIO=.8`、`DEFAULT_RETAIN_RATIO=.16`、`headroomTokens ?? 65536`）。可以按同样路径复核。
2. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.21.0-to-v0.22.0.patch` 核对差异，重点看 `electron/compaction-policy.mjs`、`electron/runtime.mjs` 里 `compaction.config` 与 `image-offload` 两行、`tests/compaction-policy.test.mjs`。
3. 复跑 `npm test`（437 项）、`npm run test:packed`（354 项）、`npm run test:components`、`npm run test:sites`。
4. 复跑实包链路：`npm run test:chat`、`npm run test:restore-gap`、`npm run test:tools-ui`、`npm run test:errors`，以及真实云端三项（`test:ui-status`、`test:tool-redaction`、`test:workspace-tools`）。这些用例会启动内核，能证明新挂载的 `image-offload` 没有破坏插件解析。
5. **重点质疑 1**：本轮**没有**触发真实的压缩事件。阈值是按内核公式算出来的，没构造超阈值长对话验证「真在 54,272 触发」。
6. **重点质疑 2**：`image-offload` 只是挂载；它要图像路由被判超预算才会动作，本轮没有图片路由场景，没观察过它卸载图片。
7. **重点质疑 3**：小窗口收缩分支只有单测（16k／10k 窗口），没有在真实小窗口模型上跑过；`clamped` 目前只进函数返回，还没有落到界面或日志。
8. **重点质疑 4**：`token-meter` 的计数口径仍未逐项对照；`compaction-image-offload` 的「占位文本」与桌面版是否逐字一致未核对。
9. 安装生命周期本版未重跑（证据是 0.19.0 的 53 步）；`ENOTFOUND` 文案仍未端到端触发；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名；依赖无新增（1,178／1,162，0 high、0 critical、32 moderate）。
