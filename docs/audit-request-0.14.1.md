# 知行 0.14.1 外部审计说明

以 `v0.14.0` 为比较基线，包内生产源码为 `3e0b5f17548e940fad1cb8730d417db875c21e2d`，随包 Harness 固定为 `0.2.2-rc.5`。 [Windows 验收](windows-acceptance-0.14.1.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.14.0-to-v0.14.1.patch` 核对差异。补丁含代码提交与文档提交；进入安装包的是 `3e0b5f1`，其后的 `b3758ed` 只改测试脚本，其余只改文档。
2. **本版只改一条链路**：`electron/model-catalog.mjs` 的 `fetchModels` 在 `fetch` 失败时保留系统错误码（`failureCode`），不再统一重抛一句固定文案。审计可对比 `v0.14.0..v0.14.1` 的 `electron/model-catalog.mjs`，确认只有 catch 分支与新增函数变化。
3. 界面侧 `src/error-copy.js` **未改**。请重点核对「主进程消息必须带真实原因、界面必须是另一句」这一对关系，而不是只核对映射表存在。
4. 复跑实包证据：`node scripts/test-error-copy-ui.mjs "release\win-unpacked\知行.exe"`。四个场景分别连真实 `api.deepseek.com`（假 Key）、不存在的域名、关闭的本机端口、本机挂起服务；脚本会断言界面文案、供应商未被保存、主进程日志与界面句不同、退出码为 0。
5. 已知限制（请勿外推）：
   - `ENOTFOUND`／`EAI_AGAIN` 文案**没有实包证据**。本机 DNS 把任意域名解析到 `198.18.0.x`，表现为 `ECONNRESET`；这两句只有 `tests/error-copy.test.mjs` 的源码层证据。
   - 聊天发送失败（模型请求 401 落到会话正文）**未测**，本轮只覆盖供应商设置的目录拉取。
   - HTTPS 证书错误、403、429 未构造真实服务端，只有映射层证据。
   - 真实云端模型回答仍未覆盖（无有效 Key）；签名仍未验证（无证书）；交互式安装、跨账户解密不能由本机合成结果推断。
6. 依赖无变化：1,178 个包，0 high、0 critical、32 moderate、2 条 unique 通告。Electron 仍为 `44.11.5`。
