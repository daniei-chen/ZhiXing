# 知行 0.13.0 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。本版接入应用内自动更新。 [迭代记录](iteration-0.13.0.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.13.0)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `aed8a2bde3cbd70b64d30a38e284b26abbd1691e`，`sourceDirty=false`，Node `v24.19.0` |
| 源码指纹 | `c5ba70996d268c64494c32644e8afd2ce9378c8580ee69e6b0089ce348f7aad8`，89 个匹配文件 |
| 锁文件 SHA-256 | `52ddff277930e457a6a04ee052db79d428d54304a7d587b898c2b32c0cba3c9c` |
| 源码回归 | 355 项，354 通过，0 失败，0 取消，1 条件跳过 |
| 组件与 Sites | 14/14、4/4；生产构建通过 |
| 目录包回归 | 323 项，322 通过，0 失败，0 取消，1 条件跳过 |
| Windows 桌面专项 | 5/5；真实目录包、真实 Harness、本机合成 Chat Completions |
| 自动更新（本地 feed） | `checking → available(0.99.0) → downloading(100%) → downloaded` |
| 更新配置 | `app-update.yml` 指向 GitHub `daniei-chen/ZhiXing`，`releaseType=prerelease` |
| `latest.yml` | `url`/`path` 均为 `ZhiXing-0.13.0-x64.exe`，sha512 与安装器一致 |
| 启动测量 | 10 次中位数：`initialise` 918 ms、窗口显示 1,034 ms、可交互 1,220 ms |
| 品牌核对 | 应用 9 种图标尺寸，原始墨竹素材未变 |
| `知行.exe` | 246,317,568 bytes，SHA-256 `24a14a99026821c5426a9ef1362ee65793487ce21bf6b529b0eb3358bf67d781` |
| `ZhiXing-0.13.0-x64.exe` | 338,647,326 bytes，SHA-256 `406eabf5d8be5155269fbe86107b76c8474d971444f9273c78b722bbbdfba80b` |
| `ZhiXing-0.13.0-x64.exe.blockmap` | 315,115 bytes，SHA-256 `b0f8267b4ec9b40b942304218edda42c8b1ef2ff2bc0e8dfedcf07eaaff21ddb` |
| `latest.yml` | 342 bytes，SHA-256 `36a27c568317ad8071e1082fc27229391d9edd02135f441726c850f541f82d30` |
| 安装器签名 | `NotSigned` |

## 依赖审计结论

生产清单 1,162 个包（较上版 +8，为 `electron-updater` 及其依赖），0 high、0 critical、34 moderate；3 条命中安装路径，其中 `uuid@8.3.2` 经 exceljs 引入但只用 v4、路径不可达，`glob`/`minimatch` 位于 npm CLI 不随产品发布。修复 `uuid` 需把 exceljs 降级到 3.4.0，风险大于收益，不修。

## 证据范围

自动更新只在本地 feed 上验证了检查、版本比较、下载与校验链路；**未从 GitHub 真实下载 338 MB 完整包，也未验证升级后新版本的启动与数据保留**，这两项需在发布后用旧安装包实测。更新包未签名，SmartScreen 提示仍在。

启动只覆盖空档案冷启动。**安装生命周期未在本版安装包上复跑**：`windows-install-lifecycle.json` 来自 `0.12.12` 安装包，不能据此推断本版安装行为。真实云服务、交互式安装、跨账户与真实用户资料未覆盖。原生 Auto reviewer、常驻 Host、OAuth、原生 ZIP 与完整子会话归档仍有缺口。
