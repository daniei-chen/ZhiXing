# 知行 0.15.1 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.15.1` |
| 构建源码 | `b40d57cae6fcf77a300f6b381bd9f06a166df56e`（`sourceDirty=false`） |
| 包内源码 | 96 个文件，指纹 `012c107882a9a703f56cfba97937401b3759da28965e413c70373536725828f7` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,694,752 bytes，SHA-256 `c6576e76dcdd064e9344471a3444ce1f1224e802ae9d00b2ed3327612426af6b` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `5ff9ae4329821b8a98a312b6ea17f6afb444cf7d96f4cec822625220bf99d367` |
| blockmap | 314,885 bytes，SHA-256 `e833df447e20d7687edfdaea96e4aba371c908a2774e3ca9992e1f50335ef472` |
| `latest.yml` | 342 bytes，SHA-256 `0cc526a43348b9813846678e2388a7df1f83c883a8d2565a15cf071f5ce0ded7` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 408：407 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 353：352 通过、1 跳过、0 失败 |
| 原生文件导出（实包） | `test-native-files-export-ui.mjs` | 5 项 PASS |
| 临时目录清理（实包） | `npm run test:temp` | 3/3 |
| **工具时间线（实包 + 真实内核）** | `npm run test:tools-ui` | **2/2** |
| 包内源码核对 | `verify-packed-sources.mjs` | 96 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 887 ms · 窗口 989 ms · 可交互 1,160 ms（中位） |

## 工具时间线验收明细

| 项 | 值 |
| --- | --- |
| 供应方式 | 本地假 OpenAI 服务（SSE 流），不是真实云端 |
| 触发 | 模型返回一次 `todo_write` 的 tool_call，内核执行 |
| 界面显示 | 「调用 · 更新工作计划」「更新工作计划 · 完成」两行，默认展开 |
| 界面截图 | `.preview/qa-0.15.1/tool-timeline/run-mwvnv8fa/tool-timeline.png` |

## 证据范围

- 工具时间线由本地假服务触发，不是真实云端；真实云端下模型在无工作区会话里明确说没有 `glob` 工具，因此「有工作区的项目会话 + 真实云端 + 文件工具」这一层未覆盖。
- 时间线只有标签与耗时，不含工具参数和结果正文。
- 安装生命周期本轮未重跑；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名。

[本轮迭代](iteration-0.15.1.md) · [能力地图](harness-capability-map.md)
