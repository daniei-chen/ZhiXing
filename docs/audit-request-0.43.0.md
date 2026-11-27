# 0.43.0 · 独立审计入口

## 审计顺序

1. 先核对发行 tag、源码提交、包内指纹、安装器与 18 件资产 SHA256；以 `acceptance-summary-0.43.0.json` 和 Windows 验收记录读取本次实际数字，历史报告不充当本轮证据。
2. 阅读 [机制核对](approval-recovery-0.43.0.md) 与 [上游指纹](evidence/0.43.0/upstream-approval.json)。区分普通审批、必要提问、Action Cards 与委派子 Agent 的 never 策略。
3. 检查 `harness/approval-bridge.mjs`：精确 Agent/root 身份，SDK 转发关闭，原生 signal、插件 effect 清理、认证 loopback、无重定向、完整或拒绝的有界传输。
4. 检查 `electron/runtime-approvals.mjs`：主机请求 UUID、固定展示、严格五字段响应、同 callId 多请求、单次结算、过期/取消/跨 host 和 root 拒绝。
5. 检查 `electron/runtime-handoffs.mjs`、`renderer-lifetime.mjs` 和 main/preload：启动前消息已保存、只读接回、完整结果私有返回、保存收据确认、未确认退出隔离、非持久重载取消和最终清理。
6. 检查 `App.jsx`、`ApprovalPanel.jsx`、`AgentQuestion.jsx`：按当前根聊天显示，其他待批入口，停止不串 run，先订阅后快照，保留草稿与附件，global recovery 先取消再保存且阻止旧 App 晚起。
7. 在一次性 profile 执行正式 Windows `npm run test:approvals -- <candidate.exe>`，核真实文件与原运行定位；不能只看按钮消失或重复跑同一请求后得到新结果。

## 必须保留的反例

拒绝/取消前后的无文件副作用；同 callId 两次审批不能共用允许；错误 host/root 或旧 request 无效；renderer 初始保存时出错不能在恢复扫描之后偷偷启动；刷新后原完整结果和 Diff/交付不丢；保存失败不能 ACK，重试真正保存后及时 ACK；读取失败重试仍接回主机活跃运行，不能误记中断；正常退出不能启动首次保存还未完成的新任务；非持久 cleanup_pending 不可提前遗忘、真实退出后也不可永久占用交接记录。

## 本轮未覆盖

全量 Action Cards、会话放行、Auto Reviewer、常驻 Host、跨轮后台作业、SQLite、真实云端、安装生命周期、签名及完整官方桌面视觉未覆盖。目录包测试含源码夹具和 mixed/source-only 辅助模块，分类单位为测试文件；Linux组件、Windows目录包和安装后用户环境分列。未修改用户 D 盘环境。
