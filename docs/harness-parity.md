# 对标 DeepSeek Harness 桌面版（机制清单与差距）

2026-11-25 用户指示：**全部对标 DeepSeek Harness 桌面版的机制，包括压缩与上下文管理在内的所有机制，不自行发挥、不自行创造。**

这份文档是第一份对照表。依据不是记忆，而是本机安装的 Harness 桌面版包清单：

- 来源：`D:\应用\DeepSeek harness\resources\app.asar`
- 解析结果：asar 内 21,722 个文件，其中 `@deepseek-ai/*` 包 **200 个**（`dsh-*` 机制插件与 `dsh-client-ui-*` 界面插件）
- 清单快照：`.preview/qa-0.21.0/dsh-packages.json`

## 对照口径

- **已对标**：知行有同一机制，且有能力地图里的实包／真实云端证据。
- **部分**：机制在，但口径或覆盖比 Harness 窄（写明窄在哪）。
- **未做**：知行没有这个机制。
- **未核对**：还没查知行是否已有等价物，**不许当已做**。

## 上下文与压缩（本轮用户点名的重点）

| Harness 机制 | 包 | 知行现状 | 差距 |
| --- | --- | --- | --- |
| 压缩引擎与策略 | `dsh-compaction`、`dsh-compaction-basic` | **已对标并有实包证据**：0.22.0 把 headroom 从 8,192 改回桌面版的 65,536（128k 窗口阈值 54,272）；0.23.0 用 `npm run test:compaction` 在实包上真的触发了压缩——第 8 轮摘要请求、第 9 轮请求 216,056→122,222 字符并带 checkpoint，消息 14→10 | 桌面版压缩后无提示（轨迹与会话包均无渲染），知行同样不弹提示；摘要内容质量未评估 |
| 图像卸载 | `dsh-compaction-image-offload` | **已挂载**（0.22.1）：桌面版 `dsh-base` 一直挂它；0.22.0 曾因 `disabled` 清单同 id 禁用优先而没生效，0.22.1 修掉并有读落盘补丁的回归用例 | **未观察过真实卸载**：需要图片路由被判超预算 |
| 工具结果剪枝 | `dsh-compaction-tool-result-pruner` | **已对标**：桌面版 `thresholdChars 8192`／`headChars 4096`／`tailChars 1024`，知行逐字一致 | — |
| 手动压缩命令 | `dsh-command-compact` | 已对标（`/compact`） | 命令提示与 Harness 文案未逐字对齐 |
| token 计量 | `dsh-token-meter` | 已对标：输入框 token 计量条 | 未对照 Harness 的计数口径（是否含附件、系统提示） |

## 会话与消息

| Harness 机制 | 包 | 知行现状 | 差距 |
| --- | --- | --- | --- |
| 消息反馈（赞／踩／原因） | `dsh-message-feedback`、`dsh-command-feedback`、`dsh-client-ui-message-feedback` | **未做** | 知行气泡下没有反馈入口 |
| 秘钥遮蔽显示 | `dsh-client-ui-secret-mask` | 部分：脱敏网关 + 凭证阻断 | Harness 是界面层遮蔽，知行是发送前替换，口径不同要写清 |
| 轨迹视图 | `dsh-client-ui-trajectory` | **部分（0.25.0 起可检索）**：执行面板已有按交办切换、事件分类、状态／耗时／轮次／步骤、子任务与后台作业、检索（标签／状态／分类，含子任务与作业名）、展开／收起全部、子会话与作业输出、归档 | 未做：桌面版按轮次分组的记录表、单条记录检查器里的输入／输出／token 用量、时间概览（TTFT／吞吐／缩放）、按轮次折叠、代码视图语法高亮 |
| 交付物视图 | `dsh-deliverable-file-references`、`dsh-client-ui-deliverables` | 部分：产出文件计数与列表 | 未做「从回答跳到文件」的引用关系 |
| 会话日志 | `dsh-client-ui-settings-session-log` | **未核对** | 知行有 `app.log` 与诊断导出，但是否等价未核对 |

## 代理、协作与自动化

| Harness 机制 | 包 | 知行现状 | 差距 |
| --- | --- | --- | --- |
| 子代理 | `dsh-subagent`（含 `dsh-client-ui-subagent`） | 部分：子任务可见、可归档 | 真实子任务归档从未跑通（0.14.10 遗留） |
| 智能体团队 | `dsh-agent-team`、`dsh-client-ui-agent-team` | **未做** | 多代理编排界面没有 |
| 工作流运行 | `dsh-workflow`、`dsh-client-ui-workflow-run` | **未核对** | 知行没有工作流入口 |
| 后台作业 | `dsh-client-ui-jobs` | 部分：执行面板 | 口径未对齐 |
| 计划模式 | `dsh-client-ui-plan` | 已对标（`/plan`） | — |
| 目标 | `dsh-client-ui-goal`、`dsh-command-goal` | 已对标（`/goal`） | — |
| 技能 | `dsh-skill`、`dsh-tool-skill`、`dsh-skill-office`、`dsh-client-ui-skill` | **未做** | 知行没有技能面板，也没接 `office` 技能 |
| worktree | `dsh-experimental-worktree`、`dsh-experimental-tool-worktree` | **未做** | — |
| 定时任务 | `dsh-schedule`、`dsh-tool-schedule`、`dsh-client-ui-schedule` | 已对标：主进程加密调度 + 重审 | 未对照 Harness 的补跑与授权失效规则 |
| 动作卡片 | `dsh-action-cards`、`dsh-client-ui-action-cards` | **未做** | 知行没有可点动作卡片 |
| 提问回流 | `dsh-client-ui-user-questions` | 部分：`需要你补充` 弹窗 | 交互形态未对照 |

