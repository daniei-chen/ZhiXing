# 知行 0.25.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.25.0` |
| 构建源码 | `2608f4e7c7b99c025cdb15dc32673cd9a09fd5f6`（`sourceDirty=false`） |
| 包内源码 | 98 个文件，指纹 `9f9407093f22240e7b18f5fb9d5bc8209b12273fc0a1923843e9f0e753595840` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,703,462 bytes，SHA-256 `991d145dd66a2ecfb1119ae1eb92ca268fa999f3bc746d8a432eb9f0fc9f6f5b` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `f83f808abdffda563076226343061b3eb3148f2009cbde705ea111bf92e1cca7` |
| blockmap | 314,844 bytes，SHA-256 `b07e8458172edf8a035a2a543d0218019962619a0329a58308583229cef6c336` |
| `latest.yml` | 342 bytes，SHA-256 `260f891d5e4354714985e8e176b552e0beb96d87edb95ba935421181ef68a0fb` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 452：451 通过、1 跳过、0 失败（新增 `trace-filter` 6/6） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **执行轨迹检索（本版新增）** | `npm run test:execution-search` | 5/5：搜索框占位「搜索」；按「数字计算」过滤只剩匹配行且摘要「匹配 N / M 条」；无匹配提示；清空恢复；收起／展开所有事件生效 |
| 消息反馈 | `npm run test:feedback` | 本版未重跑（0.24.0 为 7/7，本版未改其代码路径） |
| 压缩事件 | `npm run test:compaction` | 本版未重跑（0.23.0 为 4/4，本版未改压缩路径） |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过 |
| 包内源码核对 | `verify-packed-sources.mjs` | 98 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 1,178 / 1,162 包；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 798 ms · 窗口 902 ms · 可交互 1,074 ms（中位）；首次内容绘制仍为 `null` |

## 证据范围

- 本版只对标桌面版 Trajectory 工具栏的「搜索轨迹」与「展开／收起」，**按轮次分组的记录表、记录检查器（输入／输出／token 用量／TTFT）、时间概览与代码视图都没有做**，对标表仍写「部分」。
- 检索只在当前交办与当前事件分类内生效，不跨交办、不分页搜历史。
- 实包证据来自本地假 OpenAI 服务 + 打包后的真实内核；**未在真实云端会话上跑这套验收**。
- 安装生命周期仍旧沿用 0.24.0 的 53 步证据（本版只改了渲染层与一个纯函数模块，未动安装、升级、卸载路径），**没有为新包重跑生命周期**——这一点按「未覆盖」记录，不冒充通过。
- Windows 安装包未签名；`ENOTFOUND` 文案仍无法在本机端到端触发（本机代理把所有域名解析到 fake-IP 段）。

[本轮迭代](iteration-0.25.0.md) · [审计说明](audit-request-0.25.0.md) · [机制对照](harness-parity.md)
