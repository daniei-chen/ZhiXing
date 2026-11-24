# 知行 0.13.5 外部审计说明

以 `v0.13.4` 为比较基线，包内生产源码为 `2f15e8ec6359b46bd6061dd5799ff951f734cf31`，随包 Harness 固定为 `0.2.2-rc.5`。 [Windows 验收](windows-acceptance-0.13.5.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.13.4-to-v0.13.5.patch` 核对差异。生产源码指纹由 `0d1c3365…` 变为 `928bedd6…`，改动是 `electron/main.cjs` 里 `quitAndInstall(false, true)` → `quitAndInstall(true, true)` 一个参数。
2. **改动动机可复核**：`0.13.4` 上的实测记录显示安装成功（exe 版本从 `0.13.3.0` 变为 `0.13.4.0`）、旧进程退出，但应用没有自动重启——非静默模式下 NSIS 停在完成页等待点击。
3. **修复效果在发布时未验证**：验证需要「旧版本检测到 `0.13.5` 并自行重启」，只有发布后才能跑。审计时请以本版之后的实测记录为准，不要据本页的 patch 推断已验证。
4. 安装生命周期、覆盖升级、跨版本兼容、自动更新检测与下载、崩溃记录点的证据均来自此前版本，本版未复跑。
5. 签名仍未验证（无证书）。真实云端、交互式安装、跨账户与真实用户资料不能从本机合成结果推断。
