# 知行 0.14.10 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.14.10` |
| 构建源码 | `3ac008465a1b15d57f64e2ee5dbc453ca93804d9`（`sourceDirty=false`） |
| 包内源码 | 96 个文件，指纹 `f68e7981860edfd3303b8bca65b74cd2bd209fbb77f5c95d8ebf100aec385b76` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,693,567 bytes，SHA-256 `14cfa3c9840879be115560f2e0177c79f5939d2369ae5127c2b53ec6e7aaa9db` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `4ab5647426b2589cdf4498743f41e97cac59dba1df1ab07381f2e717b3fc53e2` |
| blockmap | 314,811 bytes，SHA-256 `c01191bae117c482cc0c9c9913387ae682f282d0ebcae77b131a922c30e34ee7` |
| `latest.yml` | 345 bytes，SHA-256 `1a53fcbb251bb8bbf1146d94b76e4b8701701d78b080c02ad78f0a99e68dd16e` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 399：398 通过、1 跳过、0 失败（新增 `tests/archive-name.test.mjs` 4 个） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 351：350 通过、1 跳过、0 失败 |
| **子会话归档（实包）** | `npm run test:archive` | 6/6（含同名不覆盖） |
| ZIP 导出 | `test-zip-export-ui.mjs` | 4/4 |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 5/5 |
| 供应商错误文案 | `test-error-copy-ui.mjs` | 4 场景 + 4 组日志配对 |
| 聊天发送失败 | `test-chat-send-errors.mjs` | 2 场景 + 2 组日志配对 |
| 更新缓存清理 | `test-updater-cache.mjs` | 3/3 |
| 安装器临时目录 | `test-temp-hygiene.mjs` | 2/2 |
| 包内源码核对 | `verify-packed-sources.mjs` | 96 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 932 ms · 窗口 1,037 ms · 可交互 1,222 ms（中位） |

## 命名与不覆盖实包验收

| 检查 | 结果 |
| --- | --- |
| 默认文件名 | `子会话-<会话名>-<yyyyMMdd>-<序号>.md`，标题非法字符被替换 |
| 独占创建 | 预占目标文件后再点「归档」，新文件以 `-2.md` 结尾，内容为完整归档 |
| 提示 | `.execution-note` 显示最终路径（含 `-2`） |
| 其余 | 单条归档、批量归档、取消不写盘均通过 |

## 未通过的验收（不进发布门禁）

`npm run test:subagent`（真实子任务归档）仍未通过。本轮补充的排查证据：主会话请求携带 `subagent` 工具，工具返回 `started subagent qa-sales`，profile 下生成子会话历史 `harness/qa-real-chat/history-redact/7304cbab-*.bin`；假模型服务记录的 4 次请求全部是主会话的（初始、工具回灌、重试、子任务完成通知），没有一次来自子会话。设计上 `subagent-spawn-in-process` 会在同一 cordis 上下文新建 Agent、复用 `llm-deepseek` 配置，实际无请求的原因未查实。

## 证据范围

- 归档实包验收用脚本注入的合成子会话记录；真实模型子任务归档未通过。
- 归档只含对话文本（界面显示、已脱敏、可能截断），不含工具参数、原始返回与产物。
- 命名只在同一目录内退让；日期取自本机时钟。
- 只在 Windows x64 实包验证；安装器未签名；`historical-upgrade` 仍 `not_run`；真实云端未覆盖。

[本轮迭代](iteration-0.14.10.md) · [能力地图](harness-capability-map.md)
