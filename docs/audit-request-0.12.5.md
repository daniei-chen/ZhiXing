# 知行 0.12.5 外部审计说明

审计基线为 `v0.12.4`。发行包的生产源码为 `3ca28636f437561ac0527859b91962f018da61f1`，Harness 固定为 `0.2.2-rc.5`。发布标签还包含验收记录和复跑脚本。 [Windows 验收](windows-acceptance-0.12.5.md)

1. 从发行页下载 Windows x64 完整安装器和 `SHA256SUMS-release.txt`。核对安装器哈希、`build-provenance.json` 和 `packed-source-manifest.json` 内的提交及源码指纹。用包含了二进制差异的 `ZhiXing-v0.12.4-to-v0.12.5.patch` 核对完整变更。
2. 检查 `office_convert`、`office_recalculate` 的项目范围、审批拒绝、同名处理、源文件保留、公式缓存和进程结束后仍存在的交付记录。检查 `office_render` 使用实际视觉路由，比较出站图片与未处理页面的 SHA-256，对收到的像素重跑 OCR。
3. 检查原生规划、目标和压缩命令，以及按钮对正在编辑的草稿和附件的影响。区分本机合成供应商的协议成功、Windows 桌面交互和真实云端质量。复跑 Windows 桌面专项可用 `node scripts/test-office-agent-ui.mjs`。
4. 查看 `production-inventory.json`、`production-sbom.cdx.json` 和 `advisories-by-path.json`，按实际随包的生产路径核对依赖。查看 `windows-install-lifecycle.json` 的合成档案、升级、覆盖、卸载和重装范围。

请单独记录真实云端、OCR 未识别内容、Office 全格式与字体、上游插件激活和临时文件语义，以及 Host、OAuth、原生文件工具、会话导出等剩余能力。 [能力地图](harness-capability-map.md)
