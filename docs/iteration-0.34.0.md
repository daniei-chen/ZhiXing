# 知行 0.34.0 · 上下文窗口跟着型号走

## 解决什么问题

0.33.0 之后剩下的两条空白之一是「切到更小窗口的模型会怎样」。为了造出这个场景，本轮先用探针（`.preview/qa-0.34.0/probe-model-switch.mjs`）在一台临时档案里声明两个型号（大窗口 131,072、小窗口 8,192），在同一个会话里聊两轮后切到小窗口，结果**一个压缩请求都没有发生，历史被原样发给了小窗口型号**。日志里没有任何异常——这是最容易长期不被发现的那类问题。

顺着查，是两个缺陷叠在一起：

1. **目录解析丢字段**：`electron/model-catalog.mjs` 的 `decodeModels` 只取 `id`／`name`／`description`／`input_modalities`，提供方声明的 `context_length`、`max_output_tokens`（以及 Anthropic 的 `limit.context`／`limit.output` 等写法）全部被丢掉。于是每个型号都回落到供应商级窗口，同一个供应商下所有型号共用一个阈值。
2. **运行配置只声明当前型号**：`electron/runtime.mjs` 给 `llm-pi-ai` 的模型表只有 `[{id: 当前型号, …}]`。桌面版的模型切换压缩会拿**原模型**去写摘要，配置里没有原模型时直接失败——探针里就拿到了 `MODEL_SWITCH_COMPACTION_FAILED`：`pi-ai provider "zhixing-provider" has no configured model "qa-big"`。

## 怎么改

- `electron/model-catalog.mjs`：新增导出 `modelLimits(item)`，按 OpenAI 兼容、Anthropic、`max_input_tokens`、`top_provider.max_completion_tokens` 等写法取上限；只认可信正整数（窗口 8,192–2,000,000，输出 1–262,144），输出上限必须严格小于窗口（否则内核的压缩策略会判定配置无效），窗口未知时不写输出上限。
- `electron/providers.mjs`：`resolveProvider` 的返回里带上整条可见目录 `models`（每个型号各自的窗口、输出上限、输入模态；思考能力未确认的型号给 `reasoningEfforts: false`，不臆断档位）。
- `electron/runtime.mjs`：`llm-pi-ai` 的模型表改用这份目录，缺省仍回落到当前型号。
- 单元测试 `tests/model-catalog-limits.test.mjs`（6 例）进 `npm test`；实包门禁 `npm run test:model-window`（4 例）进发版流程。

## 结果

- 源码层：`npm test` 498（497 通过、1 跳过、0 失败），其中新增 6 例上限解析；`test:components` 14/14、`test:sites` 4/4。
- Windows 实包层：`npm run test:model-window` **4/4**——运行时模型表里 `qa-big` 131,072／8,192，`qa-small` 8,192／2,048；四轮聊到大窗口历史后切到小窗口，内核**先压缩、没有按新模型直接超额发送**；压缩失败时日志保留 `MODEL_SWITCH_COMPACTION_FAILED` 且该轮显示「未完成」；新会话用小窗口型号时用量显示 `8,192`。
- 同一实包上 `test:overflow-recovery` 4/4、`test:compact-command` 5/5 仍通过，压缩链路的其它口径未受影响。

## 边界

- **模型切换压缩的「成功」路径没有验证到**：假服务给的摘要只有 3 个字，检查点前言本身约 100 tokens，而内核这次选中的被替换区间只有约 103 tokens，于是判定「摘要不比原文小」而失败。真实长短合适的历史应当能成功，但**本轮没有证据**，不能写成「切换压缩成功已通过」。探针里那句 `summary is not smaller than the shadowed content (103 >= 103)` 就是这条边界的原话。
- 压缩失败时界面显示的是通用句「模型未完成本次请求。请检查服务地址、模型 ID、API Key 或额度。」，真正的失败码只在日志里。**这属于文案缺口**，本轮没改，已记入下一轮候选。
- 图像卸载仍未核对；溢出恢复与手动压缩只在 0.33.0／0.31.0 的证据里成立，本轮复跑的是行为没变，不是新能力。
- 真实供应商没有参与：窗口字段来自本地假服务的 `/v1/models`，真实厂商的字段写法覆盖面未验证。
- 窗口上限的置信区间（8,192–2,000,000）是工程判断，不是桌面版原文。
