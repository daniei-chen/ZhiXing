# 知行 0.13.0 外部审计说明

以 `v0.12.12` 为比较基线，包内生产源码为 `aed8a2bde3cbd70b64d30a38e284b26abbd1691e`，随包 Harness 固定为 `0.2.2-rc.5`。 [Windows 验收](windows-acceptance-0.13.0.md)

1. 校验完整安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.12.12-to-v0.13.0.patch` 核对完整差异。
2. 自动更新可自行复核：从 `0.12.12` 安装版升级到本版，或在 `resources/app-update.yml` 指向的 GitHub 源之外用 `ZHIXING_UPDATE_FEED` 指到自建 feed（`latest.yml` + 同名安装包），验证 `checking → available → downloading → downloaded` 状态序列。安装包未签名，`latest.yml` 只做 sha512 校验，**不提供签名校验**。
3. 用 `npm test` 与 `npm run test:packed -- <目录包应用路径>` 核对回归，用 `node scripts/test-native-files-export-ui.mjs <目录包应用路径>` 复跑 Windows 桌面旅程。启动用 `node scripts/probe-startup.mjs <应用路径> 10`，不要用单次样本比较版本。
4. **安装生命周期证据对应 `0.12.12` 安装包，不是本版。** 本版安装包未复跑首次安装／覆盖／升级／卸载／重装，不要据旧证据推断本版安装行为。
5. 使用 `production-inventory.json`、`production-sbom.cdx.json` 与 `advisories-by-path.json` 检查生产路径。真实云端、交互式安装、跨账户与真实用户资料不能从本机合成结果推断。
