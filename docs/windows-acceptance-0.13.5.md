# 知行 0.13.5 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。本版把自动更新的安装环节改为静默，修掉「装完不自动重启」。 [迭代记录](iteration-0.13.5.md) · [签名说明](signing.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.13.5)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `2f15e8ec6359b46bd6061dd5799ff951f734cf31`，`sourceDirty=false` |
| 源码指纹 | `928bedd68a3a4beb9c9460551f6178c3abc345bb3ee35c840ac81c5ffa59fc08`，90 个匹配文件 |
| 锁文件 SHA-256 | `0d6d68c1627abb69ad636780727140830ed44833eca161044b4b9a5caf248e4c` |
| 源码回归 | 364 项，363 通过，0 失败，0 取消，1 条件跳过 |
| 目录包回归 | 323 项，322 通过，0 失败，0 取消，1 条件跳过 |
| Windows 桌面专项 | 5/5 |
| 启动测量 | 10 次中位数：`initialise` 909 ms、窗口显示 1,007 ms、可交互 1,188 ms |
| `知行.exe` | 246,317,568 bytes，SHA-256 `584471f3aedfde99b832047c2293b34ca1bc5d962d980b866a7d8aad0a5aa865` |
| `ZhiXing-0.13.5-x64.exe` | 338,649,482 bytes，SHA-256 `9e99ff116b10483f3bf9ecbfcbca231dce51688f12fd2418c81e41900e8004a7` |
| `ZhiXing-0.13.5-x64.exe.blockmap` | 315,032 bytes，SHA-256 `8e9694149c1897d1e587a7ed620071e43fd9b6d2996aab3de7c10f9285ea8a95` |
| `latest.yml` | 342 bytes，SHA-256 `183a87c18cf009c3ece63bfae111c3894f4da36f51a9313604586f5516da9f45` |
| 安装器签名 | `NotSigned`（证书未申请） |

## 依赖审计结论

生产清单 1,162 个包，0 high、0 critical、34 moderate；3 条命中安装路径，判定延续前几版，不修。

## 证据范围

**本版的核心改动在发布时尚未实机验证。** `quitAndInstall(true, true)` 的效果是「静默安装并自动重启」，验证它必须走「旧版本在跑 → 检测到新版本 → 装完自己回来」，而这条链路只能在 `0.13.5` 发布之后跑。`0.13.4` 上同一条链路的实测结果是安装成功但不重启，正是本版要修的断点。

安装生命周期、覆盖升级数据保留、跨版本存档兼容、自动更新检测与下载、崩溃记录点、生产环境后台检查的证据均来自之前的版本，本版未复跑。

签名仍未验证（无证书）。真实云服务、交互式安装、跨账户与真实用户资料未覆盖。
