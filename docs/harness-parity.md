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

## 0.43.0 候选：普通工具审批、问答与同宿主恢复

开发起点为已发布 0.42.0 的补记提交 `7076fe7a694ca772e25fc64f038e3dc909a9baf1`。本轮核对锁定的官方 `@deepseek-ai/*@0.2.2-rc.5` 源码，没有重新取得用户 D 盘的 `app.asar` 或当前桌面窗口。审批相关文件指纹见 [上游证据](evidence/0.43.0/upstream-approval.json)，知行的所有权、取消和交接契约见 [机制说明](approval-recovery-0.43.0.md)。以下是候选实现，不用源码回归替代尚未取得的本版 Windows 实包证据。

| 范围                                                       | 结论       | 已核对的机制及本轮边界                                                                                                                                                                                       |
| ---------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 普通工具审批                                               | **部分**   | 保留原生 `approval/request`、`approval/asked`／`approval/decided` 和策略判定；知行在当前聊天输入区显示完整路径、命令及网络范围，用户只可允许一次或拒绝。主机生成独立 requestId，不以可复用的 callId 合并请求 |
| 取消与撤回                                                 | **部分**   | 原生 AbortSignal 经认证本机桥传到主机队列，取消后迟到的允许无效；SDK 普通审批转发缺少对应的客户端撤回通知，因此该路径使用知行传输适配，不声称复用官方完整 Remote Events UI 栈                                |
| 必需问答与方案审批                                         | **部分**   | 沿用 `dsh-user-questions` 的结构化答案与主机校验，按根会话保留待答项并接管所属聊天输入区；没有完整移植官方问题卡片投影、隐藏后重开、等待 claim／倒计时及超时后续答机制                                       |
| 已保存聊天的界面刷新接续                                   | **部分**   | 先保存原消息定位，再启动一次 run；主机存活时刷新接回原 run，完整结果写回并保存后才 ACK。最多保留 16 份未确认结果，满额背压；这是知行的可靠传输适配，不是原生常驻 Host 或跨主进程重启恢复                     |
| 全局错误恢复与不保存聊天模式                               | **部分**   | 全局恢复明确停止待启动和运行中的交办，再保存；面板恢复不停止任务。不保存聊天时，真正的主 frame 重载或 renderer 崩溃取消该任务，确认原 run 清理后才释放临时结果；不把 SPA 导航视为退出                        |
| 委派子 Agent 的人工审批                                    | **未做**   | `dsh-subagent` 在真实委派时固定 `approvalPolicy: never`；需要审批的操作由原生策略拒绝，含义不是自动允许。桥支持验证子树所有权，不等于真实 spawn 能向用户申请放行；本轮不修改该策略                           |
| Action Cards                                               | **未做**   | `propose_action` 是由注册动作类型和技能约束的可选后续动作，与阻塞工具执行的普通审批不同；本轮审批卡外观不提升此能力状态                                                                                      |
| 会话／永久放行、普通审批的拒绝反馈协议、原生 Auto Reviewer | **未做**   | 普通审批的客户端决定仍只有 `allowed-once`／`rejected`；取消和不可用不能授予权限。现有 ask／auto／full 工具策略、自动化授权范围均不扩大                                                                       |
| 当前 Harness 桌面窗口的视觉一致性                          | **未核对** | 本轮依据 composer 接管等官方源码机制，保留知行中性色与墨竹；没有当前窗口的逐像素或完整桌面行为核对                                                                                                           |

可复核的上游位置均在 `node_modules/@deepseek-ai/` 下：

- `dsh-user-approval/src/index.ts`、`src/types.ts`：四个原生 outcome、活跃 turn、策略检查、审计关联与取消；`never` 在回答者之前拒绝。
- `dsh-sdk-protocol/src/types.ts`、`src/transport.ts`、`dsh-sdk-jsonrpc-server/src/server.ts`：SDK 请求只携带 sessionId、toolName、callId 与 reason；不能据它推断完整原生取消和展示信息已送到 renderer。
- `dsh-client-ui-approval/src/client/index.ts`、`ApprovalPanel.tsx`、`contract/slots.ts`：会话范围的待批状态和输入区接管；普通面板只绑定允许一次与拒绝。通用卡片可选的 `onAlways` 不是普通审批已启用的会话授权。
- `dsh-client-ui-user-questions/src/client/index.ts`、`contract/slots.ts` 与 `dsh-user-questions/src/index.ts`：问题卡片生命周期和结构化答案；方案选项仍是原问题给出的选项，不新增工具权限。
- `dsh-subagent/src/child-agent.ts`：`captureDelegatedPolicyOverrides()` 固定委派审批为 `never`，并将 `source: delegation` 写入子会话策略。
- `dsh-action-cards/src/index.ts`、`src/types.ts`：单独的动作类型注册、提议和用户触发协议，不能由普通审批实现代替。

