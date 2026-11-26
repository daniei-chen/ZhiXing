# 知行 0.33.0 · 上下文溢出后的自动恢复

## 解决什么问题

0.31.0 核对压缩口径时留下一处空白：**提供方明确说「你的请求超出模型上下文」时，知行会怎么反应？** 桌面版（`dsh-compaction-basic`）监听 `agent/request-error` 的 `CONTEXT_WINDOW_EXCEEDED`，绕过常规阈值与保留策略，做一次最大平衡头部缩减（压缩），然后重试同一请求，且这次重试**不占提供方的重试预算**。知行挂的是同一个内核，但从来没有让提供方真的说过这句话——「溢出恢复」一直只有参数一致，没有行为证据。

## 怎么改

只加验收与文档，**产品代码未改**：`scripts/test-overflow-recovery-ui.mjs` ＋ `npm run test:overflow-recovery`。

先用探针 `.preview/qa-0.33.0/probe-overflow.mjs` 确认内核的真实反应，再固化成门禁。关键判据取自桌面版源码：错误码 `CONTEXT_WINDOW_EXCEEDED` 的识别在 `dsh-llm/lib/types/error.js` 的 `isContextWindowExceededError`——结构化正则接受 `context_length_exceeded`，所以假服务回 `HTTP 400` + `{"error":{"code":"context_length_exceeded","message":"This model's maximum context length is ..."}}` 就是一次真实形态的「提供方确认超限」。

脚本在打包 EXE 上做三组断言（含前置就绪共 4 个用例）：

1. **第一条消息就超限**：预期请求序列是「超限 → 摘要请求 → 重试」，共 3 次，超限只出现一次，摘要请求恰好一次；
2. **界面给出答复而不是报错**：只有一条答复气泡、正文来自重试请求、错误区为空；
3. **重试请求更短且带摘要**：消息条数少于被拒那次，且请求里出现摘要正文；
4. **恢复之后能继续**：再发一条消息，请求数 +1、界面两条答复、正文正常。

## 结果

- Windows 实包层：`npm run test:overflow-recovery` **4/4**（本轮新增）——实测请求序列 `overflow → compaction → streamed`，重试请求 5 条消息降到 4 条并带上摘要，界面无错误提示，随后继续对话正常。
- 同一实包上 `npm run test:compact-command` 5/5 仍通过（手动压缩未受影响）。
- 源码层与其它实包门禁见 `acceptance-summary-0.33.0.json`。

## 边界

- 超限错误由本地假服务按**真实错误形态**构造（HTTP 400 + `context_length_exceeded`），不是真实供应商返回的；真实云端这条路径仍**没有**证据。
- 只验证了「第一次请求就超限」这一种时序；「对话进行到中途才超限」在同一机制下应当相同，但**没有单独实验**。
- 「重试不占提供方重试预算」这条口径**没有直接观测**（需要看 `llm/retry` 事件计数）；本轮只证明了「只发生一次压缩、一次重试、最终成功」。要证明预算不被占用，得让提供方同时返回可重试错误，本轮没做。
- **图像卸载仍未核对**（造不出真实的 `IMAGE_OFFLOAD_REQUIRED`），「切换小窗口模型触发的压缩」也未实验。
- 摘要是假服务生成的固定文本，不代表真实模型的摘要质量。
- 安装生命周期仍是 0.24.0 的 53 步证据；安装包未签名；首次内容绘制仍为 `null`。
