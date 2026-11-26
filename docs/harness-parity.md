# 对标 DeepSeek Harness 桌面版（机制清单与差距）

2026-11-25 用户指示：**全部对标 DeepSeek Harness 桌面版的机制，包括压缩与上下文管理在内的所有机制，不自行发挥、不自行创造。**

这份文档是第一份对照表。依据不是记忆，而是本机安装的 Harness 桌面版包清单：

- 来源：`D:\应用\DeepSeek harness\resources\app.asar`
- 解析结果：asar 内 21,722 个文件，其中 `@deepseek-ai/*` 包 **200 个**（`dsh-*` 机制插件与 `dsh-client-ui-*` 界面插件）
- 清单快照：`.preview/qa-0.21.0/dsh-packages.json`

> Phase 0A 已按当前锁定源码纠正反馈、技能、子代理及宿主条目，详见 [审计核实](phase-0a-audit.md)。其余桌面行为保留历史归属；本轮没有重新取得 200 包桌面安装文件或逐页截图，不能把整表解读为当前候选全部重新验收。

## 对照口径

- **已对标**：知行有同一机制，且有能力地图里的实包／真实云端证据。
- **部分**：机制在，但口径或覆盖比 Harness 窄（写明窄在哪）。
- **未做**：知行没有这个机制。
- **未核对**：还没查知行是否已有等价物，**不许当已做**。

## 0.41.0 草稿与局部订阅核对

本轮读取当前锁定依赖中 `@deepseek-ai/dsh-client-ui-chat@0.2.2-rc.5` 的 `src/client/chat/use-turn-data.ts`，核对它通过 `useSyncExternalStore` 订阅单个 keyed value；同时读取 `dsh-client-ui-conversation@0.2.2-rc.5` 的 `src/client/draft.ts` 和 `src/client/input/facade.ts`，核对独立语义草稿快照、会话输入模型、提交消费与恢复边界。这是安装依赖源码证据，未重新打开用户 D 盘的 Harness 桌面窗口。

| 范围 | 结论 | 知行及边界 |
| --- | --- | --- |
| 按键订阅与局部流式正文 | **部分** | 当前输入框和运行正文按草稿键/runId订阅；没有移植完整 Turn Location、Lexical 与队列模型 |
| 独立草稿与 revision | **部分** | 保留知行既有归属、附件 revision、消费及失败恢复，移除按键触发整库保存；未实现上游完整引用、command chip、quote 快照 |
| 磁盘存储格式 | **未核对** | `workspace.bin` / `drafts.bin` / epoch 为知行的加密持久化实现，不宣称 Harness 桌面同格式；SQLite 尚未做 |
| 全局/面板错误恢复的桌面 UI 等价性 | **未核对** | 本轮为现有界面增加基础容错，不改变内核机制；未取得桌面版相同 fallback 交互证据 |

三份上游源文件 SHA256 依次为 `d73a23b1310ad7933698daa2c831cacae8b009490823a36b6f6542ff4d07dfad`、`1bac06e426106152c2f5f1bc475a72795f5dbed44742064fd5d419868e6f576c`、`35d04426a4ac222b890ff0926acd3742df88e7862e90ba3a7ebb55c4a4791266`。本轮实际运行结果以 0.41.0 发行资产的验收摘要为准，不把上游源码核对等同于知行端到端验收。

## 上下文与压缩（本轮用户点名的重点）

