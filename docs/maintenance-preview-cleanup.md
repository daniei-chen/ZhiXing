# 2026-11-25 维护：`.preview` 与历史更新缓存清理

本轮不改产品代码、不发版。P3 待办里两项（`.preview` 历史目录、updater 323 MB 缓存）都是本机磁盘与证据管理问题，清完即可，不需要新版本；清理前后都验证用户安装未被触碰。

## 问题

1. `.preview` 累积到 **36.12 GB / 81 个版本目录**。占用几乎全是二进制副本：安装器与解包后的应用 20.8 GB（`.exe`）、语音模型副本 9.0 GB（`.onnx`）、blockmap 17 MB。这些内容 GitHub release 上都有，本地不必各留一份。
2. `%LOCALAPPDATA%\office-agent-updater\installer.exe` 一直占着 **323 MB**。这是**改名前的构建**用的缓存目录名（当时 `updaterCacheDirName: office-agent-updater`）；0.14.4 起的启动清理只按当前 `app-update.yml` 里的 `zhixing-updater` 走，旧目录再也不会被碰到。它不是产品 bug，而是本机遗留。

## 怎么改

新增两个可重复执行的维护脚本（都不改产品行为）：

- `scripts/clean-preview-evidence.mjs`：只删 `.preview` 下的二进制证据副本（`exe/msi/blockmap/zip/7z/onnx/dmg/appx`），文本证据（`json/png/md/patch/log`）全部保留；`--dry-run` 只报告，`--keep-release-assets` 保留当前版本发布资产副本以便本地复核远端 digest。删完顺手收走空目录。
- `scripts/clean-dev-updater-cache.mjs`：只处理 `office-agent-updater` 这个遗留目录，且必须满足「目录里的可执行文件字节含 UTF-16『知行』或 UTF-8『zhixing』」才删；不满足就报 `unproven-left-alone` 不动文件——与产品内 `temp-hygiene` 的判据保持一致，不凭目录名删别家缓存。

另外手工删除了 `.preview\i QA`（测试安装目标，含一个 1.24 GB 的解包应用，无证据文件）、`.preview` 下所有 `win-unpacked` 副本、以及 0.17.0 以前版本目录里的临时档案目录（`*profile*` / `*user-data*`，共 590 个、3.3 GB）。

`package.json` 增加 `maintenance:preview` 与 `maintenance:updater-cache` 两个入口。

## 结果

| 项 | 清理前 | 清理后 |
| --- | --- | --- |
| `.preview` 总占用 | 36.12 GB | **18.55 GB** |
| 其中二进制副本 | 30.5 GB | 0 |
| 遗留更新缓存 | 323 MB | 0 |
| 用户安装 `D:\应用\知行` | 0.19.0 / 4 进程 | 0.19.0 / 4 进程（未触碰） |

释放合计约 **18.2 GB**。`npm test` 仍为 424 项（423 通过、1 跳过、0 失败）。

清理后逐项核对文档引用的证据仍在：

- `.preview\qa-0.19.0\install-evidence-20261125-185509-1ca625a5\report.json`
- `.preview\qa-0.19.0\restore-gap\run-mwvyu39k\result.json`
- `.preview\qa-0.18.0\packed-source-manifest.json`
- `.preview\qa-0.19.0\release-assets\SHA256SUMS-release.txt`
- `.preview\qa-0.19.0\host-backup\protected-host-manifest.json`
- `.preview\qa-0.17.0\fixture-candidate\manifest.json`

## 边界

- 只清二进制与临时档案；**早期版本的 `report.json`、结论摘要与截图都保留**，但早期版本目录里那些随包解开的 `.js/.cjs/.pak` 仍在（约占剩余 18.55 GB 的大部分），本轮没有再切。
- 遗留缓存只删了能证明是本项目的那一份；`%TEMP%` 里那 11 个无法归属的 `ns*.tmp` 目录仍未动（0.19.0 生命周期轮已记录原因）。
- 清理不影响产品逻辑，因此**没有新版本、没有新 tag**；下一次发版的安装包与源码本来就不同，无需为此重建。
- 早于 0.17.0 的版本目录里，部分 `*profile*` 目录被整体删除，这些目录**不含**文档引用过的文件；若外部审计要复现早期版本的运行态截图，需要重新跑对应脚本。
