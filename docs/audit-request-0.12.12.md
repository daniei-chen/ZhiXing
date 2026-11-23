# 知行 0.12.12 外部审计说明

以 `v0.12.11` 为比较基线，包内生产源码为 `d10a6263e7e9005cefccc8a8563f9453e757d760`，随包 Harness 固定为 `0.2.2-rc.5`。发布标签包含其后的文档及 Windows 复跑脚本。 [Windows 验收](windows-acceptance-0.12.12.md)

1. 校验完整安装器、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.12.11-to-v0.12.12.patch` 核对完整差异。
2. 文件观察可自行复核：启动打包应用后调用 `window.zhixing.watchWorkspace({workspaceId, projectId})`，在项目目录外写入文件应收到一次 `workspace:fs-change` 合批事件；调用 `unwatchWorkspace` 后不再收到。跨启动部分：关闭应用后写入文件，重启后 `listWorkspaceFiles` 应列出新文件且监视可重新建立。
3. 用 `npm test` 与 `npm run test:packed -- <目录包应用路径>` 核对回归，用 `node scripts/test-native-files-export-ui.mjs <目录包应用路径>` 复跑 Windows 桌面旅程。启动用 `node scripts/probe-startup.mjs <应用路径> 10`，**不要用单次样本比较版本**。
4. **安装证据对应 `0.12.11` 安装包，不是本版。** `windows-install-lifecycle.json` 记录的首次安装、同版本覆盖、卸载保留与重装保留均在该版本上完成；`0.12.12` 的安装包未复跑，不要据其推断本版安装行为，历史版本升级也未跑。
5. 使用 `production-inventory.json`、`production-sbom.cdx.json` 与 `advisories-by-path.json` 检查生产路径。真实云端、交互式安装、跨账户与真实用户资料不能从本机合成结果推断。
