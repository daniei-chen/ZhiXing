# 知行 0.14.9 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.14.9` |
| 构建源码 | `a47d1913523b271649a4eb51d76062021d5d79f0`（`sourceDirty=false`） |
| 包内源码 | 95 个文件，指纹 `e035dcb1902623a055cb93e2d2348f2e47e0863757153ba9cc1fe72736f0f084` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,693,282 bytes，SHA-256 `d471ca36b7e487a60c354a43862e239ab88acac51cf61bfe8964f4a66dd80f8d` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `5f54a8271b315d32c951b74506caf670172b4fda461023d905c795c91c194bfa` |
| blockmap | 314,833 bytes，SHA-256 `e2bd553bdd8e322bc5b4985525b0e9bd0414b80eff02899e308eb3f105b571d1` |
| `latest.yml` | 342 bytes，SHA-256 `0992a01796c517c6f24478de44d8314b2be2fb1a81ae2d3c0110b9cdc5e8fbae` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 395：394 通过、1 跳过、0 失败（`tests/subagent-archive.test.mjs` 6 个） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 347：346 通过、1 跳过、0 失败 |
| **子会话归档（实包）** | `npm run test:archive` | 5/5（含批量归档） |
| ZIP 导出 | `test-zip-export-ui.mjs` | 4/4 |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 5/5 |
| 供应商错误文案 | `test-error-copy-ui.mjs` | 4 场景 + 4 组日志配对 |
| 聊天发送失败 | `test-chat-send-errors.mjs` | 2 场景 + 2 组日志配对 |
| 更新缓存清理 | `test-updater-cache.mjs` | 3/3 |
| 安装器临时目录 | `test-temp-hygiene.mjs` | 2/2 |
| 包内源码核对 | `verify-packed-sources.mjs` | 95 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 812 ms · 窗口 904 ms · 可交互 1,077 ms（中位） |

## 批量归档实包验收

| 检查 | 结果 |
| --- | --- |
| 入口 | 两个带对话的子任务时，标题行出现「全部归档」 |
| 文件结构 | `# 子会话归档 · 2 个子任务`，逐节 `## 子会话归档 · 子任务 N`，消息标题降为 `###` |
| 内容 | 第二个子任务的回答「北方下滑 3%，集中在东北。」出现在文件里 |
| 取消 | 不写文件、不显示成功提示 |
| 单条归档 | 与 0.14.8 相同：真实点击第一个「归档」按钮 → 原生对话框 → 读回核对 |

## 未通过的验收（不进发布门禁）

`npm run test:subagent`（`scripts/test-real-subagent-archive-ui.mjs`）本轮失败，失败点在「子会话是否发出自己的模型请求」：

| 观测 | 值 |
| --- | --- |
| 主会话请求 | 1 次，工具清单含 `subagent`（28 个工具） |
| 子任务启动 | 工具返回 `started subagent qa-sales`；profile 下生成子会话历史 `harness/qa-real-chat/history-redact/7304cbab-*.bin` |
| 子会话模型请求 | **0 次**（等待 30 秒仍为 0；假服务只收到主会话的两轮请求） |
| 推断 | 子会话疑似未继承当前供应商路由，未查实 |

## 证据范围

- 归档实包验收用的是脚本用 `saveWorkspace` 注入的**合成**子会话记录；真实跑一次模型子任务再归档仍未通过（见上表）。
- 归档只含对话文本，不含工具参数、原始返回与产物；文本是界面显示（已脱敏、可能截断）的版本。
- 只覆盖当前选中交办里的子任务，没有跨交办或定时归档。
- 只在 Windows x64 实包验证；安装器未签名；`historical-upgrade` 仍 `not_run`；真实云端未覆盖。

[本轮迭代](iteration-0.14.9.md) · [能力地图](harness-capability-map.md)
