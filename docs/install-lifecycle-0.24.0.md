# 知行 0.24.0 安装生命周期复跑（P0-2）

> 这一轮不发新版本：代码没有改动，内容是**在 0.24.0 的安装包上重跑安装生命周期**，把停在 0.19.0 的证据刷新到当前版本。产物是本文件 + `.preview/qa-0.24.0/install-evidence-*/`。

## 为什么必须重跑

AGENTS 里记的最近一次完整生命周期是 **0.19.0**（53 步 / 38 通过 / 0 失败 / 0 未跑，`passed_configured_nonvisual_lifecycle`）。此后 0.20.0–0.24.0 连续五个版本改动过主进程启动路径（回答详情、压缩策略、图像卸载挂载修正、消息反馈 `feedback.bin`），安装、升级、卸载、重装这条链一次都没有在真实安装包上再走过。**旧版本的安装证据不能代表新版本。**

## 做法（按 0.14.2 起的固定顺序）

1. 正常关闭知行，按字节备份桌面与开始菜单两条快捷方式到 `.preview/qa-0.24.0/user-shortcuts/`（`C39575C1…`、`DB05A293…`），然后删除这两条（安装器用 `--no-desktop-shortcut`，旧入口指向旧目录会让 `Assert-Installed` 报 `Unexpected product shortcut target`）。
2. 用 `scripts/backup-host-bytes.ps1` 取冷备份 `.preview/qa-0.24.0/host-backup/protected-host-manifest.json`（此时快捷方式清单为空，与删除后的机器状态一致）。
3. 用用户安装自带的 `Uninstall 知行.exe /S /currentuser --keep-shortcuts` 卸载 0.24.0（13 秒、退出码 0，安装目录已清空），让脚本拿到「可运行的干净机器」。
4. `-Mode Inspect` 确认 `ready_for_same_account_backed_up_run`。
5. `-Mode Run`：候选 `release\ZhiXing-0.24.0-x64.exe`，基线 `release\ZhiXing-0.14.0-x64.exe`，fixture 用 `.preview/qa-0.17.0/fixture-candidate/manifest.json`（`sourceAppVersion=0.14.0`，三个合成项目、无真实凭据、无启用中的定时任务），包内源码清单用本轮 `packed-source-manifest.json`。
6. 跑完把 0.24.0 装回 `D:\应用\知行`（必须带 `/D=D:\应用\知行`），逐字节还原两条快捷方式，启动并确认 4 个进程。

## 结果

- 证据目录：`.preview/qa-0.24.0/install-evidence-20261126-015447-772fd12f/`（起于 01:54:47，终于 02:09:13，约 14.5 分钟；`sourceHead` 为 `524d5580`，工作树干净）。
- 结论：**53 步 / 38 通过 / 15 观察 / 0 失败 / 0 未跑**，状态 `passed_configured_nonvisual_lifecycle`，`blockers` 为空。
- 覆盖：首次安装、同版本覆盖、历史升级（0.14.0 → 0.24.0）、卸载保留、重装保留、工作目录外启动、项目哈希、会话哈希、草稿哈希、加密配置哈希（密文保留且应用可读）全部 `passed`；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`。
- 与 0.19.0 的对照：步数、通过与观察数、覆盖项**完全一致**——这五个版本的改动没有破坏安装、升级、卸载、重装与数据保留。注意口径：这不是「新功能通过」，而是「0.19.0 的结论在新包上仍然成立」。
- 装回用户环境：安装 163 秒、退出码 0；`知行.exe` SHA-256 `a3200f37…` 与发布资产一致；两条快捷方式按字节还原（`C39575C1…`、`DB05A293…`）；日志 `app.start {"version":"0.24.0","previousVersion":"0.24.0","updated":false}`（本次是同版本重装）；进程 4 个（main / gpu-process / utility / renderer）。

## 边界

- 仍是**同账户合成档案**（`passed_same_account_fixture_only`），没有真实凭据、没有启用中的定时任务，也没有跨 Windows 用户解密（`crossWindowsUserDecryption` 继续 `outside_scope`）。
- 只验 `0.14.0 → 0.24.0` 这一条升级路径；`visualAcceptance` 依旧 `outside_scope`——生命周期脚本不做逐像素比对。
- 0.24.0 安装包仍未签名（`NotSigned`）。
- 本轮**没有**改代码，所以既没有升版本号，也没有新的 GitHub release；发布资产仍是 0.24.0 那一版（18 个，`mismatched=0`）。
- P0-1 的 `ENOTFOUND` 依旧无法在本机端到端触发：本机代理把任意域名解析到 `198.18.0.13` 的 fake-IP 段，不存在的域名得到的是 `ECONNRESET` 而不是 DNS 失败；要真验这条文案，需要先关掉代理再做。
