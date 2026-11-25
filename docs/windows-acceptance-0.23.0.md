# 知行 0.23.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.23.0` |
| 构建源码 | `1517850e952eab07fc2d7cba61817daabfcad811`（`sourceDirty=false`） |
| 包内源码 | 97 个文件，指纹 `86aeacc3d77092d463ae87ffb7902896a4c0d66ad327077bcba5511b3eac1474`（与 0.22.1 相同：本版未改运行时代码） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,698,722 bytes，SHA-256 `e8d6718516079e9226aaf2f50ce8b410921090107f9d7e6827c747a226e4d291` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `7dfe65c1e90b421ff10275b45f597df8cc616b6ab7ab6a3913e085df68fa6296` |
| blockmap | 314,832 bytes，SHA-256 `fef490e285e6f26368f95ff7e1e23f624a1596dadc64e769506e30866b92285e` |
| `latest.yml` | 342 bytes，SHA-256 `f771f34fa3a365ec69e32f51c91997dffd8d5eb0ed5bab1fc407a1bbbffc2609` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 439：438 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **压缩事件（本版新增）** | `npm run test:compaction` | 4/4：摘要请求 1、检查点请求 1、请求由 216,056 降到 122,222 字符、界面无错误 |
| 聊天失败文案（实包） | `npm run test:chat` | 2 项 PASS |
| 详情 / 占位符 / 导出分享（实包 + 本地假服务） | `npm run test:restore-gap` | 5/5 |
| 工具时间线（实包 + 本地假服务） | `npm run test:tools-ui` | 2/2 |
| 状态行 / 供应商档位 / 模型移除（实包 + 真实云端） | `npm run test:ui-status` | 7/7 |
| 工具结果脱敏（实包 + 真实云端） | `npm run test:tool-redaction` | 4/4 |
| 真实云端工作区工具（实包） | `npm run test:workspace-tools` | 4/4 |
| 错误文案（实包 + 真实网络故障） | `npm run test:errors` | 6/6 |
| 原生文件导出（实包） | `test-native-files-export-ui.mjs` | 5 项 PASS |
| 临时目录清理（实包） | `npm run test:temp` | 3/3 |
| 包内源码核对 | `verify-packed-sources.mjs` | 97 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 1,178 / 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 902 ms · 窗口 1,013 ms · 可交互 1,192 ms（中位）；首次内容绘制仍为 `null` |

## 压缩事件证据（本版核心）

| 轮次 | 请求字符 | 消息数 | 摘要请求 | 带检查点 |
| --- | --- | --- | --- | --- |
| 1 | 28,274 | 5 | 否 | 否 |
| 7 | 216,056 | 17 | 否 | 否 |
| 8 | 155,332 | 14 | **是** | 否 |
| 9 | 122,222 | 10 | 否 | **是** |

证据文件：`.preview/qa-0.23.0/compaction-ui/run-*/result.json`（每次请求的字符数、消息数、判据标记都在里面）。

## 证据范围

- **摘要质量未评估**：只知道压缩发生了、请求变小了，不知道那段摘要丢没丢关键信息。
- 压缩在**本地假服务**上触发；真实云端长会话未跑。
- 界面不显示压缩提示是刻意对标（桌面版无渲染），不是遗漏。
- `image-offload` 真实卸载未观察；小窗口 headroom 收缩只有单测。
- 安装生命周期仍是 0.19.0 的 53 步；`ENOTFOUND` 文案仍未端到端触发；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；安装器未签名。

[本轮迭代](iteration-0.23.0.md) · [审计说明](audit-request-0.23.0.md) · [机制对照](harness-parity.md)
