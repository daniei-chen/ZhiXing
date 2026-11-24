# 知行 0.13.6 外部审计说明

以 `v0.13.5` 为比较基线，包内生产源码为 `671250eafb13371c8982df094b1de0131abe102d`，随包 Harness 固定为 `0.2.2-rc.5`。 [Windows 验收](windows-acceptance-0.13.6.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.13.5-to-v0.13.6.patch` 核对差异。生产源码指纹由 `928bedd6…` 变为 `d349ac3c…`，改动集中在 `electron/main.cjs`：`app.start` 增加 `previousVersion`／`updated` 两个字段并新增 `last-version.txt` 读写，`update:install` 增加一条 `update.install` 记录。
2. **改动动机可复核**：`0.13.5` 把更新安装改为静默后，日志里无法区分「这次启动来自更新器」与「用户手动打开」。本版两个字段正是为此。
3. **这两个字段的实际输出在发布时尚未观测**：需要 `0.13.5` 检测到 `0.13.6` 并装完自行重启。审计时请以该实测记录为准，不要据 patch 推断已验证。
4. `0.13.5` 的静默安装修复同样依赖这次实测。`0.13.4 → 0.13.5` 的测试结果（安装成功但不重启）测的是 `0.13.4` 内部的旧代码，不构成反证。
5. 安装生命周期、覆盖升级、跨版本兼容、崩溃记录点的证据来自此前版本，本版未复跑。签名仍未验证（无证书）。真实云端、交互式安装、跨账户不能从本机合成结果推断。
