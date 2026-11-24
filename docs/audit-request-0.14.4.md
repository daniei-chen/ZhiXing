# 知行 0.14.4 外部审计说明

以 `v0.14.3` 为比较基线，包内生产源码为 `33a2d3f97a0ff06ca271275b216322acd515b7c1`，随包 Harness 固定为 `0.2.2-rc.5`。 [Windows 验收](windows-acceptance-0.14.4.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.14.3-to-v0.14.4.patch` 核对差异。
2. 本版改的是**自动更新下载缓存的清理**，可以自己读：

   ```powershell
   git diff v0.14.3 v0.14.4 -- electron/updater-cache.mjs electron/main.cjs tests/updater-cache.test.mjs scripts/test-updater-cache.mjs
   ```

   核心只有三处：新的纯决策函数（`planCachePrune`）、执行删除的 `pruneUpdateCache`、从 `app-update.yml` 读目录名的 `updaterCacheDir`；主进程在 `app.start` 之后异步调用一次。
3. 复现实包证据（不需要网络）：

   ```powershell
   node scripts/test-updater-cache.mjs "release\win-unpacked\知行.exe"
   ```

   证据目录 `.preview/qa-0.14.4/updater-cache/run-*/`：每个场景一个 `profile-*/zhixing/logs/app.log`（含 `updater.cache-pruned` 的原始记录）与 `result.json`。脚本把 `LOCALAPPDATA` 指向临时目录，不碰审计机器上的真实更新缓存。
4. 重点看这几件事，而不是本文的结论：
   - 清理范围是否只在自己的缓存目录内：`updaterCacheDir` 只接受 `app-update.yml` 里不带路径分隔符的名字，`collect` 不跟随符号链接。
   - 正在等待的更新会不会被误删：实包场景一断言新版本与它的 blockmap、`update-info.json` 仍在。
   - 清理失败会不会影响启动：实包场景三是「缓存目录不存在」，断言没有 `updater.cache-prune-failed`。
5. 已知限制（请勿外推）：
   - 只在 Windows ×64 验证；macOS／Linux 的缓存目录规则不同。
   - 7 天保留期分支只有源码层用例，实包没有制造「超过 7 天且版本更高」的文件。
   - 没有真实 `downloadUpdate`：待装更新由预放文件模拟，没有验证「下载进行中启动应用」的交错。
   - **用户机器上那 323.6 MB 是在本版安装之前就被清掉的**（`03:15` 还在，`04:00` 已空，原因未查明）。真实安装上的演示用的是 2 MB 合成文件；不要把它当成「本版清掉了 323 MB」的证据。
   - 安装生命周期本轮没有复跑；安装器未签名；真实云端未覆盖。
6. 依赖无变化：仓库根 1,178 个包、实装树 1,162 个，0 high、0 critical、32 moderate、2 条 unique 通告。Electron 仍为 `44.11.5`。
