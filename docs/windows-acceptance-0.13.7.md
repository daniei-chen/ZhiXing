# 知行 0.13.7 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。本版把 Electron 从 `44.7.0` 升到 `44.11.5`，修复 `GHSA-jr5w-w6x2-84p9`（high）。 [迭代记录](iteration-0.13.7.md) · [签名说明](signing.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.13.7)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `6e99b8fd0ed82eda31f9a82eb021ef943c901c75`，`sourceDirty=false` |
| 源码指纹 | `d349ac3c46f4cff7a37f1693425a2e731e8f058af88be7ea9c98813eafe85971`，90 个匹配文件 |
| 锁文件 SHA-256 | `b9b01fd961ddddb052bfcc7c097539a13f1c525b5bf9963deff0322a7bd8c596` |
| Electron | `44.11.5`（升级前 `44.7.0` 命中 high 通告） |
| 源码回归 | 364 项，363 通过，0 失败，0 取消，1 条件跳过 |
| 目录包回归 | 323 项，322 通过，0 失败，0 取消，1 条件跳过 |
| Windows 桌面专项 | 5/5 |
| 启动测量 | 10 次中位数：`initialise` 925 ms、窗口显示 1,048 ms、可交互 1,227 ms |
| `知行.exe` | 246,511,104 bytes，SHA-256 `e859695541cdbeb0177524714ba0c67b08de297e6dda339161b4b7ac921efbec` |
| `ZhiXing-0.13.7-x64.exe` | 338,686,248 bytes，SHA-256 `333321a9fa586a7c00d40ae05d661a37a123058ef5462627f3d7e58ee00214a4` |
| `ZhiXing-0.13.7-x64.exe.blockmap` | 314,914 bytes，SHA-256 `93d78179e76614ceb56ef13c337a2db3aa8d8ff8e14febf13b8ace4a6d1995e5` |
| `latest.yml` | 342 bytes，SHA-256 `05552a833597241be2d5c2e40d86237fb98693f0de7b9f0a2839fe3a6db84f50` |
| 安装器签名 | `NotSigned`（证书未申请） |

## 依赖审计结论

生产清单 1,162 个包，0 high、0 critical、34 moderate。34 条来自 3 个 unique 通告，均判定不可达：`glob`／`minimatch` 只存在于随包 npm CLI，`uuid` 需要 `v3/v5/v6` 且传 `buf` 而 `exceljs` 只用 `v4()`。

完整的 `npm audit`（含 dev 树）为 39 moderate、0 high——升级 Electron 后 high 已消除。

`production-inventory.json` 新增 `runtime.electron` 字段，因为 npm 把 Electron 记为 devDependency，`--omit=dev` 会漏掉它的通告；这正是 `44.7.0` 期间 high 未被发现的原因。

## 证据范围

本版只更换运行时与审计脚本，**自动更新链路、安装生命周期、覆盖升级数据保留没有在本版复跑**。自动更新四环（检测／下载／静默安装／自动重启）的证据来自 `0.13.6` 的实测。

Electron 跨了 4 个小版本，回归覆盖源码、目录包和 Windows 桌面专项三档，未覆盖真实云端与真实用户资料。签名仍未验证（无证书）。
