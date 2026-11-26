# 知行 0.34.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.34.0` |
| 构建源码 | `c65fa6caf9e2598487b06d863c299bc9407c67b4`（`sourceDirty=false`） |
| 包内源码指纹 | `e12fd32bffb2050add62e03f970dc9c1e33b3982563919baa89f9e6fc3223180`（100 个文件） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | `ZhiXing-0.34.0-x64.exe` 338,713,191 B · `e14d6d4d737583c987488a157aae092dad4fb8a54bb7f41c9b1b8942e68a13dc` |
| 增量包 | `ZhiXing-0.34.0-x64.exe.blockmap` 314,926 B · `4b664d376cad62cf6c70b67afd2431b0b8190edd69aec5d80d13fce5a3ed3f84` |
| 更新描述 | `latest.yml` 342 B · `cb49cec64689bab9f23e746db91648c7b5ceb4a2fcf5d6e3735acae6cd4cb5f8` |
| 应用可执行 | `知行.exe` 246,511,104 B · `dda428e17e219eb2d85bcac56b5a554382caf33dbe4af13e919bf66c6d48a570` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 498：497 通过、1 跳过、0 失败（含新增 6 例模型上限解析） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **按模型窗口（本版新增）** | `npm run test:model-window` | 4/4：运行时模型表按型号带 131,072／8,192 与输出上限；切到小窗口时先压缩、不直接超额发送；压缩失败保留 `MODEL_SWITCH_COMPACTION_FAILED` 且该轮显示未完成；新会话用量按 `8,192` 显示 |
| 溢出恢复 | `npm run test:overflow-recovery` | 4/4（0.33.0 引入，本版复跑通过） |
| 手动压缩 | `npm run test:compact-command` | 5/5（0.31.0 引入，本版复跑通过） |
| 错误文案端到端 | `npm run test:errors` | 本版未重跑（0.32.0 为 7 条） |
| 改动对比／改动卡片／交付动作／行内引用／交付卡片／轨迹检索 | `test:review`／`test:changes`／`test:actions`／`test:inline-refs`／`test:deliverables`／`test:execution-search` | 本版未重跑（各为 0.30.0／0.30.0／0.29.0／0.27.0／0.26.0／0.25.0 的证据） |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过（脚本退出码 0，其结果文件只记状态，故不声明条数） |
| 包内源码核对 | `verify-packed-sources.mjs` | 100 个文件与构建提交一致 |
| 依赖审计 | `audit-production-dependencies.mjs`（仓库／随包） | 1,178／1,162 个包，0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 调试端口 751 ms、CDP 1,034 ms、可交互 1,269 ms（中位）；首次内容绘制 `null` |

## 证据范围

- 本版改的是模型目录与运行配置的字段传递；验收用本地假 OpenAI 服务声明两个不同窗口的型号，**真实供应商没有参与**。
- **模型切换压缩的成功路径未验证**：假摘要只有 3 个字，检查点前言约 100 tokens，内核这次选中的被替换区间约 103 tokens，被「摘要不比原文小」的守卫拒绝。已证明的是「先压缩、不静默超额发送」与「失败码保留、该轮显示未完成」。
- 图像卸载仍未核对。
- 压缩失败时界面显示通用句，真实失败码只在日志（文案缺口，未改）。
- 安装生命周期**没有为本版重跑**，仍是 0.24.0 的 53 步证据。
- 首次内容绘制仍为 `null`；安装包未签名。
- `visualAcceptance` 与 `crossWindowsUserDecryption` 仍为 `outside_scope`。

[本轮迭代](iteration-0.34.0.md) · [审计说明](audit-request-0.34.0.md) · [机制对照](harness-parity.md)
