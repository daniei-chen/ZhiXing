# 知行 0.12.7 外部审计说明

以 `v0.12.6` 为比较基线，包内生产源码为 `aad2cfabe6843d20f08bd4cc45230b9c2f7ffa47`，随包 Harness 固定为 `0.2.2-rc.5`。发布标签包含其后的文档及 Windows 复跑脚本。 [Windows 验收](windows-acceptance-0.12.7.md)

1. 校验完整安装器、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 和 `packed-source-manifest.json`。使用发行页提供的 `ZhiXing-v0.12.6-to-v0.12.7.patch` 核对完整差异。
2. 用 `npm test` 核对执行权限预设与图片格式。原生权限用例在真实 Harness 中逐档比较沙箱、历史 `permission/preset` 事件与审批策略；图片用例只依赖本机 Windows OCR 与合成图片。
3. 用 `node scripts/test-vision-ui.mjs <目录包应用路径>` 复跑 Windows 桌面旅程，核对拖放遮罩、重启恢复、策略变化拒绝与进程退出。
4. 使用 `production-inventory.json`、`production-sbom.cdx.json` 和 `advisories-by-path.json` 检查实际生产路径。本轮未附 `windows-install-lifecycle.json`：安装生命周期未复跑，不得据此推断安装、升级或卸载通过。真实云端、交互式安装、跨账户、真实用户资料和剩余上游能力同样不能从本机合成结果推断。