## 工具与执行

| Harness 机制 | 包 | 知行现状 | 差距 |
| --- | --- | --- | --- |
| 终端 | `dsh-terminal`、`dsh-terminal-bash`、`dsh-client-ui-sidebar-terminal` | 已对标：交互终端面板 | 未对照 Harness 的沙箱与批准范围 |
| 网页搜索／读取 | `dsh-web-search`、`dsh-client-ui-settings-web-search` | 已对标：public IP 校验 + 固定地址 | 设置子页未对照 |
| 电脑操作 | `dsh-computer-use`、`dsh-cua` | **未做** | — |
| 附件 | `dsh-attachment`、`dsh-attachment-local`、`dsh-client-ui-attachment` | 已对标：本地提取 + 范围说明 | 未对照 Harness 的附件上限与失败口径 |
| MCP | `dsh-mcp*` | 已对标：MCP 连接与资源，外部参数不自动还原 | — |

## 权限与安全

| Harness 机制 | 包 | 知行现状 | 差距 |
| --- | --- | --- | --- |
| 授权与批准 | `dsh-authorization`、`dsh-client-ui-approval` | 已对标：请求批准／帮我批准／完全访问 | 未逐条对照各档的工具边界 |
| 权限预设 | `dsh-client-ui-permission-presets` | 部分 | 预设的可选集合未对照 |
| 凭据 | `dsh-credentials`、`dsh-credentials-local` | 已对标：Windows 加密存储，不读别家凭据 | — |
| 自动审阅 | `dsh-experimental-auto-review` | **未做**（0.12 起列为 P2） | — |
| 远程访问 | `dsh-api-remote-access`、`dsh-api-remotes` | **未做** | 知行的 API 面只在本机 |

## 模型与设置

| Harness 机制 | 包 | 知行现状 | 差距 |
| --- | --- | --- | --- |
| 模型选择 | `dsh-client-ui-model-selection`、`dsh-agent-default-model` | 已对标：输入框模型入口 | — |
| 智能体预设 | `dsh-agent-preset`、`dsh-client-ui-agent-preset` | **未做** | — |
| 设置子页（通用／模型／插件／子代理／会话日志／网页搜索／账户） | `dsh-client-ui-settings-*` | 部分：通用、供应商、插件、隐私 | 子代理、会话日志、网页搜索、账户四个子页未对照 |
| 插件管理器／市场 | `dsh-client-ui-plugin-manager`、`-plugin-market`、`-plugin-recommendations` | 部分：官方插件管理器已接 | 市场与推荐未做 |

## 外壳与平台

| Harness 机制 | 包 | 知行现状 | 差距 |
| --- | --- | --- | --- |
| 主题 | `dsh-client-ui-theme` | 已对标：中性灰白／深色 | — |
| 快捷键 | `dsh-client-shortcuts`、`dsh-client-ui-shortcuts` | 部分：常用快捷键 | 未对照完整键位表 |
| 命令面板 | `dsh-commands`、`dsh-client-ui-commands` | 部分：`/` 命令 | 未对照 Harness 命令全集 |
| 侧栏四件 | `dsh-client-ui-sidebar-browser`／`-terminal`／`-files`／`-documentpreview` | 已对标 | — |
| 桌面宿主 | `dsh-desktop-host` | 已对标：Electron 主进程 | — |
| 语音 | `dsh-experimental-api-speech-to-text` | 部分：本机 SenseVoice | 真人语音未测 |

## 立刻要做的三件（按对标顺序）

1. **压缩口径全对齐**：把 `dsh-compaction-basic` 的触发阈值、保留条数、压缩后提示，以及 `compaction-image-offload`、`compaction-tool-result-pruner` 两个扩展在知行上的现状查清；查不清就写「未核对」，不要凭空补。
2. **会话与消息补齐**：消息反馈、轨迹面板、交付物引用——这三项是 Harness 桌面版最常用、知行缺得最明显的。
3. **技能面板**（含 `dsh-skill-office`）：Harness 已有，知行完全没有入口。

## 边界

- 本表只做机制对照，**没有**任何一项因为本表而变成「已对标」：现状列写的是已有证据，未证据的一律留在「未做／未核对」。
- 200 个包里有一部分是界面胶水（`dsh-client-ui-layout`、`-renderer`、`-brand` 等），不对应用户可感知机制，没有逐条列出。
- 「未核对」不等于「没有」——知行可能已经用别的实现覆盖，但要先查到证据才算。
- Harness 桌面版自身版本：`0.2.2-rc.5`（与知行运行时同一份内核）。