本轮新增 `test:approvals` 随包门禁，覆盖副作用、拒绝、切聊天、取消、刷新、恢复与退出；实际通过项、源码／EXE 指纹以对应运行报告为准。本地 `--source` 全应用尝试在首个业务请求前被 Chromium 单实例 Unix socket `EPERM` 阻断，模型请求为 0，不能记为审批链通过。0.42.0 的发布与实包结果仍只属于 0.42.0。

## 0.41.0 草稿与局部订阅核对

本轮读取当前锁定依赖中 `@deepseek-ai/dsh-client-ui-chat@0.2.2-rc.5` 的 `src/client/chat/use-turn-data.ts`，核对它通过 `useSyncExternalStore` 订阅单个 keyed value；同时读取 `dsh-client-ui-conversation@0.2.2-rc.5` 的 `src/client/draft.ts` 和 `src/client/input/facade.ts`，核对独立语义草稿快照、会话输入模型、提交消费与恢复边界。这是安装依赖源码证据，未重新打开用户 D 盘的 Harness 桌面窗口。

| 范围 | 结论 | 知行及边界 |
| --- | --- | --- |
| 按键订阅与局部流式正文 | **部分** | 当前输入框和运行正文按草稿键/runId订阅；没有移植完整 Turn Location、Lexical 与队列模型 |
| 独立草稿与 revision | **部分** | 保留知行既有归属、附件 revision、消费及失败恢复，移除按键触发整库保存；未实现上游完整引用、command chip、quote 快照 |
| 磁盘存储格式 | **未核对** | `workspace.bin` / `drafts.bin` / epoch 为知行的加密持久化实现，不宣称 Harness 桌面同格式；SQLite 尚未做 |
| 全局/面板错误恢复的桌面 UI 等价性 | **未核对** | 本轮为现有界面增加基础容错，不改变内核机制；未取得桌面版相同 fallback 交互证据 |

三份上游源文件 SHA256 依次为 `d73a23b1310ad7933698daa2c831cacae8b009490823a36b6f6542ff4d07dfad`、`1bac06e426106152c2f5f1bc475a72795f5dbed44742064fd5d419868e6f576c`、`35d04426a4ac222b890ff0926acd3742df88e7862e90ba3a7ebb55c4a4791266`。本轮实际运行结果以 0.41.0 发行资产的验收摘要为准，不把上游源码核对等同于知行端到端验收。

## 0.42.0 工作面板导航与交付文字预览核对

本轮以 `cabb754b08883902b12f876e2d68338a7699d5fb` 为开发起点，读取锁文件恢复的 `@deepseek-ai/dsh-client-ui-sidebar-right`、`dsh-client-ui-sidebar-documentpreview`、`dsh-client-ui-deliverables` 与 `dsh-client-ui-chat`，均为 `0.2.2-rc.5`。这是 npm 依赖源码核对，没有重新取得用户 D 盘的桌面包、当前窗口或完整 200 包安装清单。文件指纹与观察位置见 [上游证据](evidence/0.42.0/upstream-workbench.json)，范围与生命周期见 [本轮机制说明](workbench-preview-0.42.0.md)。

| 范围                                           | 结论       | 知行候选实现及边界                                                                                                                                             |
| --- | --- | --- |
| 工作面板内可见标签                             | **部分**   | 现有九个功能视图通过可见标签切换，保留三个顶栏入口和浏览器首页快捷入口；没有移植原生按资源动态建 tab、停靠分栏、浮窗与会话布局持久化                           |
| 交付卡片、行内引用的右侧预览                   | **部分**   | 从原文档弹窗入口改为右侧「产出」页的提取文字预览，仍先核验主机交付记录；每次只显示一个选中文件，不等同于原生每资源一个 tab                                     |
| 预览加载、失败与重试                           | **部分**   | 前端按作用域和请求代次拒绝迟到结果，提供返回列表、重试与复用原文档弹窗的放大入口；已发出的主机解析不因此被取消，不具有原生分页、版本观察、自动刷新与完整取消链 |
| 交付文件的图片、PDF、Office 原版面及表格查看器 | **未做**   | 本轮右侧交付预览显示提取文字和读取范围，不接入这些原生渲染器；既有项目文件页的 Office 功能不是本轮交付引用授权链的替代品                                       |
| 与当前 Harness 桌面窗口的视觉一致性            | **未核对** | 核对的是锁定版本的官方源码和历史记录，不能据此宣称逐像素一致或完整桌面机制已接入                                                                               |

