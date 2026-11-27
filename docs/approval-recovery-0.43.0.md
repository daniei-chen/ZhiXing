# 0.43.0 · 原生审批与交办恢复契约

## 核对依据与对标状态

开发起点是已发布 0.42.0 的补记提交 `7076fe7a694ca772e25fc64f038e3dc909a9baf1`。本轮读取锁文件对应的官方 `@deepseek-ai/*@0.2.2-rc.5` 源码，包版本、路径和 SHA256 见 [上游指纹](evidence/0.43.0/upstream-approval.json)。没有重新取得用户 D 盘的 Harness `app.asar` 或当前桌面窗口。

| 范围                                | 对标状态 | 已核对的机制与边界                                                                                                   |
| ----------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| 普通工具审批                        | 部分     | 原生 `approval/request` waterfall 与 asked/decided 审计继续由 Harness 负责；知行提供所属聊天的输入区审批卡和主机队列 |
| 单次允许、拒绝、取消                | 部分     | 用户决策仅 `allowed-once` / `rejected`；原生取消、主机关闭或桥失效按取消/不可用结束，不新增会话放行                  |
| 原生取消的桌面传输                  | 部分     | 新回答者携带真实 AbortSignal；SDK 本身未提供普通审批取消通知，故关闭其普通审批转发，使用本机认证桥传输               |
| 必要提问与方案审批                  | 部分     | 沿用原生 user-question 协议与答案验证；按根会话保留多条待答问题，刷新可重新读取，输入区展示                          |
| Action Cards                        | 未做     | `propose_action` 是回合结束后的可选动作，接口和状态机与待批工具不同；本轮不据卡片外观提升其状态                      |
| Auto Reviewer、会话/永久授权、OAuth | 未做     | 不以“帮我批准”新文件规则冒充 Auto Reviewer；不添加未核对的放行协议                                                   |
| 与当前官方桌面的视觉一致性          | 未核对   | 本轮取源码中的 composer takeover 和单次决策语义，保留知行的中性色与墨竹，不宣称逐像素一致                            |

上游关键依据：`dsh-client-ui-approval/src/client/ApprovalPanel.tsx` 只提供允许一次与拒绝；SDK server 将原生请求缩成 `sessionId/toolName/callId/reason`，原生取消只结束 server 的 transport waiter，没有通用 client 撤回通知。知行不修改上游源码或锁定依赖。

## 请求的真实所有权

`harness/approval-bridge.mjs` 作为原生回答者，领取请求前和答复前均核对 Registry 中精确的活跃 Agent 实例，以及本次根 Agent 或它的原生子树。根 ID 来自主机运行配置，不能由工具参数或 renderer 选择。SDK 的 `approvalRequests` 在该桥启用时关闭，避免两个回答者。

桥只连接当前运行的 `127.0.0.1` 随机端口和 `/approval`，使用独立随机 token，不跟随重定向。环境变量读取后删除，token、理由和响应正文不写日志。请求与响应有界；超限失败关闭，绝不截断命令后继续授权。原生请求信号与 Cordis effect 卸载信号合并为 fetch 的 signal；HTTP 连接关闭会撤回主机对应 Promise。

`RuntimeApprovals` 每次分配独立 requestId，而不是复用 callId。主机保存不可变操作、路径、完整命令/联网范围和覆盖提示；renderer 只回传 hostEpoch、requestId、runId、rootSessionId 与结果五个字段。错误范围、重复、过期、额外参数和已取消请求不能授权。快照带单调 revision，界面先订阅再查询，不让旧查询复活已结束的卡片。

权限语义不变：ask/auto/full 继续由原有工具策略与 Harness policy 决定；自动化不继承前台审批。主机沿用既有 18 个工具名及 `mcp__` 工具范围，未知工具或无法完整解析的理由拒绝；这不是对任意第三方工具的通用批准承诺。普通审批不提供“本会话始终允许”、拒绝意见或批量允许。

## 委派子 Agent 的准确边界

上游 `dsh-subagent/src/child-agent.ts` 的 `captureDelegatedPolicyOverrides()` 把子 Agent 的审批策略固定为 `never`，并写入 `source: delegation` 的原生政策记录。这表示需要新增审批的子任务操作直接拒绝；它不是“永远允许”。

桥的所有权层支持原生拥有的子树，但当前真实 spawn 的委派策略不会让此类请求进入用户审批 UI。真实 Harness 集成用例读取本测试临时加密历史，检查 policy、asked/decided 关联及拒绝后的无文件副作用。不能据桥单元测试宣称委派子 Agent 已能弹出审批；本轮没有为显示界面而改变这项原生边界。

## 刷新、保存与恢复

手动交办启动前，先把 runId 与原 assistant message 的 replyId 保存到工作空间。主机确认该定位后只启动一次任务，并建立独立的私有交接记录。页面刷新只订阅和等待已有 run，不重新调用 `runPrepared`。

完整、已校验的本地结果只通过私有交接接口返回；公开运行快照只含有界的流式预览和白名单轨迹摘要。结果写回原消息时带 receiptId，主机必须确认这一条消息不再 pending 且相同 receipt 已保存，才移除完整结果。失败、保存失败与 cleanup_pending 分别保留；保存重试不运行模型或工具。

未 ACK 完整结果最多保留 16 份，满额时要求先保存，不逐出未保存的结果。主机生命周期内保留已接纳的 run ID，ACK 或删除不能使同一 ID 再次执行。收据不写成额外明文日志，不替代加密历史，也不声称跨主进程崩溃恢复；主进程重启后不恢复任何可批准的旧请求。

界面全局错误恢复明确标为“停止交办并恢复界面”。除了已在主机登记的任务，还预取消正在等待首次保存的本地 run；旧 App 卸载后不能继续启动。工作面板单独恢复不取消正常任务。正常退出也撤销尚未开始的本地交办；主机在等待保存后、实际执行前复查退出状态和窗口代次，避免退出收尾时启动新内核。

关闭本地保存时没有磁盘聊天定位。真正主 frame 重载或 renderer 崩溃会取消该类任务，待原运行结算且主机确认退出后清理其临时交接记录；若退出未确认，隔离和恢复资料继续保留。切聊天、SPA 导航、StrictMode 和面板错误恢复不等于页面重载。

## 验证层与未覆盖项

主机规则、实际 Cordis 服务及 HTTP、真实 Harness 配合 loopback 模型、React renderer、Windows 实包专项分别记录。正式门禁为 `npm run test:approvals`，默认要求 Windows 实包、干净源码指纹和一次性 profile。失败、跳过、缺失或清理失败均阻止发布。

`Windows approval diagnostic` 在专项脚本变更时独立构建目录包并执行同一旅程，也支持手动触发。它只提供该专项的快速反馈，报告明确列出未运行的整套回归和发行检查；不构建安装器、不发布、不替代 PR 的完整目录包门禁或 main 的 20 项发行门禁。合成服务必须在真实用户文本中唯一匹配完整场景指令，不能假设 Harness 追加上下文之后的最后一条 `user` 仍是原始交办；收到 POST 与成功识别的请求分别计数。

本地 `--source` 全应用尝试在任何业务请求前被 Chromium 单实例 Unix socket `EPERM` 阻断，模型请求 0；没有绕过保护，不写全链路通过。正式 Windows 数字由该版本发行资产自动从实际报告装配。

本轮没有 Resident Host、跨轮后台任务、队列/Steer、完整 Action Cards、SQLite、Git 快照、专业 Office 编辑、真实云端办公成功率或安装生命周期验收。没有操作用户 `D:\应用\知行`。
