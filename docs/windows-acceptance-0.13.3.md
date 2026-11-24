# 知行 0.13.3 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。本版无功能改动，补充跨版本存档兼容性测试。 [迭代记录](iteration-0.13.3.md) · [签名说明](signing.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.13.3)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `6656cc2df2740631b4983140a4c6205d97214533`，`sourceDirty=false` |
| 源码指纹 | `ebfae935fe4ee1fa5d07909f1512a9c968cc94c679cb81f201df384032416a66`，90 个匹配文件（与 `0.13.2` 相同，仅测试与版本号变化） |
| 锁文件 SHA-256 | `e99e002ad116409bae179d0e4b7ed43f7b40eac1520163fae763725e73d5cd2d` |
| 源码回归 | 364 项，363 通过，0 失败，0 取消，1 条件跳过（新增 4 项兼容性用例） |
| 目录包回归 | 323 项，322 通过，0 失败，0 取消，1 条件跳过 |
| Windows 桌面专项 | 5/5 |
| 跨版本兼容性 | 旧存档缺字段、未知新字段、损坏存档、幽灵草稿四类输入均不丢数据且不抛错 |
| **真实升级（检测＋下载）** | 打包 `0.13.2` 连真实 GitHub：`available 0.13.3` → 下载 349 秒 → `downloaded`；缓存包 323 MB，**sha256 与 `ZhiXing-0.13.3-x64.exe` 发布资产完全一致** |
| 启动测量 | 10 次中位数：`initialise` 933 ms、窗口显示 1,035 ms、可交互 1,211 ms |
| `知行.exe` | 246,317,568 bytes，SHA-256 `977e25ec99d6854dfd96b8b9ea167759b0eaf316613ea21cfd2c0e77da27a5d3` |
| `ZhiXing-0.13.3-x64.exe` | 338,650,183 bytes，SHA-256 `ae1429ff400dbd7acf05f9d3254fc9ba95930658146ce723f820f8141178de0f` |
| `ZhiXing-0.13.3-x64.exe.blockmap` | 315,142 bytes，SHA-256 `f08b3acd7211440ef0d8ed351fa6add2726202fd4375cec12170506649d000aa` |
| `latest.yml` | 342 bytes，SHA-256 `e48c1f22b7a4eab25b0320e357feb2a59fa5645b23560a8dd0c60bab3fcdb841` |
| 安装器签名 | `NotSigned`（证书未申请） |

## 依赖审计结论

生产清单 1,162 个包，0 high、0 critical、34 moderate；3 条命中安装路径，判定延续前几版，不修。

## 证据范围

兼容性证据是**单元层面**的：直接调用 `mergeState` 喂构造的旧结构。它证明数据合并逻辑不丢数据，**不能替代**一次真正的跨版本升级演练——安装器替换文件、Electron 版本变化导致的 profile 差异、以及 DPAPI 加密上下文，都不在单测覆盖范围内。

安装生命周期证据来自 `0.13.2` 安装包（首次安装、同版本覆盖、卸载保留、重装保留、外部目录启动），本版未复跑。历史版本升级的安装器路径仍未跑。

自动更新实测沿用 `0.13.0`；签名仍未验证（无证书）。真实云服务、交互式安装、跨账户与真实用户资料未覆盖。