本节保留构建时的机制核对，不用源码分析证明发布成功。0.42.0 已发布的独立结果见 [正式 Windows 验收](windows-acceptance-0.42.0.md) 与 [发布证据](evidence/0.42.0/final/)；历史 0.26–0.30 的 Windows 结果仍只属于当时的构建。

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
| 运行中排队（busy Enter） | `dsh-client-ui-conversation` | **部分**：0.44.0 起运行中提交进入按聊天隔离的队列，本轮结束后按顺序自动发送；队列随加密工作空间保存，失败可重试、可编辑删除。上游 `busyEnter` 默认值即 `queue`，文案为「排队发送」「{n} 条排队消息」 | **插话发送（steer）未做**：上游 `Ctrl/Cmd+Enter` 可把排队消息插进正在运行的一轮（`updateQueue` 的 `kind: steer`），知行仍只在轮次结束后发出。见 `docs/audit-0.44.0.md` |
| 会话标题 | `dsh-session-title` | **部分**：0.44.0 起按上游 `normalize.js` 的口径清 OSC／CSI／ESC／C0-C1 与方向控制符，再按 UTF-8 字节截断；空标题回退「新的交办」 | 模型生成标题（`dsh-session-title-first-prompt-llm`、`dsh-experimental-session-titles-bundle`）未接入，知行仍用首段交办的清洗结果作标题 |
| 消息反馈（赞／踩／原因） | `dsh-message-feedback`、`dsh-command-feedback`、`dsh-client-ui-message-feedback` | **部分**：0.24.0 起有赞／踩、分类、备注与独立加密记录；Phase 0A 修复超限备注无法清除 | 本轮只有源码组件回归；历史 Windows 证据仍属于 0.24.0，不冒充当前候选 |
| 秘钥遮蔽显示 | `dsh-client-ui-secret-mask` | 部分：脱敏网关 + 凭证阻断 | Harness 是界面层遮蔽，知行是发送前替换，口径不同要写清 |
| 轨迹视图 | `dsh-client-ui-trajectory` | **部分（0.25.0 起可检索）**：执行面板已有按交办切换、事件分类、状态／耗时／轮次／步骤、子任务与后台作业、检索（标签／状态／分类，含子任务与作业名）、展开／收起全部、子会话与作业输出、归档 | 未做：桌面版按轮次分组的记录表、单条记录检查器里的输入／输出／token 用量、时间概览（TTFT／吞吐／缩放）、按轮次折叠、代码视图语法高亮 |
| 交付物视图               | `dsh-workspace-changes`、`dsh-deliverable-file-references`、`dsh-client-ui-deliverables` | **部分**：保留 0.30.0 起的改动卡片、逐文件对比及交付卡片；已发布 0.42.0 将交付卡片与行内引用接到右侧「产出」页的提取文字预览，并保留既有打开／定位动作，验证范围见本轮说明                     | 未做：git 工作树快照（终端／外部程序的改动不进卡片与对比）、独立 review tab 与其「开始／结束」整文件口径、并排视图与换行开关、review 内的打开／定位控件；交付预览没有原生动态资源标签、分页、自动刷新或图片／Office 原版面渲染。「在默认应用中打开」的成功路径未在历史自动验收中点击 |
| 会话日志 | `dsh-client-ui-settings-session-log`、`dsh-session-log-deepseek`、`dsh-session-log-export` | **未做（有意偏差，口径已纠正）** | `dsh-client-ui-settings-session-log` 是设置项「在使用官方模型 API 时上传 Session Log」的开关，用于改进 DeepSeek 模型，**不是日志查看器**；知行禁用了 `session-log-deepseek`，不上传会话日志。这与「知行有 `app.log` 与诊断导出」是两件事，0.44.0 已纠正原先「未核对」的写法 |

## 代理、协作与自动化

