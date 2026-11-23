# 知行 0.12.9 外部审计说明

以 `v0.12.8` 为比较基线，包内生产源码为 `2c5e007b82fff6baa76e6ddb2a0c451c97d9bec2`，随包 Harness 固定为 `0.2.2-rc.5`。发布标签包含其后的文档及 Windows 复跑脚本。 [Windows 验收](windows-acceptance-0.12.9.md)

1. 校验完整安装器、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 和 `packed-source-manifest.json`。使用发行页提供的 `ZhiXing-v0.12.8-to-v0.12.9.patch` 核对完整差异。
2. 用 `npm test` 与 `npm run test:packed -- <目录包应用路径>` 核对裁剪后的包：两套回归均应在裁剪树上保持 0 失败。
3. 用 `node scripts/test-native-files-export-ui.mjs <目录包应用路径>` 复跑 Windows 桌面旅程，确认 Office 转换、原生写入审批、多文件补丁与导出在裁剪后仍正常。
4. 使用 `production-inventory.json`、`production-sbom.cdx.json` 和 `advisories-by-path.json` 检查实际生产路径，并核对 `pruned` 字段列出的 16 个按设计裁剪的包确实不在包内。本轮未附 `windows-install-lifecycle.json`：安装生命周期未复跑，不得据此推断安装、升级或卸载通过。真实云端、交互式安装、跨账户与真实用户资料同样不能从本机合成结果推断。
