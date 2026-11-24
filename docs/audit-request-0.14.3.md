# 知行 0.14.3 外部审计说明

以 `v0.14.2` 为比较基线，包内生产源码为 `a9b7ee1a0e16cb8ba082863f4351a23a712954ed`，随包 Harness 固定为 `0.2.2-rc.5`。 [Windows 验收](windows-acceptance-0.14.3.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.14.2-to-v0.14.3.patch` 核对差异。
2. 本版改的是**聊天发送失败时用户看到什么**。可以自己复现：`git diff v0.14.2 v0.14.3 -- src/error-copy.js src/conversation-state.js electron/run-failure.mjs electron/runtime.mjs`，只有四处 —— 新的失败原因提取模块、句子里带上状态／代码、气泡改走同一个文案映射、`electron-builder.yml` 补一个包内文件。
3. 复现实包证据（不需要真实 Key）：

   ```powershell
   # 本地假服务让模型目录成功、对话返回 401 或直接断连；脚本自己起服务、装临时档案
   node scripts/test-chat-send-errors.mjs "release\win-unpacked\知行.exe"
   ```

   证据目录 `.preview/qa-0.14.3/chat-send-errors/run-*/`：`result.json` 记录两次界面文案与两次主进程日志原文，`unauthorized.png`／`transport.png` 是当时的界面截图。
4. 重点看这几件事，而不是本文的结论：
   - 界面句子是否与 `src/error-copy.js` 的映射表一致（脚本里平行写了一遍，映射漂移会直接失败）。
   - 主进程日志 `run.turn-failed` 里的 `reason` 是否与界面文案同源（脚本断言 UI 文本 ≠ 技术原文）。
   - 有没有把「说不清原因」的失败硬说成网络问题：`CONTENT_REFUSED` 这类代码必须保持原句。
5. 已知限制（请勿外推）：
   - 401 与断连由**本地假服务**制造真实 HTTP 行为，不是真实供应商；真实云端回答本轮未覆盖（无可用 Key）。
   - `403`／`429`／证书错误／`SERVER`／`CONTEXT_WINDOW_EXCEEDED`／`UNKNOWN_MODEL` 只有映射层测试，实包上没有制造过这些响应。
   - 502 被统一解释成「连不上模型服务」：本机网关连不上上游、与上游自己返回 502，用户看到同一句。这是取舍，不是等价。
   - 安装生命周期本轮没有复跑，`0.14.2` 的证据仍只对 `0.14.1` 安装包成立；本版只做真实安装、启动与档案比对。
   - 同一台机器、单个 Windows 账户；安装器未签名；跨账户解密与视觉验收不在范围。
6. 依赖无变化：仓库根的生产树 1,178 个包（与 `0.14.2` 相同），0 high、0 critical、32 moderate、2 条 unique 通告。Electron 仍为 `44.11.5`。另有一份针对**实际安装树** `release/win-unpacked/resources/app` 的审计：1,162 个包，少掉的 16 个是打包时按清单裁剪掉的平台无关包，结论（0 high／0 critical／32 moderate）一致。两份清单都在 `.preview/qa-0.14.3/dependencies*/` 下。
