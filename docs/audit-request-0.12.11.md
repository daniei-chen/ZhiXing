# 知行 0.12.11 外部审计说明

以 `v0.12.10` 为比较基线，包内生产源码为 `006d220e6c029982bfab7aefe3572ee1b59f972a`，随包 Harness 固定为 `0.2.2-rc.5`。发布标签包含其后的文档及 Windows 复跑脚本。 [Windows 验收](windows-acceptance-0.12.11.md)

1. 校验完整安装器、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.12.10-to-v0.12.11.patch` 核对完整差异。
2. 用 `node scripts/probe-startup.mjs "release/win-unpacked/知行.exe" 10` 复测。**不要用单次样本比较版本**：本轮与 `0.12.10` 的差异约 100 ms，且未做同环境交替对比，处在 Windows 启动噪声的下限附近。
3. 用 `npm test` 与 `npm run test:packed -- <目录包应用路径>` 核对回归，用 `node scripts/test-native-files-export-ui.mjs <目录包应用路径>` 复跑 Windows 桌面旅程。延迟通道的守卫可在应用启动后直接调用 `window.zhixing.listAutomations()`、`browserState({})`、`speechStatus()` 复核。
4. 使用 `production-inventory.json`、`production-sbom.cdx.json` 与 `advisories-by-path.json` 检查生产路径。安装生命周期证据在 `windows-install-lifecycle.json`：同一账户、合成档案、主机字节备份，覆盖首次安装、同版本覆盖、卸载保留与重装保留；**历史版本升级未跑**（`historicalUpgrade=not_run`），不要据此推断跨版本升级。真实云端、交互式安装、跨账户与真实用户资料不能从本机合成结果推断。
