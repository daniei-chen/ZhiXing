# 知行 0.24.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.24.0` |
| 构建源码 | `967cb68c186e6cff87517981448577328eaf944f`（`sourceDirty=false`） |
| 包内源码 | 98 个文件，指纹 `efa38a431bc1900cc9f285457c75923bbffb43c00fc05874681c6d1d29cdbc9e` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,703,060 bytes，SHA-256 `ee95ec52647be25baf908d4f552f675467122496b101c441d5f5f13884ffe504` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `a3200f3710b7fb7cc86e91eb87da7716642b520cc2dab4d265df080927820e1b` |
| blockmap | 314,976 bytes，SHA-256 `b7abdeda46af7d2b0e96d164d2d553f8d1672e912a3e132fdfacda23d178aa64` |
| `latest.yml` | 342 bytes，SHA-256 `3a639854cfa59123cb9251d7e30b5d559faa7e8c276de1025a51c2b2abeade39` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 446：445 通过、1 跳过、0 失败（含 `message-feedback` 7/7） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **消息反馈（本版新增）** | `npm run test:feedback` | 7/7：两个按钮；面板 7 个分类且文案一致；保存后显示「本机反馈：赞 · 任务结果」；`feedback.bin` 无备注明文与分类明文；读回备注完整；清除后 0 条且模型请求数不变；刷新后清空仍生效 |
| 压缩事件 | `npm run test:compaction` | 4/4：摘要 1 次、检查点 1 次、请求 216,056→122,222 字符 |
| 聊天失败文案（实包） | `npm run test:chat` | 2 项 PASS |
| 详情 / 占位符 / 导出分享（实包 + 本地假服务） | `npm run test:restore-gap` | 5/5 |
| 工具时间线（实包 + 本地假服务） | `npm run test:tools-ui` | 2/2 |
| 状态行 / 供应商档位 / 模型移除（实包 + 真实云端） | `npm run test:ui-status` | 7/7 |
| 工具结果脱敏（实包 + 真实云端） | `npm run test:tool-redaction` | 4/4 |
| 原生文件导出（实包） | `test-native-files-export-ui.mjs` | 5 项 PASS |
| 临时目录清理（实包） | `npm run test:temp` | 3/3 |
| 包内源码核对 | `verify-packed-sources.mjs` | 98 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 1,178 / 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 793 ms · 窗口 894 ms · 可交互 1,064 ms（中位）；首次内容绘制仍为 `null` |

## 本版踩到的两个实现坑（都在本版内修掉）

- 打包后 `src/` 只有构建产物，主进程 `import('../src/message-feedback.js')` 直接 `Cannot find module`，界面只弹一句错误 toast。规则已挪到 `electron/message-feedback.mjs`，`src/` 那份只做转发。
- 组件测试跑在 jsdom 里，没有 `TextEncoder`，第一次接进去时 8 个渲染用例全挂。字节数改成按码点自己算（`utf8Bytes`），结果与 `Buffer.byteLength(text,'utf8')` 一致。

## 证据范围

- 只做逐消息反馈；桌面版的会话级 `/feedback` 命令与弹窗未实现、未核对。
- 反馈存在知行自己的 `feedback.bin`（`safeStorage` 加密），不是桌面版的 Session 日志事件；语义等价、格式不同。
- **本版未能在 GitHub 发布**：2026-11-26 00:06 起 `api.github.com` 与 `github.com` 连续返回 `000`（DNS 指向本地代理 `198.18.0.13`），v0.23.0 的 release 也未创建。两版 18 个资产已在本地组装完毕，网络恢复后按 v0.23.0 → v0.24.0 顺序补发。
- 安装生命周期仍是 0.19.0 的 53 步；`ENOTFOUND` 文案仍未端到端触发；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；安装器未签名。

[本轮迭代](iteration-0.24.0.md) · [审计说明](audit-request-0.24.0.md) · [机制对照](harness-parity.md)
