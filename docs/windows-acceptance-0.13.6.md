# 知行 0.13.6 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。本版给 `app.start` 增加 `previousVersion`／`updated`，并新增 `update.install` 记录。 [迭代记录](iteration-0.13.6.md) · [签名说明](signing.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.13.6)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `671250eafb13371c8982df094b1de0131abe102d`，`sourceDirty=false` |
| 源码指纹 | `d349ac3c46f4cff7a37f1693425a2e731e8f058af88be7ea9c98813eafe85971`，90 个匹配文件 |
| 锁文件 SHA-256 | `39cdbc5b32fbfdcac84d3d45f6cf3171a57f777eaf2b08bdef7efcc8868b555b` |
| 源码回归 | 364 项，363 通过，0 失败，0 取消，1 条件跳过 |
| 目录包回归 | 323 项，322 通过，0 失败，0 取消，1 条件跳过 |
| Windows 桌面专项 | 5/5 |
| 启动测量 | 10 次中位数：`initialise` 939 ms、窗口显示 1,047 ms、可交互 1,234 ms |
| `知行.exe` | 246,317,568 bytes，SHA-256 `8e1d1b5dd7833b07a5034fbd0698e1f3425acdc6a3fe4fd1b64941728aad316e` |
| `ZhiXing-0.13.6-x64.exe` | 338,649,641 bytes，SHA-256 `78cbab42f5353db622b7b3dc813b903a1744a11bc8d701683f4000aeb52e81b3` |
| `ZhiXing-0.13.6-x64.exe.blockmap` | 315,164 bytes，SHA-256 `490a3894b15c422e241941c57475f644178ebd17db82b1d3bb33c81875c5ebf5` |
| `latest.yml` | 342 bytes，SHA-256 `d632a4b93a159009c4a2b485bdc0ab21bc2f52193578ebd19c1a99d57c39eaa7` |
| 安装器签名 | `NotSigned`（证书未申请） |

## 依赖审计结论

生产清单 1,162 个包，0 high、0 critical、34 moderate；3 条命中安装路径，判定延续前几版，不修。

## 证据范围

本版新增的两个日志字段在源码和目录包回归中通过，但**它们在真实更新场景下的输出还没有观测到**——那需要 `0.13.5` 检测到 `0.13.6` 并装完自行重启，是本版发布后才会跑的一次实测。

`0.13.5` 的静默安装修复同样要靠这次实测确认。`0.13.4 → 0.13.5` 那次测试的结果（安装成功、不自动重启）不能作为反证：跑在机器上的是 `0.13.4`，执行的是它内部的旧代码。

安装生命周期、覆盖升级数据保留、跨版本存档兼容、崩溃记录点、生产环境后台检查的证据均来自之前的版本，本版未复跑。签名仍未验证（无证书）。真实云服务、交互式安装、跨账户未覆盖。
