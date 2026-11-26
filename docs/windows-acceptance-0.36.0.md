# 知行 0.36.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.36.0` |
| 构建源码 | `4cfbb574bfb3f85db3f01632b79842b86832b4e9`（`sourceDirty=false`） |
| 包内源码指纹 | `36f3b65861407613e6d9b9c01f4355bffa50bc023a6516bb5b95d264fec1cc2a`（100 个文件） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | `ZhiXing-0.36.0-x64.exe` 338,712,969 B · `476c62deb42886733ed94147cac6f283cdd162635d8c56209ad62a0c61229705` |
| 增量包 | `ZhiXing-0.36.0-x64.exe.blockmap` 314,834 B · `0dcdf5cda9fedc235f1339bb5341d52c3d96f10ff86a23d6b3e498ad92d57472` |
| 更新描述 | `latest.yml` 342 B · `95b03b3041ef3f42e1613aeefea17b07554f624b1ff199e1faf5754f947cfd72` |
| 应用可执行 | `知行.exe` 246,511,104 B · `7b2a4fad7128c1c675892ed1651715597698595568f3a29873eb9242ba8e98fb` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 499：498 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **切换压缩成功路径（本版新增）** | `npm run test:model-switch` | **4/4**（证据 `model-switch/run-mwx2mox9`）：先压缩（12 条消息 / 67,072 B / 旧模型）→ 再提交（7 条消息 / 44,870 B / 新模型 `qa-small`）→ 界面多一轮正常答复、`errorText` 为空 → 用量 `上下文 12,792 / 32,768 tokens` |
| 切换压缩失败路径（0.35.0 起） | `npm run test:model-window` | 4/4（本版复跑，证据 `model-window/run-mwx2noqa`） |
| 溢出恢复 | `npm run test:overflow-recovery` | 本版未重跑（0.35.0 为 4/4） |
| 手动压缩 | `npm run test:compact-command` | 本版未重跑（0.35.0 为 5/5） |
| 自动压缩 | `npm run test:compaction` | 本版未重跑（0.23.0 为 4 条断言） |
| 错误文案端到端 | `npm run test:errors` | 本版未重跑（0.32.0 为 6/6，含真实 ENOTFOUND） |
| 改动对比／改动卡片／交付动作／行内引用／交付卡片／轨迹检索 | `test:review`／`test:changes`／`test:actions`／`test:inline-refs`／`test:deliverables`／`test:execution-search` | 本版未重跑（沿用 0.30.0／0.30.0／0.29.0／0.27.0／0.26.0／0.25.0） |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过（脚本退出码 0；其结果文件只记状态，故不声明条数） |
| 包内源码核对 | `verify-packed-sources.mjs` | 100 个文件与构建提交一致 |
| 依赖审计 | `audit-production-dependencies.mjs`（仓库／随包） | 1,178／1,162 个包，0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 调试端口 724 ms、CDP 1,020 ms、可交互 1,247 ms（中位）；首次内容绘制 `null` |

## 证据范围

- 本版**未改产品代码**：新增的是实包门禁 `npm run test:model-switch` 与两份证据。结论只到「打包应用在真实内核上确实能压缩后切换」这一层。
- 成功路径只在 32,768 窗口 / 8,192 输出、5 轮约 13,500 tokens 的历史上验证；不是全形状覆盖。
- 8,192 这类极小窗口在数学上无法收敛（阈值 3,072 < 固定开销约 4,600 tokens），本版**没有**改保留比例与阈值口径；0.35.0 的失败文案是目前的处理。
- 切换完成、请求发出前，输入区用量仍显示旧窗口（实测 131,072），成功后变为 32,768——已知显示缺陷，**未修**。
- 合成服务不回报 `usage`；真实厂商的用量形状是否造成同类不收敛，未验证。
- 图像卸载、真实云端、签名仍未覆盖。
- 长会话下存在「无法确认内核已退出，已保留会话恢复文件」：18 轮短消息在第 8–9 轮触发，5 轮长消息不触发；触发条件未查实，门禁已避开。
- 安装生命周期**没有为本版重跑**，仍是 0.24.0 的 53 步证据。
- `visualAcceptance` 与 `crossWindowsUserDecryption` 仍为 `outside_scope`。

[本轮迭代](iteration-0.36.0.md) · [审计说明](audit-request-0.36.0.md) · [机制对照](harness-parity.md)