| Harness 机制 | 包 | 知行现状 | 差距 |
| --- | --- | --- | --- |
| 子代理 | `dsh-subagent`（含 `dsh-client-ui-subagent`） | **部分**：子任务可见、可归档；Phase 0A 真实内核＋本地服务验证 OpenAI / Anthropic spawn 继承父模型并发出子请求 | Windows 真实子任务归档仍待复验；旧脚本只看最后消息会漏判，已修正 fixture 识别。0.43.0 核对真实委派审批固定为 `never`，不会向人工审批 UI 申请放行；不能把父模型继承等同于权限继承 |
| 智能体团队 | `dsh-agent-team`、`dsh-client-ui-agent-team` | **部分**：内核共享任务、负责人和依赖能力已有源码及历史合成运行记录 | 完整桌面团队编排 UI 未核对，不能由内核工具存在推断界面已齐备 |
| 工作流运行 | `dsh-workflow`、`dsh-client-ui-workflow-run` | **未核对** | 知行没有工作流入口 |
| 后台作业 | `dsh-client-ui-jobs` | 部分：执行面板 | 口径未对齐 |
| 计划模式 | `dsh-client-ui-plan` | 已对标（`/plan`） | — |
| 目标 | `dsh-client-ui-goal`、`dsh-command-goal` | 已对标（`/goal`） | — |
| 技能 | `dsh-skill`、`dsh-tool-skill`、`dsh-skill-office`、`dsh-client-ui-skill` | **部分**：内核技能与办公技能已挂载，UtilityPage 有目录入口；Phase 0A 验证完整 composePrompt 加模式前缀后，用户技能手势仍注入完整技能正文 | 完整桌面技能管理 UI 未核对；本轮 Linux／Windows 源码合成服务结果不等于 Windows 实包全技能端到端通过 |
| worktree | `dsh-experimental-worktree`、`dsh-experimental-tool-worktree` | **部分**：已有项目工作树服务与入口 | 原生插件机制和桌面完整交互未核对；工作树不等于每轮 Git 快照与回滚 |
| 定时任务 | `dsh-schedule`、`dsh-tool-schedule`、`dsh-client-ui-schedule` | **部分**：主进程加密调度 + 重审 | 未对照 Harness 的补跑与授权失效规则 |
| 动作卡片 | `dsh-action-cards`、`dsh-client-ui-action-cards` | **未做** | `propose_action` 及注册动作执行仍未接入；0.43.0 候选的普通工具审批不属于此机制 |
| 提问回流 | `dsh-user-questions`、`dsh-client-ui-user-questions` | **部分**：0.43.0 候选将所属会话的必要提问与方案审批放入输入区，并支持读取仍在等待的请求 | 保留原生答案验证；未移植完整问题投影、隐藏后重开、等待 claim／倒计时与超时后续答。候选 Windows 实包结果另记 |

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
| 普通工具审批 | `dsh-user-approval`、`dsh-client-ui-approval` | **部分**：0.43.0 候选接入当前聊天输入区的单次允许／拒绝、原生取消与主机请求队列 | 不提供会话／永久授权或拒绝意见；真实委派子 Agent 仍受原生 `never` 策略约束，自动化不借用人工审批；见本页候选章节 |
| 服务授权 | `dsh-authorization` | **未核对** | 此包的服务／凭据授权不能与工具批准混为一项；本轮不据工具审批提升 OAuth 等授权能力状态 |
| 权限预设 | `dsh-permission-presets`、`dsh-client-ui-permission-presets` | **部分**：保留现有请求批准／帮我批准／完全访问映射 | `approvalPolicy: never` 表示拒绝需要审批的请求，不是自动允许；auto 的现有新建文件规则不是原生 Auto Reviewer，完整预设集合仍未核对 |
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
| 工作面板导航与侧栏内容 | `dsh-client-ui-sidebar-right`、`dsh-client-ui-sidebar-browser`／`-terminal`／`-files`／`-documentpreview` | **部分**：已有浏览器、交互终端、项目文件与其他真实视图；已发布 0.42.0 将视图选择器改为可见标签，并加入右侧交付文字预览 | 固定功能标签不同于原生资源 tab／停靠布局；交付文字预览不同于完整文档查看器。浏览器、终端与文件页其余行为保留各自历史范围，不能由本轮导航改造升级为全量已对标 |
| 桌面宿主 | `dsh-desktop-host`、`dsh-sdk-client` | **部分**：有 Electron 主进程承载；当前仍每轮新建 `DeepSeekHarness` 并在最终清理关闭 | SDK 本身缓存同一对象的 client／初始化，支持复用；知行尚未迁移到跨轮复用。`dsh-cordis-host-runner` 是同一 Cordis 内的动态插件注册／生命周期服务，不是 OS 常驻进程管理器。0.43.0 的结果交接也不改变这一状态 |
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
