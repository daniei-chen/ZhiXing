# 知行 0.13.7 外部审计说明

以 `v0.13.6` 为比较基线，包内生产源码为 `6e99b8fd0ed82eda31f9a82eb021ef943c901c75`，随包 Harness 固定为 `0.2.2-rc.5`。 [Windows 验收](windows-acceptance-0.13.7.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.13.6-to-v0.13.7.patch` 核对差异。
2. **本版主要改动是安全升级**：`electron` 由 `44.7.0` 升至 `44.11.5`，修复 `GHSA-jr5w-w6x2-84p9`（compromised eMudhra intermediate certificate mitigation，severity high）。`44.7.0` 落在受影响区间 `44.0.0-alpha.1 - 44.9.0` 内。
3. **为什么此前未发现**：Electron 在 `package.json` 中是 `devDependencies`，而 `npm audit --omit=dev` 与生产审计脚本都会按 dev 标记过滤。它实际是应用运行时。审计产物 `production-inventory.json` 现增加 `runtime.electron` 字段说明这一点。
4. 生产依赖审计：1,162 个包，0 high、0 critical、34 moderate。34 条来自 3 个 unique 通告，不可达理由写在验收页。完整 `npm audit`（含 dev）为 39 moderate、0 high。
5. **本版未复跑自动更新链路、安装生命周期与覆盖升级**；这些证据来自 `0.13.6`。Electron 跨 4 个小版本，回归覆盖源码、目录包、Windows 桌面专项三档。
6. 签名仍未验证（无证书）。真实云端、交互式安装、跨账户不能从本机合成结果推断。
