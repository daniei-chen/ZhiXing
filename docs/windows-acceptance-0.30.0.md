# 知行 0.30.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.30.0` |
| 构建源码 | 见 `build-provenance.json` 的 `sourceCommit`（`sourceDirty=false`） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | `ZhiXing-0.30.0-x64.exe` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 492：491 通过、1 跳过、0 失败（新增 `review-diff` 7 项、`review-view` 5 项） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **改动对比视图（本版新增）** | `npm run test:review` | 6/6：真实内核写四次文件；点改动文件卡片进入「改动」视图；新增／删除／折叠行判定正确（保留行不被标成删除）；切文件后内容随之变化；对比内容与真实写盘一致 |
| 改动文件卡片 | `npm run test:changes` | 5/5（本版把点击预期改为进入「改动」视图） |
| 交付文件动作 | `npm run test:actions` | 本版未重跑（0.29.0 为 7/7；本版未改交付卡片动作路径） |
| 行内文件引用 | `npm run test:inline-refs` | 本版未重跑（0.27.0 为 5/5） |
| 交付卡片 | `npm run test:deliverables` | 本版未重跑（0.26.0 为 5/5） |
| 执行轨迹检索 | `npm run test:execution-search` | 本版未重跑（0.25.0 为 5/5） |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过 |
| 包内源码核对 | `verify-packed-sources.mjs` | 与构建提交一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 0 high、0 critical |
| 启动耗时 | `probe-startup.mjs` ×10 | 见 `acceptance-summary-0.30.0.json` |

## 证据范围

- 本版对比的是**文件工具的每次写入**（`meta.diffs` 的前后文本 + 创建时用调用参数补的内容），不是桌面版的 git 工作树快照；终端与外部程序写入不进对比。
- 同一文件多次写入时对比按时间拼接、段间以 `⋯` 分隔，不是一次性总差异。
- 没有并排视图、换行开关与独立 review tab 地址；review 内的打开／定位控件未接。
- 实包证据来自本地假 OpenAI 服务 + 真实内核；**未在真实云端会话上跑**。
- 安装生命周期**没有为新包重跑**，仍是 0.24.0 的 53 步证据。
- 安装包未签名；`ENOTFOUND` 文案仍未端到端触发。

[本轮迭代](iteration-0.30.0.md) · [审计说明](audit-request-0.30.0.md) · [机制对照](harness-parity.md)