| Harness 机制 | 包 | 知行现状 | 差距 |
| --- | --- | --- | --- |
| 压缩引擎与策略 | `dsh-compaction`、`dsh-compaction-basic` | **已对标并有实包证据**：0.22.0 把 headroom 从 8,192 改回桌面版的 65,536（128k 窗口阈值 54,272）；0.23.0 用 `npm run test:compaction` 在实包上真的触发了压缩——第 8 轮摘要请求、第 9 轮请求 216,056→122,222 字符并带 checkpoint，消息 14→10 | 桌面版压缩后无提示（轨迹与会话包均无渲染），知行同样不弹提示；摘要内容质量未评估 ；0.31.0 逐项核对了 `thresholdRatio`／`retainRatio`／`headroomTokens`／`compactionRetries`／`maxOverflowRetries`／`auto` 与修剪器 `8192`／`4096`／`1024`，均与桌面版默认一致（小窗口 headroom 收缩是知行自有处理） |
| 图像卸载 | `dsh-compaction-image-offload` | **部分**：已挂载（0.22.1），桌面版 `dsh-base` 一直挂它；0.22.0 曾因 `disabled` 清单同 id 禁用优先而没生效，0.22.1 修掉并有读落盘补丁的回归用例 | **未观察过真实卸载**：需要图片路由被判超预算 |
| 工具结果剪枝 | `dsh-compaction-tool-result-pruner` | **部分**：桌面版 `thresholdChars 8192`／`headChars 4096`／`tailChars 1024`，知行配置逐字一致 | 配置一致不等于已取得本轮实际剪枝行为证据 |
| 手动压缩命令 | `dsh-command-compact` | **已对标并有实包证据**：0.31.0 的 `npm run test:compact-command` 在打包 EXE 上真按 `/compact`——空会话不发任何模型请求、界面显示内核的「没有可压缩历史」；带参数只给中文用法提示；两轮对话后恰好一次摘要请求，界面给出 `Compacted 6 history items (~3353 tokens).`；压缩后下一轮请求带 `This is an automatically generated checkpoint` 前言且消息数 7→6 | 成功与空历史文案沿用内核英文（桌面版是否在 UI 层本地化未核对）；命令提示的中英文未逐字对齐 |
| token 计量 | `dsh-token-meter` | **部分**：已有上下文计量显示 | 未对照 Harness 的计数口径（是否含附件、系统提示） |

## 会话与消息

| Harness 机制 | 包 | 知行现状 | 差距 |
| --- | --- | --- | --- |
| 消息反馈（赞／踩／原因） | `dsh-message-feedback`、`dsh-command-feedback`、`dsh-client-ui-message-feedback` | **部分**：0.24.0 起有赞／踩、分类、备注与独立加密记录；Phase 0A 修复超限备注无法清除 | 本轮只有源码组件回归；历史 Windows 证据仍属于 0.24.0，不冒充当前候选 |
| 秘钥遮蔽显示 | `dsh-client-ui-secret-mask` | 部分：脱敏网关 + 凭证阻断 | Harness 是界面层遮蔽，知行是发送前替换，口径不同要写清 |
| 轨迹视图 | `dsh-client-ui-trajectory` | **部分（0.25.0 起可检索）**：执行面板已有按交办切换、事件分类、状态／耗时／轮次／步骤、子任务与后台作业、检索（标签／状态／分类，含子任务与作业名）、展开／收起全部、子会话与作业输出、归档 | 未做：桌面版按轮次分组的记录表、单条记录检查器里的输入／输出／token 用量、时间概览（TTFT／吞吐／缩放）、按轮次折叠、代码视图语法高亮 |
| 交付物视图 | `dsh-workspace-changes`、`dsh-deliverable-file-references`、`dsh-client-ui-deliverables` | **部分（0.30.0 起有逐文件对比视图）**：轮次末尾依次给出改动文件卡片（文件 + 工作区相对名 + 每文件增删行数 + 合计）与交付卡片（后者的每张卡片可预览／在默认应用中打开／在文件管理器中显示）；点改动行打开工作面板「改动」视图——左列文件与行数、右列该文件的逐行对比（3 行上下文、远处折叠、行号并列）；正文里命名交付文件的唯一 basename 变成可点引用 | 未做：git 工作树快照（终端／外部程序的改动不进卡片与对比）、独立 review tab 与其「开始／结束」整文件口径、并排视图与换行开关、review 内的打开／定位控件、右侧 Sidebar 预览；「在默认应用中打开」的成功路径未在自动验收中点击 |
| 会话日志 | `dsh-client-ui-settings-session-log` | **未核对** | 知行有 `app.log` 与诊断导出，但是否等价未核对 |

## 代理、协作与自动化

