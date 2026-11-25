# 知行 0.22.0 · 压缩口径对齐 Harness 桌面版

## 问题

用户要求「全部对标 DeepSeek Harness 桌面版机制，不要自己发挥」。压缩是点名项，于是先去读桌面版真的怎么配，不凭印象。

读法：解析本机 `D:\应用\DeepSeek harness\resources\app.asar`，取 `dsh-base/cordis.patch.yml`（桌面版基础层）与 `dsh-web-app/presets/cordis.patch.yml`（预设层），以及 `dsh-compaction*` 的实现。用户档案里的 `cordis.patch.yml` 是空的 `[]`，说明桌面版跑的就是**出厂默认配置**。

桌面版实际挂载与取值：

| 插件 | 桌面版配置 |
| --- | --- |
| `token-meter` | 挂载，无配置 |
| `compaction-basic` | 挂载，**无配置** → 默认 `thresholdRatio 0.8`、`retainRatio 0.16`、`headroomTokens 65536`（`maxTokens` 默认等于 headroom） |
| `command-compact` | 挂载 |
| `tool-result-pruner` | `thresholdChars 8192`、`headChars 4096`、`tailChars 1024` |
| `image-offload` | 挂载，无配置 |

知行的现状（`electron/runtime.mjs` 第 89 行）把压缩写死成 `{headroomTokens:8192, maxTokens:8192, thresholdRatio:0.8, retainRatio:0.16}`，而**根本没有挂 `image-offload`**。

按内核公式（`resolveCompactSpec`）：

```
messageBudget  = contextWindow − maxTokens
pressureBudget = messageBudget − headroomTokens
thresholdTokens = min(contextWindow × thresholdRatio, pressureBudget)
```

128k 窗口、8k 输出下：

- 桌面版：`128000−8192−65536 = 54272` → 阈值 **54,272** tokens（约窗口的 42%）
- 旧知行：`128000−8192−8192 = 111616` → 阈值 **102,400** tokens（窗口的 80%）

也就是说，同一个模型、同样的窗口，知行比桌面版**晚压缩一倍多的上下文**。这不是口味问题，是行为不一致。

## 怎么改

新增 `electron/compaction-policy.mjs`：

- `compactionPolicy({contextWindow,maxTokens,…})`：默认取桌面版的 `headroomTokens 65536`／`thresholdRatio 0.8`／`retainRatio 0.16`，返回能直接塞给 `compaction-basic` 的 `config`，同时算出 `thresholdTokens`／`retainTokens` 供日志与测试核对。
- 桌面版模型窗口都在 128k 以上，65k headroom 永远留得下；知行允许把窗口配到 8k，所以窗口塞不下时把 headroom 收缩到预算的一半（下限 1024），并返回 `clamped:true`，不做静默改值。
- `compactionSummary(policy)`：一行中文摘要（阈值、窗口、headroom、是否收缩），给日志与后续界面用。

`electron/runtime.mjs` 两处：压缩配置改由该函数计算；基础层补挂 `@deepseek-ai/dsh-compaction-image-offload`（与桌面版 `dsh-base` 一致，无配置）。

单测 `tests/compaction-policy.test.mjs` 6 条：128k 不收缩且阈值恰为 54,272、200k 仍受 headroom 限制、16k 窗口收缩并标记、10k 窗口保底 1024、`maxTokens ≥ contextWindow` 报错、比例越界报错。

## 结果

| 层 | 结果 |
| --- | --- |
| 源码 `npm test` | 437：436 通过、1 跳过、0 失败 |
| 组件 / 站点 | 14/14、4/4 |
| 打包源码 | 354：353 通过、1 跳过 |
| 实包启动（含新挂载的 image-offload） | 见验收页：内核正常启动、无插件解析错误 |
| 真实对话链路 | `test:ui-status` / `test:tool-redaction` / `test:workspace-tools` 复跑 |

## 边界

- **没有跑真实的压缩事件**：本轮只对齐了配置与阈值计算，没有构造一段超阈值的长对话去看「压缩真的在 54k 触发」、也没有核对压缩后的摘要内容与界面提示。这条必须当「未验证」。
- `image-offload` 只是挂上：它要「图像路由被判定超预算」才会动作，本轮没有图片路由场景，**没有观察过它真的卸载过图片**。
- 收缩分支（小窗口）只有单测，没有在真实小窗口模型上跑过。
- `token-meter` 的计数口径仍未逐项对照（是否含附件、系统提示）。
- 安装生命周期本版未重跑，最近一次完整证据是 0.19.0 的 53 步；`ENOTFOUND` 文案仍未端到端触发；安装器未签名；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`。
