# 知行 0.14.5 外部审计说明

本版没有产品代码改动，发布目的是让**安装生命周期第一次对当前安装包成立**。包内生产源码为 `1563f9b10c29715e24070dbe47bde04fd8f446bb`，指纹与 `0.14.4` 相同（`852f986a…`）。 [Windows 验收](windows-acceptance-0.14.5.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，用 `ZhiXing-v0.14.4-to-v0.14.5.patch` 核对差异——差异应当只有版本号与文档。
2. 生命周期证据在 `.preview/qa-0.14.5/install-evidence-20261125-042638-f906cee7/report.json`（随本版资产不包含该目录，需在验收机器上重跑）。重跑命令：

   ```powershell
   pwsh -NoProfile -File scripts/qa-install-lifecycle.ps1 -Mode Run `
     -Installer "<repo>\release\ZhiXing-0.14.5-x64.exe" `
     -FixtureManifest "<repo>\.preview\qa-0.14.5\lifecycle-fixture\manifest.json" `
     -HostBackupManifest "<host-backup-clean>\protected-host-manifest.json" `
     -PackedSourceManifest "<repo>\.preview\qa-0.14.5\packed-source-manifest.json"
   ```

   注意两点（本轮踩过，已记入 AGENTS.md）：① 跑之前必须删除桌面与开始菜单两条产品快捷方式，否则 `Assert-Installed` 会因 `--no-desktop-shortcut` 报 `Unexpected product shortcut target`；② 主机冷备份要在删除快捷方式之后取，否则前置检查的数量校验不通过。
3. 重点核对这几件事，而不是本文的结论：
   - 44 步里 `historical-upgrade` 是 `not_run`——没有旧版基线安装包，这条路径**没有证据**。
   - 首次安装、同版本覆盖、卸载、重装四次操作后，默认档案字节是否保持不变（脚本逐文件比对）。
   - 卸载是否真的移除了注册项，以及快捷方式是否按备份字节还原。
4. 装回真实用户环境必须带 `/D=D:\应用\知行`；不带时 NSIS 会装到 `%LOCALAPPDATA%\Programs\office-agent`（本轮发生过一次，已卸载重装）。
5. 已知限制：单机单账户；探针不点击界面、不是视觉验收；安装器未签名；真实云端未覆盖；跨账户解密不在范围。
6. 依赖未变：1,178／1,162，0 high、0 critical、32 moderate、2 条 unique 通告。
