# 知行 0.13.2 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。本版新增应用日志与诊断导出。 [迭代记录](iteration-0.13.2.md) · [签名说明](signing.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.13.2)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `a81c99914ccce7d6036e2958f39ff3350882bfb9`，`sourceDirty=false` |
| 源码指纹 | `ebfae935fe4ee1fa5d07909f1512a9c968cc94c679cb81f201df384032416a66`，90 个匹配文件 |
| 锁文件 SHA-256 | `6e685c010100cdcef4e53f3d3f0f78d08a43215f4f457b92cdf7d7253df3e546` |
| 源码回归 | 360 项，359 通过，0 失败，0 取消，1 条件跳过 |
| 目录包回归 | 323 项，322 通过，0 失败，0 取消，1 条件跳过（上版 2 项超时未复现） |
| Windows 桌面专项 | 5/5 |
| 日志单元测试 | 5/5（写入、脱敏、轮转、导出复制、不可写目录） |
| 诊断导出端到端 | 通过：目录含 `app.log` + `diagnostics.json`，`app.start` 在册，版本与平台正确，未发现 `sk-…` / `Bearer …` 凭据 |
| 启动测量 | 10 次中位数：`initialise` 950 ms、窗口显示 1,070 ms、可交互 1,251 ms |
| `知行.exe` | 246,317,568 bytes，SHA-256 `e641df0db3e8f2e7ab4debcb1b09c7d7fc5d4a1428b900acfd17ec6fb93a180b` |
| `ZhiXing-0.13.2-x64.exe` | 338,649,406 bytes，SHA-256 `1994a18471c47df8c6ec584604262baf3284f27f1f831723e7ddf6486b13fbef` |
| `ZhiXing-0.13.2-x64.exe.blockmap` | 315,146 bytes，SHA-256 `bf7f1585d2f19f546d41df2ea9063ac6b3297beacfbda53f92c826028462c7b1` |
| `latest.yml` | 342 bytes，SHA-256 `2f3286ee67280ef102391810df4f6efc61924af61b17819ee2a053e5a851a2e2` |
| 安装器签名 | `NotSigned`（证书未申请） |

## 依赖审计结论

生产清单 1,162 个包，0 high、0 critical、34 moderate；3 条命中安装路径，判定与前两版相同，不修。

## 证据范围

日志与诊断导出在有内容与空内容两种情况下都验证过，但**没有模拟真实崩溃**（未触发 `uncaughtException` / `render-process-gone` 的真实场景），这几条记录点只验证了能被注册、不据此断言崩溃时一定能留下完整现场。未接入 crashReporter，不生成 minidump。

自动更新逻辑未改动，其实测结果沿用 `0.13.0`，本版未复跑。签名仍未验证（无证书）。**安装生命周期未在本版安装包上复跑**，`0.12.12` 的证据不能推广。真实云服务、交互式安装、跨账户与真实用户资料未覆盖。
