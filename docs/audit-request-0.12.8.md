# 知行 0.12.8 外部审计说明

以 `v0.12.7` 为比较基线，包内生产源码为待填构建提交，随包 Harness 固定为 `0.2.2-rc.5`。发布标签包含其后的文档及 Windows 复跑脚本。 [Windows 验收](windows-acceptance-0.12.8.md)

1. 校验完整安装器、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 和 `packed-source-manifest.json`。使用发行页提供的 `ZhiXing-v0.12.7-to-v0.12.8.patch` 核对完整差异。
2. 用 `npm test` 核对会话工作目录。原生用例在真实 Harness 中比较子目录读取、写入审批、搜索命中、`../..` 拒绝和重开后的目录事件，只用合成项目文件。
3. 用 `node scripts/test-native-files-export-ui.mjs <目录包应用路径>` 复跑 Windows 原生文件与导出旅程，确认新增工具没有改变既有项目文件行为。
4. 使用 `production-inventory.json`、`production-sbom.cdx.json` 和 `advisories-by-path.json` 检查实际生产路径。本轮未附 `windows-install-lifecycle.json`：安装生命周期未复跑，不得据此推断安装、升级或卸载通过。真实云端、交互式安装、跨账户、真实用户资料和剩余上游能力同样不能从本机合成结果推断。
