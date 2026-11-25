# 知行 0.22.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.22.0` |
| 构建源码 | `1e1f339918bc0f1ac9d5f1231a2280923013d756`（`sourceDirty=false`） |
| 包内源码 | 97 个文件，指纹 `3e95bb9ad0cef443023923852e74af731b13a2d00be20e520dbea0ce5542ac66` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,698,502 bytes，SHA-256 `0a46f58a449fb4028f4f5d1b17b93a94390327bb56f8649f09f2a8a9f2842c1d` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `6840d458839e9c7877094a1b64a67d3ea3a3f197b1c51a496a23faf57e3cb598` |
| blockmap | 314,734 bytes，SHA-256 `f1f3d755d4865494b2b31b70d5a86e6c51c503fc09357614c64a6ffc515d78e5` |
| `latest.yml` | 342 bytes，SHA-256 `44ecf68cd32d6343b3c434e35ac32d9b6d447c935688f3c099eda52ed3c2cfbd` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 437：436 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
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
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 899 ms · 窗口 1,014 ms · 可交互 1,198 ms（中位）；首次内容绘制仍为 `null` |

## 压缩对齐的依据与结果

| 项 | 桌面版（`dsh-base` 出厂默认） | 旧知行 | 本版知行 |
| --- | --- | --- | --- |
| `thresholdRatio` | 0.8 | 0.8 | 0.8 |
| `retainRatio` | 0.16 | 0.16 | 0.16 |
| `headroomTokens` | 65,536 | 8,192 | **65,536**（窗口塞不下时按预算收缩并标记） |
| 128k 窗口阈值 | 54,272 tokens | 102,400 tokens | **54,272 tokens** |
| `tool-result-pruner` | 8192／4096／1024 | 同 | 同（未改） |
| `image-offload` | 挂载 | **未挂载** | **已挂载** |

以上取值来自本机 `app.asar` 内的 `dsh-base/cordis.patch.yml` 与 `dsh-compaction-basic/lib/index.js`；阈值按内核 `resolveCompactSpec` 的公式计算，单测 `tests/compaction-policy.test.mjs` 6 条钉住。

## 安装与进程

| 项 | 值 |
| --- | --- |
| 安装 | `ZhiXing-0.22.0-x64.exe`，退出码与耗时见汇报 |
| 安装后 `知行.exe` | SHA-256 与发布资产一致见汇报 |
| 快捷方式 | 按字节还原（`C39575C1…`、`DB05A293…`） |

## 证据范围

- **压缩事件没有真的触发过**：阈值是公式与单测算出来的，没有构造超阈值长对话验证「真在 54,272 触发」，也没有核对压缩后的摘要与界面提示。
- `image-offload` 只是挂载：没有图片超预算场景，未观察它真的卸载过图片；占位文本是否与桌面版逐字一致也未核对。
- 小窗口收缩分支只有单测（16k／10k），没有真实小窗口模型验证；`clamped` 目前不进界面、不进日志。
- `token-meter` 计数口径未逐项对照。
- 安装生命周期本版未重跑：最近一次完整证据是 0.19.0 安装包上的 53 步（0.14.0 基线）。
- `ENOTFOUND` 文案仍未端到端触发（本机「不存在域名」返回 `ECONNRESET`）。
- 启动探测未采到首次内容绘制（`null`）。
- `visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名。

[本轮迭代](iteration-0.22.0.md) · [能力地图](harness-capability-map.md) · [机制对照](harness-parity.md)
