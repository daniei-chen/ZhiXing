# 知行 0.21.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.21.0` |
| 构建源码 | `e0141d33d9cfc10e2dea25b3df30514a84ea8e63`（`sourceDirty=false`） |
| 包内源码 | 96 个文件，指纹 `f1c37857aa26813e1b85c42d6ba5fc78cc9c8edda94f2eb4db67895fdb438af4` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,697,348 bytes，SHA-256 `9cf72629d39e43876f5c25d8b9ca81ff138b3e7cfd8987fdb3a4f32c12c01e94` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `f6762bc722c90be9ea51aa8bda96f696a370e9be70c8b94b2a6d47cabf1412e7` |
| blockmap | 314,811 bytes，SHA-256 `1f014075b74125321be2c1ae1e208eb7566adadb03973fecf4f62b0a2eadbc33` |
| `latest.yml` | 342 bytes，SHA-256 `75a05d094efb16dc03f969b4b4aa02860c457d81aa922995517c43f7d9a5a391` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 431：430 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| 详情 + 占位符降级 + 导出/分享说明（实包 + 本地假服务） | `npm run test:restore-gap` | 5/5，含「发送方式」断言 |
| 详情 + 供应商页档位 + 模型移除 + 状态行（实包 + 真实云端） | `npm run test:ui-status` | 7/7，含「发送方式」断言 |
| 工具结果脱敏（实包 + 真实云端） | `npm run test:tool-redaction` | 4/4 |
| 真实云端工作区工具（实包） | `npm run test:workspace-tools` | 4/4 |
| 工具时间线（实包 + 本地假服务） | `npm run test:tools-ui` | 2/2 |
| 错误文案（实包 + 真实网络故障） | `npm run test:errors` | 6/6 |
| 原生文件导出（实包） | `test-native-files-export-ui.mjs` | 5 项 PASS |
| 临时目录清理（实包） | `npm run test:temp` | 3/3 |
| 包内源码核对 | `verify-packed-sources.mjs` | 96 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 1,178 / 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 895 ms · 窗口 998 ms · 可交互 1,167 ms（中位）；首次内容绘制仍为 `null` |

## 发送方式行明细

| 场景 | 断言 |
| --- | --- |
| 脱敏模式且本机替换过（本地假服务，文本含假手机号） | 详情「发送方式」以「脱敏模式」开头 |
| 真实云端一轮 | 详情「发送方式」为「脱敏模式」 |
| 脱敏 + 替换 3 处（单测） | 「脱敏模式（本机替换 3 处敏感信息）」 |
| 非脱敏（单测） | 「非脱敏模式」 |
| 无 `privacyMode` 的老消息（单测） | 整行不生成 |

## 安装与进程

| 项 | 值 |
| --- | --- |
| 安装 | `ZhiXing-0.21.0-x64.exe`，退出码 0 |
| 安装后 `知行.exe` | 246,511,104 bytes，SHA-256 `f6762bc722c90be9ea51aa8bda96f696a370e9be70c8b94b2a6d47cabf1412e7`（与发布资产一致） |
| 快捷方式 | 按字节还原（`C39575C1…`、`DB05A293…`） |
| 日志 | `app.start` 版本字段见下方汇报 |
| 进程 | 主进程 1、GPU 1、网络 utility 1、渲染 1（额外的 Chromium service utility 若出现会在汇报里点名） |

## 证据范围

- 只显示消息上**已记录**的 `privacyMode`／`protectCount`；老消息没有该字段就不显示这一行，不回填。
- 「本机替换 N 处」是发送前本机替换的实体数，不等于「N 处敏感信息被彻底保护」，也不覆盖附件未解析、图片未识别。
- 详情不含本次请求的脱敏内容（请求文本刻意不落盘）。
- 安装生命周期本版未重跑：最近一次完整证据是 0.19.0 安装包上的 53 步（0.14.0 基线）。
- `ENOTFOUND` 文案仍未端到端触发（本机「不存在域名」返回 `ECONNRESET`）。
- 启动探测未采到首次内容绘制（`null`）。
- `visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名。

[本轮迭代](iteration-0.21.0.md) · [能力地图](harness-capability-map.md) · [第 5 个进程的追查](process-count-investigation.md)
