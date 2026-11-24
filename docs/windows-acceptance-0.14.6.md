# 知行 0.14.6 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.14.6` |
| 构建源码 | `472de676b6c2901ee64ca6966d091575fce69652`（`sourceDirty=false`） |
| 包内源码 | 94 个文件，指纹 `c1295d243ca1fd08817ce33b53688bda3840bb30290cf083f8f346dc49783cd8` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,689,041 bytes，SHA-256 `3f947f960662e0cf1b32fd5a361e783b790b1b0c788af3cbf6fa66503c6abd23` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `b3fa8104c38d1a61df2b03b7a674eba332b930e8ba2e721d1878f417a61b377b` |
| blockmap | 314,834 bytes，SHA-256 `4fd6ac66aa5bc46aacf9212fe34ef621e27177f1769bd89727a607d82d29d5e3` |
| `latest.yml` | 342 bytes，SHA-256 `c510d2a9c6ae6e6b86b5f139bea8431ad66b835f3d6e394596b0546e8819be4c` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 384：383 通过、1 跳过、0 失败（新增 `tests/temp-hygiene.test.mjs` 5 个） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 336：335 通过、1 跳过、0 失败 |
| **临时目录清理（实包）** | `npm run test:temp` | 2/2：删自己的旧副本（`bytes:262 files:1`）、别家同名目录保留且不记事件 |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 5/5 |
| 供应商错误文案 | `test-error-copy-ui.mjs` | 4 场景 + 4 组日志配对 |
| 聊天发送失败 | `test-chat-send-errors.mjs` | 2 场景 + 2 组日志配对 |
| 更新缓存清理 | `test-updater-cache.mjs` | 3/3 |
| 包内源码核对 | `verify-packed-sources.mjs` | 94 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 775 ms · 窗口 871 ms · 可交互 1,041 ms（中位） |

## 真实机器证据

| 事实 | 数据 |
| --- | --- |
| 清理前 | `%TEMP%\~nsu.tmp\Un_A.exe` 209,663 字节，21:28 之前的检查里存在 |
| 清理发生 | `test-native-files-export-ui.mjs` 运行时启动的是 0.14.6 打包构建，21:28:36Z 记 `temp.hygiene {"target":"~nsu.tmp","bytes":209663,"files":1,"reason":"stale-uninstaller-copy"}` |
| 清理后 | 该目录消失；用户环境首次启动 0.14.6（21:44:50Z）时已无可清对象，日志无第二条记录 |
| 未处理 | `%TEMP%\ns*.tmp` 12 个、约 5.5 GB，内容指向别家应用，本版不声称清理 |

## 安装回用户环境

| 步骤 | 结果 |
| --- | --- |
| 升级安装 | `ZhiXing-0.14.6-x64.exe /S /currentuser /D=D:\应用\知行`，退出码 0，507 秒 |
| 版本 | `知行.exe` = `0.14.6`，SHA-256 `b3fa8104…377b`，与发布资产一致 |
| 启动 | 4 个进程；`app.start`：`version 0.14.6`、`previousVersion 0.14.5`、`updated true`；`last-version.txt` = `0.14.6` |
| 用户档案 | 以 0.14.5 安装前的冷备份（114 个文件）为基准；升级前后各复制一份、同一份代码打开对比：项目 2→2、会话 0→0、草稿 1→1，`identical: true` |

## 证据范围

- 真实机器证据来自**默认 TEMP** 的一次实包验收运行，不是用户手动启动；日志在该次运行的 profile 内，未写入用户日志。
- 清理判据依赖卸载器 stub 内含产品名；stub 变化时该能力会静默放弃，需要重新核对。
- 卸载器未自删的根因未查明。
- 安装器未签名；真实云端未覆盖；跨账户解密不在范围；`historical-upgrade` 仍为 `not_run`。

[本轮迭代](iteration-0.14.6.md) · [能力地图](harness-capability-map.md)
