# 知行 0.29.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.29.0` |
| 构建源码 | 见 `build-provenance.json` 的 `sourceCommit`（`sourceDirty=false`） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | `ZhiXing-0.29.0-x64.exe` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 480：479 通过、1 跳过、0 失败（新增 `file-actions` 4 项） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **交付文件动作（本版新增）** | `npm run test:actions` | 7/7：真实 `present` 交付两份文件；每张卡片一个「文件操作」入口；菜单三项与桌面版一致；Escape 关闭；点「在文件管理器中显示」后提示「已在文件管理器中显示。」；删掉文件后提示找不到位置；伪造引用被拒绝 |
| 改动文件卡片 | `npm run test:changes` | 本版未重跑（0.28.0 为 5/5；本版只改交付卡片与主进程动作路由） |
| 行内文件引用 | `npm run test:inline-refs` | 本版未重跑（0.27.0 为 5/5） |
| 交付卡片 | `npm run test:deliverables` | 本版未重跑（0.26.0 为 5/5） |
| 执行轨迹检索 | `npm run test:execution-search` | 本版未重跑（0.25.0 为 5/5） |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过 |
| 包内源码核对 | `verify-packed-sources.mjs` | 与构建提交一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 0 high、0 critical |
| 启动耗时 | `probe-startup.mjs` ×10 | 见 `acceptance-summary-0.29.0.json` |

## 证据范围

- 本版只新增「交付文件动作」；「在默认应用中打开」的成功路径**没有**在自动验收里点击（会拉起用户默认应用），属于未覆盖。
- 没有实现桌面版的 `skipped` 与 `nativeUnavailable` 状态；入口是「⋯」菜单而非右键上下文菜单；改动文件卡片没有接这两个动作。
- 实包证据来自本地假 OpenAI 服务 + 真实内核；**未在真实云端会话上跑**。
- 安装生命周期**没有为新包重跑**，仍是 0.24.0 的 53 步证据。
- 安装包未签名；`ENOTFOUND` 文案仍未端到端触发。

[本轮迭代](iteration-0.29.0.md) · [审计说明](audit-request-0.29.0.md) · [机制对照](harness-parity.md)