| Harness 机制 | 包 | 知行现状 | 差距 |
| --- | --- | --- | --- |
| 子代理 | `dsh-subagent`（含 `dsh-client-ui-subagent`） | **部分**：子任务可见、可归档；Phase 0A 真实内核＋本地服务验证 OpenAI / Anthropic spawn 继承父模型并发出子请求 | Windows 真实子任务归档仍待复验；旧脚本只看最后消息会漏判，已修正 fixture 识别；不能写成默认路由已经确定损坏 |
| 智能体团队 | `dsh-agent-team`、`dsh-client-ui-agent-team` | **部分**：内核共享任务、负责人和依赖能力已有源码及历史合成运行记录 | 完整桌面团队编排 UI 未核对，不能由内核工具存在推断界面已齐备 |
| 工作流运行 | `dsh-workflow`、`dsh-client-ui-workflow-run` | **未核对** | 知行没有工作流入口 |
| 后台作业 | `dsh-client-ui-jobs` | 部分：执行面板 | 口径未对齐 |
| 计划模式 | `dsh-client-ui-plan` | 已对标（`/plan`） | — |
| 目标 | `dsh-client-ui-goal`、`dsh-command-goal` | 已对标（`/goal`） | — |
| 技能 | `dsh-skill`、`dsh-tool-skill`、`dsh-skill-office`、`dsh-client-ui-skill` | **部分**：内核技能与办公技能已挂载，UtilityPage 有目录入口；Phase 0A 验证完整 composePrompt 加模式前缀后，用户技能手势仍注入完整技能正文 | 完整桌面技能管理 UI 未核对；本轮 Linux／Windows 源码合成服务结果不等于 Windows 实包全技能端到端通过 |
| worktree | `dsh-experimental-worktree`、`dsh-experimental-tool-worktree` | **部分**：已有项目工作树服务与入口 | 原生插件机制和桌面完整交互未核对；工作树不等于每轮 Git 快照与回滚 |
| 定时任务 | `dsh-schedule`、`dsh-tool-schedule`、`dsh-client-ui-schedule` | **部分**：主进程加密调度 + 重审 | 未对照 Harness 的补跑与授权失效规则 |
| 动作卡片 | `dsh-action-cards`、`dsh-client-ui-action-cards` | **未做** | 知行没有可点动作卡片 |
| 提问回流 | `dsh-client-ui-user-questions` | 部分：`需要你补充` 弹窗 | 交互形态未对照 |

## 工具与执行

| Harness 机制 | 包 | 知行现状 | 差距 |
| --- | --- | --- | --- |
| 终端 | `dsh-terminal`、`dsh-terminal-bash`、`dsh-client-ui-sidebar-terminal` | **部分**：交互终端面板 | 未对照 Harness 的沙箱与批准范围 |
| 网页搜索／读取 | `dsh-web-search`、`dsh-client-ui-settings-web-search` | **部分**：public IP 校验 + 固定地址 | 设置子页未对照；独立于模型供应商的搜索源尚未接入 |
| 电脑操作 | `dsh-computer-use`、`dsh-cua` | **未做** | — |
| 附件 | `dsh-attachment`、`dsh-attachment-local`、`dsh-client-ui-attachment` | **部分**：本地提取 + 范围说明 | 未对照 Harness 的附件上限与失败口径 |
| MCP | `dsh-mcp*` | 已对标：MCP 连接与资源，外部参数不自动还原 | — |

## 权限与安全

| Harness 机制 | 包 | 知行现状 | 差距 |
| --- | --- | --- | --- |
| 授权与批准 | `dsh-authorization`、`dsh-client-ui-approval` | **部分**：请求批准／帮我批准／完全访问 | 未逐条对照各档的工具边界 |
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
| 桌面宿主 | `dsh-desktop-host` | **部分**：有 Electron 主进程承载；Harness 仍逐轮创建和关闭 | 常驻 Host、跨轮连接池及等价宿主生命周期未做；不能将 Electron 外壳视为原生宿主已完整对标 |
| 语音 | `dsh-experimental-api-speech-to-text` | 部分：本机 SenseVoice | 真人语音未测 |

## 立刻要做的三件（按对标顺序）

1. **压缩口径全对齐**：把 `dsh-compaction-basic` 的触发阈值、保留条数、压缩后提示，以及 `compaction-image-offload`、`compaction-tool-result-pruner` 两个扩展在知行上的现状查清；查不清就写「未核对」，不要凭空补。
2. **会话与消息补齐**：消息反馈、轨迹面板、交付物引用——这三项是 Harness 桌面版最常用、知行缺得最明显的。
3. **技能面板**（含 `dsh-skill-office`）：知行已有目录与调用入口；下一步核对桌面版管理、启停及场景说明，不能继续记为完全没有入口。

## 边界

- 本表只做机制对照，**没有**任何一项因为本表而变成「已对标」：现状列写的是已有证据，未证据的一律留在「未做／未核对」。
- 200 个包里有一部分是界面胶水（`dsh-client-ui-layout`、`-renderer`、`-brand` 等），不对应用户可感知机制，没有逐条列出。
- 「未核对」不等于「没有」——知行可能已经用别的实现覆盖，但要先查到证据才算。
- Harness 桌面版自身版本：`0.2.2-rc.5`（与知行运行时同一份内核）。
