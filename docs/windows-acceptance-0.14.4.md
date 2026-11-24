# 知行 0.14.4 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.14.4` |
| 构建源码 | `33a2d3f97a0ff06ca271275b216322acd515b7c1`（`sourceDirty=false`） |
| 包内源码 | 93 个文件，指纹 `852f986a0a255293c5379ecee9f919b24bf9b58784cd8d38909e9dec71475654` |
| 锁文件 | `4c6ff05965c7b41c9f716fe96ccd080d8e21b832568305a01983ba95926e8bdb` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` · Node `v24.19.0` |
| 安装包 | `ZhiXing-0.14.4-x64.exe`，338,687,689 bytes，SHA-256 `d59dd4f3a796a836bc2af75bfefd6d4014ea69690736e8395db2333f860c1805` |
| 应用本体 | `知行.exe`，246,511,104 bytes，SHA-256 `d6ad17748e18d0d232e6983c0e4c21cb829de5702996d9d74db799bcb4d42a5f` |
| blockmap | 314,842 bytes，SHA-256 `bb23604fdfb2bb8b4467a6d16ace2351a7da3589b35b17fa56ade7c77c2ded28` |
| `latest.yml` | 342 bytes，SHA-256 `2765a933dafbf0adcd5f73951ed9bd446c62f5526a6de19b10fcbfcd01743d2c` |
| 签名 | `NotSigned`（没有证书，见 [signing.md](signing.md)） |

## 测试与实包验收

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 379 个：378 通过、1 跳过、0 失败（新增 8 个缓存清理用例） |
| 组件 | `npm run test:components` | 14 个全通过 |
| 站点 | `npm run test:sites` | 4 个全通过 |
| 打包源码 | `npm run test:packed` | 331 个：330 通过、1 跳过、0 失败（新增用例已进清单） |
| 原生文件导出（实包） | `test-native-files-export-ui.mjs` | 5 个场景通过 |
| 供应商错误文案（实包） | `test-error-copy-ui.mjs` | 4 个场景 + 4 组日志配对 |
| 聊天发送失败（实包） | `test-chat-send-errors.mjs` | 2 个场景 + 2 组日志配对 |
| **更新缓存清理（实包）** | `test-updater-cache.mjs` | 3 个场景通过 |
| 包内源码核对 | `verify-packed-sources.mjs` | 93 个文件与测试源码逐字节一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；均 0 high、0 critical、32 moderate、2 条公告 |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化完成中位 784 ms · 窗口可见 879 ms · 可交互 1,045 ms |

## 更新缓存：实包上的三种情况

脚本把 `LOCALAPPDATA` 指到临时目录，用真实打包应用启动，读应用自己的 `app.log` 与磁盘：

| 场景 | 预置 | 结果 |
| --- | --- | --- |
| 旧版本 + 待装新版本 | `ZhiXing-0.0.9-x64.exe`（4096 B）、`ZhiXing-99.0.0-x64.exe`（2048 B）、`current.blockmap`、`update-info.json` | 只删旧版本；新版本与两个元数据文件保留；日志 `files:1 bytes:4096` |
| 只有旧版本 | `ZhiXing-0.0.8-x64.exe` + 两个元数据 | 三个文件全删，`pending` 目录被收走 |
| 缓存目录不存在 | 无 | 启动照常，无 `updater.cache-prune-failed` |

## 安装到真实用户环境

| 步骤 | 结果 |
| --- | --- |
| 冷备份 | 113 个文件 + 2 条快捷方式逐字节记录 |
| 关闭应用 | 4 → 0 个进程 |
| 静默安装 `0.14.4` | 退出码 0，498 秒 |
| 启动 | 4 个进程；`app.start`：`version 0.14.4`、`previousVersion 0.14.3`、`updated true`；`last-version.txt` = `0.14.4` |
| 缓存清理（真实安装） | 启动后 `updater.cache-pruned {"files":1,"bytes":2097152}`：清掉预置的 `pending/ZhiXing-0.13.8-x64.exe`，保留文件名更新的 `ZhiXing-99.0.0-x64.exe` 及其元数据 |
| 合成残留清理 | 验证后删除遗留的占位文件与元数据；用户缓存目录现在为空 |
| 快捷方式 | 安装器重写两条 `.lnk`，目标仍为 `D:\应用\知行\知行.exe`；新 SHA-256：桌面 `de73ca687ccdae6b9da06a7ef2af471c5c5a44fcd42c4848e9e5c31f8fc53cb7`、开始菜单 `ea472c05ec0197f48a30787552e9ec8804ee83c31f3c672cf0965f70000aa67d` |
| 用户档案字节 | 113 个文件中 102 个逐字节不变，7 个 Chromium 缓存／`Local State`／`Preferences`，4 个本应用自己的写入（`last-version.txt`、`app.log`、`workspace.bin`、`automations.bin`） |
| 用户数据语义 | 升级前后各复制一份档案、用同一份 `0.14.4` 打开：项目 2→2、会话 0→0、草稿 1→1，名称逐项相同 |

## 关于那次 323.6 MB 残留

`11-24 19:32` 写入的 `pending/ZhiXing-0.13.8-x64.exe` 在 `03:15` 实测占 323.6 MB；`04:00` 复核时目录已空，**清理发生在 `0.14.4` 安装之前，原因未查明**。所以本版不声称「清掉了用户那 323 MB」；真实安装上的演示用的是文件名相同、内容为 2 MB 零填充的合成文件，用途只是证明真实安装路径会调用清理并留下日志。

## 依赖审计结论

仓库根 1,178 个生产包、实装树 1,162 个，全部与 `package-lock.json` 版本一致；0 high、0 critical、32 moderate、2 条独立公告，与 `0.14.3` 相同（本版未改依赖）。

## 证据范围

- 只在 Windows ×64、单机单账户上验证；macOS／Linux 缓存目录未覆盖。
- 7 天保留期分支只有源码层用例；实包场景覆盖的是「版本不高于当前版本」分支。
- 没有制造真实的 `downloadUpdate` 流程，「待装更新」由预放文件模拟。
- 没有验证「更新正在下载时启动应用」这一交错。
- 真实云端模型回答未覆盖（无可用 Key）。
- 安装生命周期本轮没有复跑；安装器未签名；视觉验收、跨账户解密不在范围。
- 环境注意：本机 shell 里 `ELECTRON_RUN_AS_NODE=1` 时直接启动 `知行.exe` 会以 Node 模式解析参数并立即退出，所有实包脚本都先删除该变量。

[本轮迭代](iteration-0.14.4.md) · [能力地图](harness-capability-map.md)
