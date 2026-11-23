# 知行 0.12.6 外部审计说明

以 `v0.12.5` 为比较基线，包内生产源码为 `01ac4fb5abc6f49afa5182c5ceccb0c905f298fd`，随包 Harness 固定为 `0.2.2-rc.5`。发布标签包含其后的文档及 Windows 复跑脚本。 [Windows 验收](windows-acceptance-0.12.6.md)

1. 校验完整安装器、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 和 `packed-source-manifest.json`。使用发行页提供的 `ZhiXing-v0.12.5-to-v0.12.6.patch` 核对完整差异。
2. 用 `npm test` 及 `npm run test:packed -- <目录包应用路径>` 核对版本观察、项目授权、项目外/链接拒绝、实际 ripgrep 回执和图片字节。补丁按顺序提交；第一步写入且第二步失败时，已写文件应保留，后续操作应停止。
3. 用 `node scripts/test-native-files-export-ui.mjs <目录包应用路径>` 复跑 Windows 桌面旅程。该脚本创建隔离合成档案，只替换审批和保存对话框选择。核对 `write` 拒绝、`apply_patch` 中途停止、Office 转换批准，以及重启前后真实请求、磁盘文件和执行记录。Markdown 保存字节应与主机审阅一致，跨会话移动和策略变化不得复用旧快照。
4. 使用 `windows-install-lifecycle.json` 核对安装器证据。通过 `production-inventory.json`、`production-sbom.cdx.json` 和 `advisories-by-path.json` 检查实际生产路径。单独记录真实云端、交互式安装、跨账户、真实用户资料和剩余上游能力，不能从本机合成结果推断通过。
