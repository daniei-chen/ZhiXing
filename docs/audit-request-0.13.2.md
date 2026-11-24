# 知行 0.13.2 外部审计说明

以 `v0.13.1` 为比较基线，包内生产源码为 `a81c99914ccce7d6036e2958f39ff3350882bfb9`，随包 Harness 固定为 `0.2.2-rc.5`。本版新增应用日志与诊断导出。 [Windows 验收](windows-acceptance-0.13.2.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.13.1-to-v0.13.2.patch` 核对差异。
2. **日志脱敏可复核**：`electron/app-log.mjs` 对形如 `key`／`token`／`secret`／`password`／`cookie`／`authorization` 的字段替换为 `[redacted]`，长字符串截断，不写聊天正文或文件内容。用 `node --test tests/app-log.test.mjs` 复跑 5 项单测。
3. **诊断导出可复核**：设置 → 关于 → 导出诊断信息，或设 `ZHIXING_DIAGNOSTICS_DIR` 指向目录后调用 `window.zhixing.exportDiagnostics()`。导出应含 `diagnostics.json` 与 `app.log`，且不含凭据字样。
4. **日志不是审计轨迹**：只记事件与错误消息，没有用户操作序列，也没有远程上报；未接 crashReporter，不生成 minidump。崩溃记录点（`uncaughtException`、`render-process-gone`）**未在真实崩溃场景下验证**。
5. `0.13.1` 出现的 2 项目录包测试超时本轮未复现（322 通过、0 失败、0 取消），按偶发处理。
6. 自动更新实测沿用 `0.13.0`；签名仍未验证（无证书）；**安装生命周期未在本版安装包上复跑**。真实云端、交互式安装、跨账户与真实用户资料不能从本机合成结果推断。
