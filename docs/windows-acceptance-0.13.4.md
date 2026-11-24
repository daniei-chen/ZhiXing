# 知行 0.13.4 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。本版修复 `unhandledRejection` 缺少堆栈的问题。 [迭代记录](iteration-0.13.4.md) · [签名说明](signing.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.13.4)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `fa49fbe22ecf6a4b591f527e64c656f9320f7c2d`，`sourceDirty=false` |
| 源码指纹 | `0d1c3365b93899cea4cd0abb2ec048fdae466c0f6bb32cd9b2845dd4cc0da8ff`，90 个匹配文件 |
| 锁文件 SHA-256 | `87eee086debaf4a8b3db6a5f3d4083ea33bff2a82ed4bf9a8f71cd279234c52e` |
| 源码回归 | 364 项，363 通过，0 失败，0 取消，1 条件跳过 |
| 目录包回归 | 323 项，322 通过，0 失败，0 取消，1 条件跳过 |
| Windows 桌面专项 | 5/5 |
| `unhandledRejection` 堆栈 | 注入真实拒绝后日志含 `message` 与 `stack`，进程继续运行 |
| 崩溃记录点覆盖 | 四处全部真实触发：`uncaughtException`、`unhandledRejection`、`render-process-gone`、`child-process-gone` |
| 启动测量 | 10 次中位数：`initialise` 910 ms、窗口显示 1,031 ms、可交互 1,217 ms |
| `知行.exe` | 246,317,568 bytes，SHA-256 `f6ce11c750094407cda24fb8ea9c10fea9fd7d534b391bd1bf83f8ed2399c102` |
| `ZhiXing-0.13.4-x64.exe` | 338,649,550 bytes，SHA-256 `4a438152f9d50c43f147a849eee52794c6a40fc708a2a24fb6b756bf35b7d269` |
| `ZhiXing-0.13.4-x64.exe.blockmap` | 315,040 bytes，SHA-256 `aeb98d5438b906f19e7d30beacea0c8b75c3a843f207e972385b75191bcdeee9` |
| `latest.yml` | 342 bytes，SHA-256 `d223ed4897f97f8699cc71071f4d6955570f7aaeaa6aea17b8bc6de1bb3712bb` |
| 安装器签名 | `NotSigned`（证书未申请） |

## 依赖审计结论

生产清单 1,162 个包，0 high、0 critical、34 moderate；3 条命中安装路径，判定延续前几版，不修。

## 证据范围

四个崩溃记录点都经过真实触发验证，但验证的是「事件会落盘」，不是「崩溃现场可完整重建」。进程被强杀时来不及写日志，表现为什么都没有。

安装生命周期与覆盖升级证据来自 `0.13.3`（首次安装、同版本覆盖、卸载保留、重装保留、外部目录启动、降级再升级数据保留），本版未复跑。`quitAndInstall` 的「退出—安装—重拉」串联路径仍未测。

自动更新检测与下载在 `0.13.3` 上做过真实 GitHub 演练；本版未复跑。签名仍未验证（无证书）。真实云服务、交互式安装、跨账户与真实用户资料未覆盖。
