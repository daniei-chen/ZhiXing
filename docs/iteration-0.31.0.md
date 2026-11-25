# 知行 0.31.0 · 压缩口径核对与手动 `/compact` 验收

## 解决什么问题

压缩这条链路在 0.23.0 只验到「自动阈值触发」；用户主动输入 `/compact` 的路径从 0.3 接线起**从来没有实包证据**——不知道按下去会不会发请求、界面给什么、之后的历史长什么样。另外「修剪超大工具输出」与「图像卸载」两个附加件虽然挂上了，参数是否与桌面版默认一致也没核过。

## 核对结果（对桌面版的源码口径）

对照 `D:\应用\DeepSeek harness\resources\app.asar` 里的包说明与源码：

| 项 | 桌面版默认 | 知行当前 | 结论 |
| --- | --- | --- | --- |
| `thresholdRatio` | `0.8` | `0.8` | 已对标 |
| `retainRatio` | `0.16` | `0.16` | 已对标 |
| `headroomTokens` | `65536` | `65536`，窗口塞不下时按预算收缩并记日志 | 部分（小窗口是知行自己的处理，桌面版要求按模型覆盖 `headroomTokens`） |
| `maxTokens`（摘要输出上限） | 跟随 `headroomTokens` | 跟随生效的 headroom | 已对标 |
| `compactionRetries` / `maxOverflowRetries` / `auto` | `1` / `1` / `true` | 未显式设置＝默认值 | 已对标（未逐项实验） |
| 工具结果修剪 `thresholdChars` / `headChars` / `tailChars` | `8192` / `4096` / `1024` | `8192` / `4096` / `1024` | 已对标 |
| 图像卸载 | 无配置，由适配器上报 `IMAGE_OFFLOAD_REQUIRED` 后按模型顺序省略 | 同左（挂载同一插件、无配置） | 未核对（没有可复现的触发实验） |
| `/compact` 成功文案 | 内核固定英文 `Compacted N history items (~M tokens).` | 原样显示 | 已对标（文案归内核，知行不另改） |
| `/compact` 空历史 | 内核 `No compactable history yet.` | 原样显示 | 已对标（实包已测） |
| `/compact` 带参数 | 内核用法提示（英文） | 知行在渲染层拦下，给中文「使用 /compact 压缩当前会话。此命令无需参数。」 | 有意偏差（中文产品给中文提示） |

## 怎么改

只加门禁与文档，不改产品行为：`scripts/test-compact-command-ui.mjs` ＋ `npm run test:compact-command`。

脚本用本地假 OpenAI 服务 + 真实内核，在打包 EXE 上跑五个用例：

1. 空会话 `/compact`：**不发起任何模型请求**，界面显示内核的「没有可压缩历史」；
2. 带参数 `/compact now`：不发请求，知行给中文用法提示（toast）；
3. 两轮真实对话后 `/compact`：**恰好一次摘要请求**（最后一条 user 消息以 `You are now acting as a compaction engine` 开头），界面给出压缩条数与 token 数（本轮实测 `Compacted 6 history items (~3353 tokens).`）；
4. 压缩后的下一轮请求**带上检查点前言**（`This is an automatically generated checkpoint`）且消息数少于压缩前（7 → 6）；
5. 全程没有误发用户文本当作普通提问。

发送走的是真实键盘路径（在输入框里键入后回车），因为斜杠命令会打开命令面板、盖住发送按钮——这也是用户的实际操作方式。

## 结果

- 源码层：`npm test` 492 项（491 通过 / 1 跳过 / 0 失败）；`test:components` 14/14；`test:sites` 4/4。
- Windows 实包层：`npm run test:compact-command` **5/5**（本轮新增）；`test:packed`、原生文件导出、包内源码核对、依赖审计、启动探测均通过（数字见 `acceptance-summary-0.31.0.json`）。
- 自动压缩的旧证据仍以 0.23.0 的 `test:compaction` 为准，本版未重跑。

## 边界

- 图像卸载这条路径**没有可复现的触发实验**：需要适配器在图片预算超限时返回 `IMAGE_OFFLOAD_REQUIRED`，本地假服务造不出真实语义，真实云端又要有图片输入与对应配额。本轮只核对了「挂载与桌面版相同、没有额外配置」。
- `compactionRetries`、`maxOverflowRetries`、`auto` 只核对了取值等于桌面版默认（未显式设置），**没有逐项做实验**：溢出恢复（提供方确认上下文超限后压缩再重试）与切换小窗口模型触发的压缩都没有端到端证据。
- `/compact` 的成功与空历史文案是内核固定的英文，知行原样显示；桌面版是否在 UI 层再本地化**未核对**，因此本轮不改成中文。
- 小窗口模型（8k 级）的 headroom 收缩是知行自己的处理，桌面版的做法是按模型覆盖 `headroomTokens`；这属于有意偏差，未在桌面版上验证等价性。
- 手动压缩的实包证据来自本地假服务 + 真实内核，**未在真实云端会话上跑**；压缩摘要由假服务生成，摘要质量不能代表真实模型。
