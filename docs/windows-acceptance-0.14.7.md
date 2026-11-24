# 知行 0.14.7 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.14.7` |
| 构建源码 | `7c8d552e29ae5eb95f8f7f15738a92cc6a689397`（`sourceDirty=false`） |
| 包内源码 | 95 个文件，指纹 `00182174f7bb90075de038c8b6541ed45500e2db5777097214fe146ddc04119e` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,691,676 bytes，SHA-256 `c1c01385b3d165f54385b85290fc31129bd857a29d44201f62ab05e801370a89` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `fc206f8112cddc5b02c59b8d5e8f93431284f8b8d91e4e7c2ef645d17464f8df` |
| blockmap | 314,928 bytes，SHA-256 `8075cdb29a5ea74d400a8e32c154071a5275d70f705ef0171c6242cde034e7b5` |
| `latest.yml` | 342 bytes，SHA-256 `b0a8a38325c001a2387692028d7bf2b3bb406924195c051f7b56b4e35c1fb89b` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 389：388 通过、1 跳过、0 失败（新增 `tests/zip-writer.test.mjs` 5 个） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 341：340 通过、1 跳过、0 失败 |
| **ZIP 导出（实包）** | `npm run test:zip` | 4/4：入口可用、真实点击写盘、yauzl 读回内容正确、取消不写盘 |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 5/5 |
| 供应商错误文案 | `test-error-copy-ui.mjs` | 4 场景 + 4 组日志配对 |
| 聊天发送失败 | `test-chat-send-errors.mjs` | 2 场景 + 2 组日志配对 |
| 更新缓存清理 | `test-updater-cache.mjs` | 3/3 |
| 安装器临时目录 | `test-temp-hygiene.mjs` | 2/2 |
| 包内源码核对 | `verify-packed-sources.mjs` | 95 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 783 ms · 窗口 874 ms · 可交互 1,045 ms（中位） |

## ZIP 实包验收细节

| 检查 | 结果 |
| --- | --- |
| 入口 | 文件页工具栏 `button[aria-label="打包为 ZIP"]` 存在且未禁用，真实鼠标点击触发 |
| 主进程 | 原生保存对话框被验收脚本接管，记录到 `title = 打包为 ZIP`、默认路径在项目目录下 |
| 归档内容 | 读回只有 `说明.md` 与 `src/data.txt`；中文名与内容逐字节相等；`.env`、`id_rsa.pem` 不在归档 |
| 界面提示 | `.workbench-note` 文本「已打包 2 个文件 → …」 |
| 取消 | 归档文件不存在，`.workbench-note` 不出现 |

## 安装回用户环境

| 步骤 | 结果 |
| --- | --- |
| 升级安装 | `ZhiXing-0.14.7-x64.exe /S /currentuser /D=D:\应用\知行`，退出码 0，503 秒 |
| 版本 | `知行.exe` = `0.14.7`，SHA-256 `fc206f81…f8df`，与发布资产一致 |
| 启动 | 4 个进程；`app.start`：`version 0.14.7`、`previousVersion 0.14.6`、`updated true` |
| 用户档案 | 以 0.14.5 安装前冷备份为基准做升级前后对比（同一份代码打开两份档案） |

## 证据范围

- ZIP 只在 Windows x64 实包上验证，读回用 yauzl；7-Zip、macOS 归档工具未逐一核对。
- 没有 ZIP64，4 GB 以上不支持；上限 2000 个文件 / 256 MB 由本版写死。
- 私密排除是路径名匹配，不扫描内容。
- 安装器未签名；`historical-upgrade` 仍为 `not_run`；真实云端未覆盖。

[本轮迭代](iteration-0.14.7.md) · [能力地图](harness-capability-map.md)
