# 知行 0.32.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.32.0` |
| 构建源码 | 见 `build-provenance.json` 的 `sourceCommit`（`sourceDirty=false`） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | `ZhiXing-0.32.0-x64.exe` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 492：491 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **错误文案（本版重点）** | `npm run test:errors` | 6/6：真实 401、**真实 `ENOTFOUND`（新）**、被本机网络接住的 `ECONNRESET`（对照）、`ECONNREFUSED`、12 秒 `TIMEOUT`、日志保留技术原文而界面不搬 |
| 手动压缩命令 | `npm run test:compact-command` | 5/5 |
| 改动对比视图 | `npm run test:review` | 本版未重跑（0.30.0 为 6/6） |
| 改动文件卡片 | `npm run test:changes` | 本版未重跑（0.30.0 为 5/5） |
| 交付文件动作 | `npm run test:actions` | 本版未重跑（0.29.0 为 7/7） |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过 |
| 包内源码核对 | `verify-packed-sources.mjs` | 与构建提交一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 0 high、0 critical |
| 启动耗时 | `probe-startup.mjs` ×10 | 见 `acceptance-summary-0.32.0.json` |

## 证据范围

- 本版只改验收脚本，**产品代码未变**。
- `ENOTFOUND` 的成因是「主机名标签超过 63 字符导致解析失败」，与「域名不存在（NXDOMAIN）」共用同一个错误码，但不是同一种成因；本机 DNS 被代理接管，造不出 NXDOMAIN。
- 401 用例依赖真实访问 `api.deepseek.com`，网络中断时脚本会明确失败而不是跳过。
- 实包证据来自本机真实网络 + 打包 EXE，本轮**没有**真实云端会话证据。
- 安装生命周期**没有为新包重跑**，仍是 0.24.0 的 53 步证据。
- 安装包未签名；首次内容绘制仍为 `null`。

[本轮迭代](iteration-0.32.0.md) · [审计说明](audit-request-0.32.0.md) · [机制对照](harness-parity.md)
