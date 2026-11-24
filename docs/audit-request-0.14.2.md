# 知行 0.14.2 外部审计说明

以 `v0.14.1` 为比较基线，包内生产源码为 `8f14485855d879fabee6d7c845c1fd4f0951eb9a`，随包 Harness 固定为 `0.2.2-rc.5`。 [Windows 验收](windows-acceptance-0.14.2.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.14.1-to-v0.14.2.patch` 核对差异。
2. **本版没有产品代码变化**，这一点可以自己验证，不必采信本文：`v0.14.1` 与 `v0.14.2` 的 `sourceFingerprint` 都是 `248d3815…3533e`、均为 90 个文件；`git diff v0.14.1 v0.14.2 -- src electron harness` 为空。安装包差异只来自版本串与构建元数据。
3. 本版的实际交付物是证据与工具：新增 `scripts/backup-host-bytes.ps1`（按 `qa-install-lifecycle.ps1` 需要的树哈希格式生成冷字节备份），以及 `docs/iteration-0.14.2.md` 记录的复跑结论。
4. 复跑安装生命周期：

   ```powershell
   pwsh -File scripts/backup-host-bytes.ps1 -Destination '.preview\qa-X\lifecycle-backup'
   # 正常关闭应用；按备份卸载用户安装（保留快捷方式）；确保现场没有任何产品快捷方式
   pwsh -File scripts/qa-install-lifecycle.ps1 -Mode Run `
     -Installer 'release\ZhiXing-0.14.2-x64.exe' `
     -FixtureManifest '<synthetic-fixture-manifest.json>' `
     -HostBackupManifest '.preview\qa-X\lifecycle-backup\protected-host-manifest.json' `
     -PackedSourceManifest '.preview\qa-X\packed-source-manifest.json'
   ```

   本轮这份报告在 `.preview/qa-0.14.1/install-evidence-20261125-004612-9cc7b664/report.json`，候选是 0.14.1 安装器，`historicalUpgrade` 为 `not_run`。
5. 已知限制（请勿外推）：
   - 生命周期整套流程的候选是 **0.14.1 安装器**；0.14.2 安装器只做了「静默安装 + 启动 + 版本/日志核对」。
   - `historicalUpgrade=not_run`：没有 `-BaselineInstaller`，从旧版本升级的数据迁移不在本轮证据里。
   - 同一账户、同一台机器、单个 Windows 账户；跨账户解密与视觉验收不在该脚本范围。
   - 测试期间机器上曾有两条用户快捷方式被按字节移出、结束后按字节还原；还原结果的 SHA-256 记录在验收文档中。若审计者要求「测试期间快捷方式始终在位」，本轮不满足该更严格口径。
6. 依赖无变化：1,178 个包，0 high、0 critical、32 moderate、2 条 unique 通告。Electron 仍为 `44.11.5`。签名仍未验证（无证书）。
