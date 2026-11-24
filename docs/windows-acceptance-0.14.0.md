# 知行 0.14.0 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。本版把错误文案抽成共享模块，让五个界面统一生效。 [迭代记录](iteration-0.14.0.md) · [签名说明](signing.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.14.0)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `b1e7d234c97e13ddf7160d2fb55dd8d38df326e3`，`sourceDirty=false` |
| 源码指纹 | `75407c8eec5336228db531bedd253d23e7d0004100732c6c5c48c5499a4aed67`，90 个匹配文件 |
| 锁文件 SHA-256 | `65563fe00df34a13c19582403d0b45be98adf3efc1a861fcd660788ad5e88d5f` |
| Electron | `44.11.5` |
| 源码回归 | 364 项，363 通过，0 失败，0 取消，1 条件跳过 |
| 组件回归 | 14 项，14 通过，0 失败 |
| 站点回归 | 4 项，4 通过，0 失败 |
| 目录包回归 | 323 项，322 通过，0 失败，0 取消，1 条件跳过 |
| Windows 桌面专项 | 5/5 |
| 启动测量 | 10 次中位数：`initialise` 836 ms、窗口显示 932 ms、可交互 1,102 ms |
| `知行.exe` | 246,511,104 bytes，SHA-256 `b1b4af4d8abe88384ae599ce2ec23fde7d9dde76db0a5b50f9b689dbe6bffd54` |
| `ZhiXing-0.14.0-x64.exe` | 338,681,277 bytes，SHA-256 `aac2e671a68a126ba9be99312311743c6234aa77938f082ed498fb90285e6799` |
| `ZhiXing-0.14.0-x64.exe.blockmap` | 314,725 bytes，SHA-256 `0606c672a7e11b0a297a9adc488b761c39dafc5bf6a767907b0069f2a9641964` |
| `latest.yml` | 342 bytes，SHA-256 `68c51f0c3ced43b42785618b7427f93bdcbbc9df4e62a4df1507dc2fe4f01d8c` |
| 安装器签名 | `NotSigned`（证书未申请） |

## 本版改动

`src/error-copy.js` 新增，导出 `friendlyError`／`errorText`。原先 `errorText` 在 `App.jsx`、`AutomationDialog.jsx`、`HarnessPlugins.jsx`、`PluginMarket.jsx`、`ProviderSettings.jsx` 各定义一份，只有 `App.jsx` 那份带网络错误映射；其余四处显示原始错误串。现在五处统一引用同一模块。

`errorText` 入参改为 `String(error?.message ?? error)`，非 Error 值不再抛二次异常。

## 依赖审计结论

生产清单 1,162 个包，0 high、0 critical、32 moderate、2 条 unique 通告（随包 npm CLI 的 `glob`／`minimatch`，仅插件安装时使用）。`production-inventory.json` 带 `runtime.electron` 字段（`44.11.5`）。

## 证据范围

**错误文案映射仍未在真实网络故障下实测**。本轮验证的是「重构未破坏既有行为」与「覆盖扩大到五个界面」，没有构造真实的 401、DNS 解析失败或超时确认界面最终呈现。这是连续两个版本遗留的缺口，下一轮优先补。

真实云端未覆盖。签名未验证（无证书）。
