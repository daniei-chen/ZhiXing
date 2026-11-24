# 知行 0.14.8 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.14.8` |
| 构建源码 | `2de08a4bade37ff619aa13edf7f92220b457e66a`（`sourceDirty=false`） |
| 包内源码 | 95 个文件，指纹 `6fb661e443946880fbeca347a2bad9cf999383ba00001f4da3d29db1e3c3398c` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,693,123 bytes，SHA-256 `19d9067030e27dd81634d8057f0002a33d67f4e817c13a4392bc6fb929cb2533` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `a03c9ce0711430dc2236b02ce07c27b6746cbb755a63f86987560599685eee4f` |
| blockmap | 314,738 bytes，SHA-256 `a6fc68002728a1c822622555e96dcd188e796c0ca1c5cda626d0a65d585ca3c5` |
| `latest.yml` | 342 bytes，SHA-256 `0a13e2c18bf72181e7297f7ad75fefe47495426806eb753dd5d31a9f723b73c7` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 393：392 通过、1 跳过、0 失败（新增 `tests/subagent-archive.test.mjs` 4 个） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 345：344 通过、1 跳过、0 失败 |
| **子会话归档（实包）** | `npm run test:archive` | 4/4 |
| ZIP 导出 | `test-zip-export-ui.mjs` | 4/4 |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 5/5 |
| 供应商错误文案 | `test-error-copy-ui.mjs` | 4 场景 + 4 组日志配对 |
| 聊天发送失败 | `test-chat-send-errors.mjs` | 2 场景 + 2 组日志配对 |
| 更新缓存清理 | `test-updater-cache.mjs` | 3/3 |
| 安装器临时目录 | `test-temp-hygiene.mjs` | 2/2 |
| 包内源码核对 | `verify-packed-sources.mjs` | 95 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 792 ms · 窗口 891 ms · 可交互 1,058 ms（中位） |

## 子会话归档实包验收细节

| 检查 | 结果 |
| --- | --- |
| 入口 | 执行面板「协作子任务」里出现「归档」按钮，真实鼠标点击触发 |
| 主进程 | 原生保存对话框被脚本接管，记录到 `title = 归档子会话`、默认文件名 `子会话-1.md` |
| 归档内容 | `# 子会话归档 · 子任务 1`；`- 所属会话：子会话归档验收`；`- 消息：2 条`；两段正文与注入的子会话消息逐字相等 |
| 界面提示 | `.execution-note` 文本「已归档到 …」 |
| 取消 | 归档文件不存在，`.execution-note` 不出现 |

## 安装回用户环境

| 步骤 | 结果 |
| --- | --- |
| 升级安装 | `ZhiXing-0.14.8-x64.exe /S /currentuser /D=D:\应用\知行` |
| 版本与进程 | 见本轮汇报；`app.start` 的 `previousVersion` 应为 `0.14.7` |

## 证据范围

- 子会话记录是验收脚本通过 `saveWorkspace` 注入的**合成**数据，不是真实模型子任务的产出；归档排版与写盘是真的，子任务本身没有真跑。
- 只归档子会话对话，不含工具参数、原始返回与产物文件；归档的是界面显示（已脱敏、可能截断）的文本。
- 只覆盖当前选中交办里的子任务，没有批量或定时归档，也不写入项目资料库。
- 只在 Windows x64 实包验证；安装器未签名；`historical-upgrade` 仍为 `not_run`；真实云端未覆盖。

[本轮迭代](iteration-0.14.8.md) · [能力地图](harness-capability-map.md)
