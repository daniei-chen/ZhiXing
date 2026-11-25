# 知行 0.14.12 · 把「从 0.14.0 升级」实测出来

## 问题

上一版（0.14.11）在 0.14.11 安装包上跑完安装生命周期，但 `historicalUpgrade` 仍是 `not_run`：仓库里没有更老的可安装基线，脚本只能声明「历史升级未测」。这是整条证据链上最大的缺口——用户真实场景是**从旧版升级**，不是同版本覆盖。

## 怎么改

不改产品代码（`git diff v0.14.11..HEAD -- src electron` 为空），补的是验收能力和它的前置条件：

1. 用 **0.14.0 安装包**（`ZhiXing-0.14.0-x64.exe`，338,681,277 bytes，`AAC2E671…`）作为 `-BaselineInstaller`。
2. 历史档案必须由 **0.14.0 自己**创建：装好 0.14.0 → 用它的界面把合成档案存成三个自定义项目 + 一条会话 + 一条草稿（脚本要求历史 fixture 有三个自定义项目，升级后才有四个草稿作用域可验）→ 关闭 → 卸载。
3. 清空注册项与快捷方式，取干净冷备份，再跑 `qa-install-lifecycle.ps1 -Mode Run -BaselineInstaller …`。

## 结果

报告 `.preview/qa-0.14.12/install-evidence-20261125-102142-d574e377/report.json`：**53 步、38 步通过、0 步 not_run**，状态 `passed_configured_nonvisual_lifecycle`（上一版是 `partial_historical_upgrade_not_run`），耗时 17 分钟。

| 覆盖项 | 0.14.11 | 0.14.12 |
| --- | --- | --- |
| `firstInstall` | passed | passed |
| `sameVersionOverlay` | passed | passed |
| **`historicalUpgrade`** | **not_run** | **passed_same_account_fixture_only** |
| `uninstallRetention` | passed | passed |
| `reinstallRetention` | passed | passed |
| `outsideCwdStartup` | passed | passed |
| 项目／会话／草稿哈希 | passed | passed |
| 加密配置 | 密文保持、可读 | 密文保持、可读 |
| `visualAcceptance` / `crossWindowsUserDecryption` | outside_scope | outside_scope |

## 边界

- `historicalUpgrade` 的结论是 **same-account fixture only**：同一个 Windows 账户、合成档案、单机；跨账户、跨机器、真实工作资料的历史升级仍未验证。
- 只测了 **0.14.0 → 0.14.12** 这一条升级路径；0.13.x 及更早版本、以及带真实附件/自动化/项目工作区的档案没有测。
- 本轮没有产品代码改动，因此没有重跑 0.14.10 的七套实包验收；那批证据继续代表这批代码。
- `visualAcceptance`、`crossWindowsUserDecryption` 仍是 `outside_scope`。
- 真实子任务归档仍未通过（子会话始终没有发出模型请求）。
- 安装器未签名；真实云端未覆盖。

[Windows 验收](windows-acceptance-0.14.12.md) · [能力地图](harness-capability-map.md)
