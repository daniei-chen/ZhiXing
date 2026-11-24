# 知行 0.14.6 外部审计说明

本版改一处：启动时清理卡在 `%TEMP%\~nsu.tmp` 的卸载器副本。判据在 `electron/temp-hygiene.mjs`，实包验收在 `scripts/test-temp-hygiene.mjs`。 [Windows 验收](windows-acceptance-0.14.6.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.14.5-to-v0.14.6.patch` 核对差异，应当只有 `electron/temp-hygiene.mjs`、`tests/temp-hygiene.test.mjs`、`scripts/test-temp-hygiene.mjs`、`electron/main.cjs` 的调用点、`package.json` 与文档。
2. 读 `judgeStuckUninstaller` 与 `pruneStuckUninstaller`，重点核对三件事：
   - 目录名固定 `~nsu.tmp`，不做模糊匹配；
   - 只有可执行文件字节含 UTF-16「知行」或 UTF-8 `zhixing` 才认定是自己的——**不要**接受「按目录名判定」的简化；
   - 目录最近 10 分钟内被写过就跳过。
3. 重跑实包验收：`npm run test:temp -- "<repo>\release\win-unpacked\知行.exe"`。脚本会把子进程的 `TEMP`/`TMP` 指向证据目录，预放「自己的旧副本」和「别家应用的同名目录」，核对删了哪一个、日志是否只在真删时出现。
4. 重点质疑：真实机器上那次删除（21:28:36Z，209,663 字节）由一次默认 TEMP 的实包验收触发，日志在 `.preview/qa-0.14.6/native-files-ui/run-qYXEF0/profile/zhixing/logs/app.log`；用户环境首次启动时已无可清对象，因此用户日志里没有这条记录——不要把它读成「功能没生效」。
5. 已知限制：只处理 `~nsu.tmp`，`%TEMP%\ns*.tmp`（约 5.5 GB，多为别家应用）不在范围；卸载器未自删的根因未查明；10 分钟窗口内不清理；只在 Windows x64 验证；安装器未签名；真实云端未覆盖。
6. 依赖未变：1,178／1,162，0 high、0 critical、32 moderate、2 条 unique 通告。
