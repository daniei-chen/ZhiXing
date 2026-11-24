# 知行 0.13.9 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。本版把网络错误转成用户能行动的中文提示。 [迭代记录](iteration-0.13.9.md) · [签名说明](signing.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.13.9)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `20be1b3e257cfdedad337586e5224ce4f629cc4a`，`sourceDirty=false` |
| 源码指纹 | `98048446e3a9577c4f2e9a97a3693a1dd73527d2ed40563db8f86c57ff3ab1c5`，90 个匹配文件 |
| 锁文件 SHA-256 | `2d478e5a0db71aaa454a021593e56a0a74f8dfc8aa85b390d3260f222dc76688` |
| Electron | `44.11.5` |
| 源码回归 | 364 项，363 通过，0 失败，0 取消，1 条件跳过 |
| 目录包回归 | 323 项，322 通过，0 失败，0 取消，1 条件跳过 |
| Windows 桌面专项 | 5/5 |
| 启动测量 | 10 次中位数：`initialise` 815 ms、窗口显示 906 ms、可交互 1,072 ms |
| `知行.exe` | 246,511,104 bytes，SHA-256 `846c3ad75d5a4fc1768c405cea422c041b3e5879ba7e6bd02bbf5658472645f2` |
| `ZhiXing-0.13.9-x64.exe` | 338,680,853 bytes，SHA-256 `3b8cf6569c58ccb2d8adfd5875e9cab56f9eb4254a4f57dd9ac4b9e9a27a67ef` |
| `ZhiXing-0.13.9-x64.exe.blockmap` | 314,836 bytes，SHA-256 `7888b3887c573c0896b589da85b52a2c622c8e4873ce1c0a913f7d9663d9ce4f` |
| `latest.yml` | 342 bytes，SHA-256 `6ab8862b115ed287f4863aaf1b199c064c7ba17d8876582afabf667f676d2b78` |
| 安装器签名 | `NotSigned`（证书未申请） |

## 本版改动

`src/App.jsx` 的 `errorText()` 增加一层错误转换，把 401／403／429／域名解析／连接拒绝／连接中断／超时／证书问题映射成「用户该做什么」。匹配不到的保持原文。原始错误仍写诊断日志。

请求侧超时为 90 秒（`AbortSignal.timeout(90000)`）。无供应商配置时点发送直接打开供应商设置，不发请求。

## 依赖审计结论

生产清单 1,162 个包，0 high、0 critical、32 moderate。unique 通告 2 条，均为随包 npm CLI 内部的 `glob`／`minimatch`，只在插件安装时使用。

`production-inventory.json` 带 `runtime.electron` 字段（`44.11.5`），避免 `--omit=dev` 漏掉 Electron 自身通告。

## 证据范围

**错误文案映射未在真实网络故障下实测**。本轮验证覆盖构建、目录包回归和 Windows 桌面专项，没有构造真实的 401、DNS 解析失败或超时去确认界面最终呈现。匹配逻辑按错误串可推演，端到端表现没有证据。

真实云端未覆盖。签名未验证（无证书）。
