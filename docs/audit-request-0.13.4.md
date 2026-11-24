# 知行 0.13.4 外部审计说明

以 `v0.13.3` 为比较基线，包内生产源码为 `fa49fbe22ecf6a4b591f527e64c656f9320f7c2d`，随包 Harness 固定为 `0.2.2-rc.5`。 [Windows 验收](windows-acceptance-0.13.4.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.13.3-to-v0.13.4.patch` 核对差异。生产源码指纹由 `ebfae935…` 变为 `0d1c3365…`，改动集中在 `electron/main.cjs` 的一行日志字段。
2. **唯一运行逻辑改动**：`unhandledRejection` 处理器增加 `stack`（截断 2000 字符）。复跑方式：用 Node inspector 注入 `Promise.reject(new Error('probe'))`，日志应同时含 `message` 与 `stack`，进程不应退出。
3. 四个崩溃记录点（`uncaughtException`、`unhandledRejection`、`render-process-gone`、`child-process-gone`）均经真实触发验证，但验证的是事件落盘，不是现场可完整重建；强杀时来不及写日志属预期。
4. 安装生命周期与覆盖升级证据来自 `0.13.3`，本版未复跑；`quitAndInstall` 串联路径仍未测。
5. 自动更新真实 GitHub 检测与下载在 `0.13.3` 上验证；本版未复跑。签名仍未验证（无证书）。真实云端、交互式安装、跨账户与真实用户资料不能从本机合成结果推断。
