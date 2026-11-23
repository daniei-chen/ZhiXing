# 知行 0.12.10 外部审计说明

以 `v0.12.9` 为比较基线，包内生产源码为 `5d6013bbcf08c254e5ae6c6ed04ac42677411671`，随包 Harness 固定为 `0.2.2-rc.5`。发布标签包含其后的文档及 Windows 复跑脚本。 [Windows 验收](windows-acceptance-0.12.10.md)

1. 校验完整安装器、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.12.9-to-v0.12.10.patch` 核对完整差异。
2. 用 `node scripts/probe-startup.mjs "release/win-unpacked/知行.exe" 5` 在本机复测启动中位数。**不要用单次样本比较版本**：本轮已实测 Windows 单次启动波动可达数百毫秒，且 `0.12.9` 与 `0.12.10` 的差异在噪声内。
3. 用 `npm test` 与 `npm run test:packed -- <目录包应用路径>` 核对回归，用 `node scripts/test-native-files-export-ui.mjs <目录包应用路径>` 复跑 Windows 桌面旅程。
4. 使用 `production-inventory.json`、`production-sbom.cdx.json` 与 `advisories-by-path.json` 检查生产路径。本轮未附 `windows-install-lifecycle.json`：安装生命周期未复跑。真实云端、交互式安装、跨账户与真实用户资料不能从本机合成结果推断。
