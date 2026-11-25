# 知行 0.26.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.26.0` |
| 构建源码 | `0c0ea9b13cbe53e1e7a49fd1d38b60010fa1cf5b`（`sourceDirty=false`） |
| 包内源码 | 98 个文件，指纹 `a3439ea236d858e5cd5578a9369453ad411607c446a4678ec7e6c18af44452ee` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,703,627 bytes，SHA-256 `c923b49e73fb11cc68bcea73ff404bc1544d366296ac9c7c4945588172a3c833` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `d8ec285d85818b992c2377084410010ac0452032d10030037683bf4f37cccd2e` |
| blockmap | 314,818 bytes，SHA-256 `b0ab2b0b4f8c2e61d09c7389c795c57f13957dd545b310864a15afe675965e0f` |
| `latest.yml` | 342 bytes，SHA-256 `b5a07d0feaa24dc8a393eb27a4582c695f508c5338572f416d082e5bfcb50169` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 457：456 通过、1 跳过、0 失败（新增 `deliverable-cards` 5/5） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **交付卡片（本版新增）** | `npm run test:deliverables` | 5/5：真实 `present` 声明五个文件；默认 4 张卡片（`data-count=5`）；说明「第三季度经营汇总」与类型「表格」「PDF 文档」「纯文本」正确；展开后 5 张且按钮变「收起」；收起回 4 张 |
| 执行轨迹检索 | `npm run test:execution-search` | 本版未重跑（0.25.0 为 5/5，本版未改其代码路径） |
| 消息反馈 | `npm run test:feedback` | 本版未重跑（0.24.0 为 7/7） |
| 压缩事件 | `npm run test:compaction` | 本版未重跑（0.23.0 为 4/4） |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过 |
| 包内源码核对 | `verify-packed-sources.mjs` | 98 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 1,178 / 1,162 包；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 799 ms · 窗口 904 ms · 可交互 1,073 ms（中位）；首次内容绘制仍为 `null` |

## 证据范围

- 本版只对标桌面版「交付卡片」：**改动文件卡片、正文行内代码引用变链接、在默认应用打开／定位控件都没有做**，对标表仍写「部分」。
- 卡片的类型来自扩展名，说明来自交付记录的 `description`；不解析正文、不读文件内容。
- 实包证据来自本地假 OpenAI 服务 + 真实内核 + 真实 `present` 工具；**未在真实云端会话上跑这套验收**。
- 安装生命周期沿用 0.24.0 的 53 步证据（本版只改渲染层与一个纯函数模块），**没有为新包重跑生命周期**，按「未覆盖」记录。
- Windows 安装包未签名；`ENOTFOUND` 文案仍无法在本机端到端触发。

[本轮迭代](iteration-0.26.0.md) · [审计说明](audit-request-0.26.0.md) · [机制对照](harness-parity.md)
