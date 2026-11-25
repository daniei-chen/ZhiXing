# 知行 0.14.11 外部审计说明

本版是**验收版**：没有产品代码改动（`git diff v0.14.10..HEAD -- src electron` 为空），只在当前安装包上完整复跑了安装生命周期。 [Windows 验收](windows-acceptance-0.14.11.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.14.10-to-v0.14.11.patch` 核对差异（应只有版本号与 `package-lock.json` 的同步）。
2. 读生命周期报告 `.preview/qa-0.14.11/install-evidence-20261125-093006-e4d41133/report.json`：44 步、31 passed、1 `not_run`，状态 `partial_historical_upgrade_not_run`；重点看 `firstInstall`、`sameVersionOverlay`、`uninstallRetention`、`reinstallRetention`、`outsideCwdStartup` 与四类哈希。
3. 复跑：`scripts/qa-install-lifecycle.ps1 -Mode Run` 需要三个清单（候选安装包、fixture 清单、**快捷方式删除之后**取的冷备份、包内源码清单）。先删快捷方式再取备份，否则前置检查会报 `Shortcut inventory differs from its byte backup`。
4. **重点质疑**：`historicalUpgrade` 仍然是 `not_run`。仓库里没有更早的可安装基线包，无法演练真正的旧版升级；同版本覆盖不能替代它。`visualAcceptance` 与 `crossWindowsUserDecryption` 仍是 `outside_scope`。
5. 本版没有重新跑 0.14.10 的七套实包验收；因为 `src/` 与 `electron/` 零差异，那批证据继续有效。若要求「每个安装包都重跑」，请按 `npm run test:archive`／`test:zip`／`test:errors`／`test:chat`／`test:updater`／`test:temp` 自行复跑。
6. 真实子任务归档仍未通过（子会话从未发出模型请求），归档验收仍是合成子会话记录。
7. 依赖未变：1,178／1,162，0 high、0 critical、32 moderate；安装器未签名；真实云端未覆盖。
