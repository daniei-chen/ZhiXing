# 知行 0.13.8 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。本版把 `uuid` 从 8.3.2 提到 11.1.1（`overrides`），并补跑 Electron 升级后的自动更新验证。 [迭代记录](iteration-0.13.8.md) · [签名说明](signing.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.13.8)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `fa5d34a2910950c50accf546826980940696b20d`，`sourceDirty=false` |
| 源码指纹 | `d349ac3c46f4cff7a37f1693425a2e731e8f058af88be7ea9c98813eafe85971`，90 个匹配文件 |
| 锁文件 SHA-256 | `e53e884c9c28eb6e1dcadb021968eb3b3269eb7812f4bf1cf2ce4dd10ee8e70d` |
| Electron | `44.11.5` |
| 源码回归 | 364 项，363 通过，0 失败，0 取消，1 条件跳过 |
| 目录包回归 | 323 项，322 通过，0 失败，0 取消，1 条件跳过 |
| Windows 桌面专项 | 5/5 |
| 启动测量 | 10 次中位数：`initialise` 876 ms、窗口显示 1,000 ms、可交互 1,178 ms |
| `知行.exe` | 246,511,104 bytes，SHA-256 `965186e285d060063490fc778551afdd97bb542f8dc6013e80e65d5e43fe39f6` |
| `ZhiXing-0.13.8-x64.exe` | 338,680,369 bytes，SHA-256 `749a9bfbcdb4b0d3da0d882b5a39c9f0a5bba59af1341f19a02fc2241bc68009` |
| `ZhiXing-0.13.8-x64.exe.blockmap` | 314,844 bytes，SHA-256 `8938c671594eb9455058896d63a53ea373037dc553299c63c682f31a5c36dd47` |
| `latest.yml` | 342 bytes，SHA-256 `e2c831e4a174149abdcf4a42b5aa57d3b15cd084fc885b4c3320ef92586d3dfe` |
| 安装器签名 | `NotSigned`（证书未申请） |

## 依赖审计结论

生产清单 1,162 个包，0 high、0 critical、**32 moderate**（上一版 34）。unique 通告从 3 条降为 2 条，剩余的是随包 npm CLI 内部的 `glob`／`minimatch`，仅在插件安装时使用。

`uuid` 已从 8.3.2 提到 11.1.1。`uuid@8` 停止维护且无修复版；`exceljs` 只用 `v4()`，`uuid@11` 保留该函数的 CJS 导出，写 xlsx 实测 6389 字节正常。`npm audit fix --force` 建议的「降级 exceljs 到 3.4.0」未被采纳。

`production-inventory.json` 带 `runtime.electron` 字段，避免 `--omit=dev` 再次漏掉 Electron 自身的通告（0.13.7 修掉的那条 high 就是这么漏的）。

## 自动更新补验

用打包的 `0.13.6` 做起点：检测到 `0.13.7`、下载 286 秒、静默安装、**应用在安装完成后被拉起**（`18:26:23`，4 个进程，路径位于测试安装目录）。Electron 跨 4 个小版本升级后，这条链路仍然可用。

## 证据范围

**验证脚本自身有缺陷**：Windows 下经 `execFileSync` 传递中文进程名会发生编码错乱导致匹配不到；改为按安装路径匹配后，手动执行返回 4，但脚本循环内仍报失败。因此「是否重启」以进程实测为准，脚本的 `relaunched` 字段不作数。

安装生命周期细节、跨版本存档兼容的证据来自更早版本，本版未复跑。签名仍未验证（无证书）。真实云服务、交互式安装、跨账户未覆盖。
