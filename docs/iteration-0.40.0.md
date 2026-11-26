# 知行 0.40.0 · 逐特性门禁在本版二进制上复跑

## 解决什么问题

0.39.0 发的是**安装生命周期证据**，那一版的产品代码与 0.38.0 完全相同，也因此带出一个容易被忽略的漏洞：**逐特性门禁（错误文案、溢出恢复、运行时性能等）从来没在随包发布的那个二进制上跑过**。上一次 `test:errors` 是 0.32.0、`test:overflow-recovery` 是 0.33.0——从那时到现在的每一次发版，安装包里装的都是「门禁跑过的那份源码」，但没有再在那份**构建产物**上验证过一次。

这版就为这件事存在：先把包按 0.40.0 构建出来，再拿这个包去跑门禁。如果哪条门禁红了，那说明**之前几个版本已经发给用户的代码**里带着这个问题，而不是「这一版改坏了」。

## 结果

| 门禁 | 层 | 结果 |
| --- | --- | --- |
| `npm test` | 源码 | 505 项：504 通过、1 跳过、0 失败 |
| `npm run test:components` | 组件 | 14/14 |
| `npm run test:sites` | 站点 | 4/4 |
| `npm run test:packed` | Windows 实包 | 354 项：353 通过、1 跳过、0 失败 |
| `npm run test:errors` | Windows 实包 + 真实网络 | **7/7**：实包运行时报告 0.40.0；真实 401 → 「API Key 无效或已过期…」；64 字符标签的 `.invalid` → 真实 `ENOTFOUND` → 「解析不到服务地址…」；普通 `.invalid` 被本机网络接住 → 按实际 `ECONNRESET` → 「连接被中途断开…」；拒绝连接的端口 → `ECONNREFUSED` → 「服务地址拒绝连接…」；12 秒无响应 → `TIMEOUT` → 「请求超时…」；主进程日志保留真实错误码且每条界面文案都与技术原文不同 |
| `npm run test:overflow-recovery` | Windows 实包 + 真实内核 | **4/4**：假服务与临时档案就绪、提供方超限后压缩并重试且界面给出答复、重试请求更短且带摘要、恢复之后继续对话正常 |
| 原生文件导出 | Windows 实包 | 通过（脚本退出码 0，结果文件只记状态） |
| 包内源码核对 | Windows 实包 | 100 个文件，指纹 `edb7a25d…` 与 0.38.0／0.39.0 相同 |
| 依赖审计 | 仓库 + 随包 | 1,178／1,162 个包，0 high、0 critical、32 moderate |
| 启动耗时 | Windows 实包 ×10 | 调试端口 693 ms、CDP 960 ms、可交互 1,165 ms（中位）；首次内容绘制 `null` |

## 边界

- **产品代码零改动**：`0.40.0` 与 `0.39.0`／`0.38.0` 的包内源码指纹相同（100 个文件），差别只有版本号与文档。这版的价值是**验证**，不是修复。
- 只复跑了 `test:errors` 与 `test:overflow-recovery` 两条最贴近「用户会立刻撞上」的门禁；`test:model-switch`／`test:model-window` 仍是 0.37.0 的结果，`test:chat`／`test:updater`／`test:temp`／`test:compaction`／`test:compact-command`／`test:review`／`test:changes`／`test:actions`／`test:inline-refs`／`test:deliverables`／`test:execution-search`／`test:feedback`／`test:tool-redaction`／`test:restore-gap`／`test:ui-status`／`test:workspace-tools`／`test:tools-ui` 本版没有重跑，各自的结果仍是上一次运行时的版本。
- 错误文案门禁的 401 用例依赖真实访问 `api.deepseek.com`；`ENOTFOUND` 的成因仍是「主机名标签超过 63 个字符」，与「域名不存在（NXDOMAIN）」共用错误码但不是同一种成因。
- 安装生命周期没有在本版重跑（证据仍是 0.38.0 安装包上那 50 步）；图像卸载仍未覆盖。
- 长会话「内核退出没在 10 秒内确认」仍未复现。
