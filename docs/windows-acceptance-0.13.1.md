# 知行 0.13.1 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。本版移除强制跳过签名，并记录首次长时间运行观察。 [迭代记录](iteration-0.13.1.md) · [签名说明](signing.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.13.1)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `1153da658f9b3e597f1cce1c8d0220833748c99c`，`sourceDirty=false` |
| 源码指纹 | `c5ba70996d268c64494c32644e8afd2ce9378c8580ee69e6b0089ce348f7aad8`，89 个匹配文件（与 `0.13.0` 相同，代码未变） |
| 锁文件 SHA-256 | `90162c609191f3a09fc73427dc2d0e5870405f7cdedae6751879d5c26bdb10a4` |
| 源码回归 | 355 项，354 通过，0 失败，0 取消，1 条件跳过 |
| 目录包回归 | 323 项，320 通过，0 失败，2 取消（超时），1 条件跳过 |
| Windows 桌面专项 | 5/5 |
| 空闲 soak | 29.8 分钟、54 次采样：工作集 393.1→394.1 MB（+1.0 MB），句柄 2,313→2,390（+77），进程数恒为 4，CPU 近零 |
| 签名行为 | 无证书时 `no code signing certificate configured, signing is skipped`，构建成功 |
| 启动测量 | 10 次中位数：`initialise` 919 ms、窗口显示 1,015 ms、可交互 1,193 ms |
| `知行.exe` | 246,317,568 bytes，SHA-256 `94317c8c8d714485832de0abbbc45582a205a5e4f2a87a9f02c3a85377a7611c` |
| `ZhiXing-0.13.1-x64.exe` | 338,647,778 bytes，SHA-256 `c887e1045d904681eedb123c6506fc06eeb6205aa16944150ac1ac2c4a18fc39` |
| `ZhiXing-0.13.1-x64.exe.blockmap` | 315,180 bytes，SHA-256 `448db4dc6fdd2736773dad2141b94661b922cea90867b42476f26c5e4dffbd48` |
| `latest.yml` | 342 bytes，SHA-256 `8fb890cef7d02ac1f03413143448069a74b4f207ac3ba73be12256f60ac2df93` |
| 安装器签名 | `NotSigned`（证书未申请，签名路径未经实测） |

## 依赖审计结论

生产清单 1,162 个包，0 high、0 critical、34 moderate；3 条命中安装路径，判定与 `0.13.0` 相同（`uuid` 路径不可达、`glob`/`minimatch` 属 npm CLI），不修。

## 证据范围

soak 只覆盖空闲态：无会话、无模型往返、无高负载文件监视。内存 +1 MB、句柄 +77 不能推断为「无泄漏」，只能说空闲半小时稳定。

签名只验证了「无证书时跳过」，**未验证有证书时的签名结果**，也未验证签名后的 SmartScreen 表现与跨版本升级。

自动更新逻辑未改动，其实测结果沿用 `0.13.0`（本地 feed 全链路 + 真实 GitHub feed 返回 `current`），本版未复跑。安装生命周期**未在本版安装包上复跑**，`0.12.12` 的证据不能推广到本版。真实云服务、交互式安装、跨账户与真实用户资料未覆盖。
