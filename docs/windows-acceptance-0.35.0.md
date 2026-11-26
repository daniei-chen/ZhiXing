# 知行 0.35.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.35.0` |
| 构建源码 | `3037dbe42fca5455c011964b0a51880d83f9ff1b`（`sourceDirty=false`） |
| 包内源码指纹 | `36f3b65861407613e6d9b9c01f4355bffa50bc023a6516bb5b95d264fec1cc2a`（100 个文件） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | `ZhiXing-0.35.0-x64.exe` 338,713,060 B · `cf20938ee08159b32e714908f5ef34e9afa83187ef4fe365a956d6e612c988ec` |
| 增量包 | `ZhiXing-0.35.0-x64.exe.blockmap` 314,805 B · `cd3534e40ca51e1142314ab8cd38c6a0ed4ecd718649b4e4822ccca6a822641a` |
| 更新描述 | `latest.yml` 342 B · `fdda5f9c26c59785e8b98255f8ea5e9069b3b79697ff7d49bb4bb69a541b241c` |
| 应用可执行 | `知行.exe` 246,511,104 B · `a8e87950e667d176d0818a3e916f6919b86e3a41c996095bb05a312b5b6c57c0` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 499：498 通过、1 跳过、0 失败（含 `error-copy` 新增的切换压缩文案两条） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **切换型号窗口文案（本版改动）** | `npm run test:model-window` | 4/4：模型表按型号带 131,072／8,192 与输出 2,048；切到小窗口先压缩、不超额发送；**失败时正文含「装不下这段对话历史」且不再出现「检查服务地址、模型 ID、API Key 或额度」**；新会话用量按 `8,192` 显示 |
| 溢出恢复 | `npm run test:overflow-recovery` | 4/4（复跑通过） |
| 手动压缩 | `npm run test:compact-command` | 5/5（复跑通过） |
| 错误文案端到端 | `npm run test:errors` | 本版未重跑（0.32.0 为 6 条；本版只改映射与白名单，未改网络路径） |
| 改动对比／改动卡片／交付动作／行内引用／交付卡片／轨迹检索 | `test:review`／`test:changes`／`test:actions`／`test:inline-refs`／`test:deliverables`／`test:execution-search` | 本版未重跑（沿用 0.30.0／0.30.0／0.29.0／0.27.0／0.26.0／0.25.0 的证据） |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过（脚本退出码 0；其结果文件只记状态，故不声明条数） |
| 包内源码核对 | `verify-packed-sources.mjs` | 100 个文件与构建提交一致 |
| 依赖审计 | `audit-production-dependencies.mjs`（仓库／随包） | 1,178／1,162 个包，0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 调试端口 739 ms、CDP 1,040 ms、可交互 1,283 ms（中位）；首次内容绘制 `null` |

## 证据范围

- 本版改的是失败文案与失败码白名单；证据来自本地假服务 + 真实内核（桌面版自己抛出的 `MODEL_SWITCH_COMPACTION_FAILED`）+ 打包 EXE，**真实厂商没有参与**。
- 文案只做**文本断言**，没有做视觉核对（换行、窄窗口溢出、字号）。
- 只覆盖这一条失败码；未触发过的代码仍回退通用句，不做猜测性改写。
- 切换压缩的**成功路径仍未验证**（合成摘要被「摘要须小于原文」拒绝，见 0.34.0 与 0.35.0 两轮迭代说明）。
- 图像卸载仍未核对。
- 安装生命周期**没有为本版重跑**，仍是 0.24.0 的 53 步证据。
- 首次内容绘制仍为 `null`；安装包未签名。
- `visualAcceptance` 与 `crossWindowsUserDecryption` 仍为 `outside_scope`。

[本轮迭代](iteration-0.35.0.md) · [审计说明](audit-request-0.35.0.md) · [机制对照](harness-parity.md)
