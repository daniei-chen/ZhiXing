# 知行 0.22.1 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.22.1` |
| 构建源码 | `4f19bff10441f24b515f1b61f786dbc934b234bd`（`sourceDirty=false`） |
| 包内源码 | 97 个文件，指纹 `86aeacc3d77092d463ae87ffb7902896a4c0d66ad327077bcba5511b3eac1474` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,697,974 bytes，SHA-256 `bbe997aca4758ae0eb49a9b3bda5c3d3aab614907974cb83e7ea3b9eb1021a6d` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `d755fea883762a9a03e753706220aa71f15d2b25467bbfe4a38f19effbdc2b20` |
| blockmap | 314,885 bytes，SHA-256 `cf23ee6e55c962fa3000ccf05d2d652e5af3a727287f716c9d822503c2681117` |
| `latest.yml` | 342 bytes，SHA-256 `3cd3f766c55be2b643c23df3526d3f27ef106c020615c8ec0923cfdc3c3093eb` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 439：438 通过、1 跳过、0 失败 |
| 其中运行时补丁 | `node --test tests/runtime-patch.test.mjs` | 2/2：压缩 65,536 已写入；`image-offload` 无禁用行、挂载 1 条 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| 聊天失败文案（实包） | `npm run test:chat` | 2 项 PASS |
| 详情 / 占位符 / 导出分享（实包 + 本地假服务） | `npm run test:restore-gap` | 5/5 |
| 工具时间线（实包 + 本地假服务） | `npm run test:tools-ui` | 2/2 |
| 状态行 / 供应商档位 / 模型移除（实包 + 真实云端） | `npm run test:ui-status` | 7/7 |
| 工具结果脱敏（实包 + 真实云端） | `npm run test:tool-redaction` | 4/4 |
| 错误文案（实包 + 真实网络故障） | `npm run test:errors` | 6/6（0.22.0 上取得，本版未改该路径） |
| 原生文件导出（实包） | `test-native-files-export-ui.mjs` | 5 项 PASS |
| 临时目录清理（实包） | `npm run test:temp` | 3/3 |
| 包内源码核对 | `verify-packed-sources.mjs` | 97 个文件一致，指纹 `86aeacc3d77092d463ae87ffb7902896a4c0d66ad327077bcba5511b3eac1474` |
| 依赖审计 | `audit-production-dependencies.mjs` | 1,178 / 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 868 ms · 窗口 968 ms · 可交互 1,141 ms（中位）；首次内容绘制仍为 `null` |

## 落盘补丁核对（本版的核心证据）

直接调用 `prepareRuntime` 写一份补丁并读回：

| 项 | 结果 |
| --- | --- |
| `compaction-basic.config` | `{headroomTokens:65536, maxTokens:65536, thresholdRatio:0.8, retainRatio:0.16}` |
| `image-offload` 禁用行 | 0 条 |
| `image-offload` 挂载项 | 1 条（`dsh-compaction-image-offload/lib/index.js`） |
| `disabled` 清单是否仍含 `image-offload` | 否 |

## 证据范围

- **图像卸载没有真的发生**：插件启用 ≠ 验证过它工作；要有图片路由被判超预算才能观察。
- **压缩事件没有真的触发**：阈值是内核公式 + 单测结论，没有构造超阈值长对话。
- 小窗口收缩分支只有单测（16k／10k），没有真实小窗口模型验证。
- 安装生命周期本版未重跑（证据是 0.19.0 的 53 步）；`ENOTFOUND` 文案仍未端到端触发；启动探测未采到首次内容绘制（`null`）。
- `visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名。

[本轮迭代](iteration-0.22.1.md) · [0.22.0 迭代](iteration-0.22.0.md) · [机制对照](harness-parity.md)
