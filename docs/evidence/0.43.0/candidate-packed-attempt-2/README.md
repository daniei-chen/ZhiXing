# 0.43.0 第二候选：启动身份通过，审批场景夹具失败

[打包 run 45958375578](https://github.com/daniei-chen/ZhiXing/actions/runs/45958375578)、job `140370072465` 对应 PR head `b57539c357f29c21b0246cb2443f2144024eb40b`。目录包 provenance 为 `0.43.0`、`sourceDirty: false`、Node `v24.19.0`；工作流 merge SHA 为 `b8ac25431513b02c5dd9ffdbaf8b6fb9e5545f6b`。本目录保留第二候选的原始失败，不将首轮或后续修复结果混入。

## 本轮实包结果

| 门禁 | 实际结果 |
| --- | --- |
| 目录包模块回归 | 476/476，0 失败／取消／跳过，578,542.919 ms |
| 错误文案 | 7 条 passed，另 5 条 observed；观察项不计入通过数 |
| 原生文件／导出、工具时间线 | 分别 5/5、3/3 |
| Phase 0A、Phase 1、工作面板 | 分别 9/9、7/7、10/10 |
| 新审批与恢复专项 | **1 条身份检查通过、第二项失败、其余 11 项未执行；审批业务 0 项通过** |
| NSIS | 已生成，但未签名、未安装；必需门禁整体失败 |

模块测试的来源分类为 46 个 package-aware、3 个 mixed-source、1 个 source-only **测试文件**。476 是测试运行总数，不能换算为“476 条断言全部验证包内代码”。原件见 `logs/packed.log`、`checks.json`、各 `result.json` 和 [完整 job 日志](job-140370072465.log)。汇总见 [audit-summary.json](audit-summary.json)。

## 已到达模型服务，失败发生在夹具匹配

[审批原始结果](journeys/approvals/approval-recovery-ui-vyk1v3/result.json) 的第一项已经验证实际应用版本、packaged 状态、隔离 profile、精确 `zhixing://app/index.html` URL 和工作区就绪。第二项 `ask-mode write waits in the card without any file side effect` 失败，错误为 `Fixture needs the genuine typed scenario prompt`。

**`providerRequests: []` 不能解释为 0 次实际 HTTP 请求。** [该候选脚本](https://github.com/daniei-chen/ZhiXing/blob/b57539c357f29c21b0246cb2443f2144024eb40b/scripts/test-approval-recovery-ui.mjs) 先在 413–414 行验证 model／stream，419 行验证场景，442 行才追加这个字段。第二候选已收到至少一次模型 POST，但场景匹配拒绝了它，因此没有 accepted 场景记录。原脚本没有完整记录实际 POST 总数，这里保留“至少一次，精确总数未知”的口径。不能把本次说成模型没发请求，也不能据已有原生文件专项推称新的审批业务旅程通过。

原始 [failure.png](journeys/approvals/approval-recovery-ui-vyk1v3/failure.png) 为 56,322 字节，SHA256 `20b661509059cc210cb168804620b42d56a225d79174355b6303cb875b98da3c`。它与报告的 `pending-human-review` 均原样保留，不将 AI 看图替换成人工视觉验收。失败后的进程正常 exit 0，临时 profile／工作区清理成功；清理成功不改变业务失败结论。

## 真实 Harness 的独立复现

[matcher-follow-up/prompt-shape-probe.json](matcher-follow-up/prompt-shape-probe.json) 来自 Linux 上实际 RuntimeManager、真实 Harness、本机隐私网关与 loopback 合成服务。它只保留消息角色、类型、长度、散列和匹配布尔，不保存 Key 或完整提示正文。

该探针观察到首个模型请求有 5 条消息：真正输入文本位于索引 1 的 user 消息，包含本次交办标记；后续另有 3 条内核追加的 user 上下文。旧 `findLast(role === user)` 选中最后一条追加内容，所以旧匹配为 false，真正输入的匹配为 true。此结果解释场景夹具的前提错误；它是独立复现，不能把探针的一次请求数写成本次 Windows 失败的精确请求总数。

### 随后完成的 QA 修复与本地验证

修复是在 `b57539c357f29c21b0246cb2443f2144024eb40b` checkout 上进行的**未提交 QA 脚本变更**，原候选不包含该修复。原始 probe 的 `sourceCommit` 字段保持不变；[精确 patch](matcher-follow-up/approval-fixture.patch) 与 [修复身份记录](matcher-follow-up/qa-fix.json) 补充字节级来源。修复后的脚本 SHA256 为 `15d87e7a7c9aec606575319d3ff4d1fa7ef9449e1a26a9090dc3dd822c601e44`。

脚本只在真正的 user 字符串或明确的 text block 中匹配逐行完整相等的原始场景提示，并要求总计恰好一处；不借当前场景变量猜测，不按子串、去空白或拼接块匹配。原有工具声明、完整 tool_call_id 序列、拒绝结果和禁止重放断言保留。独立 `receivedModelRequests` 在场景匹配之前记录收到的 POST，`providerRequests` 继续只记录已接受的场景请求，后续成功旅程要求两者一致。

[AST 提取的匹配器回归](matcher-follow-up/matcher/matcher-negative-probe.json) 为 **10/10**，包括内核补充 user 之后仍能定位原输入、text block 坐标，以及非 user／非 text、近似文本、重复、歧义和分块拼接的拒绝。此层只验证匹配器，不运行应用。

[真实 RuntimeManager／Harness 协议复验](matcher-follow-up/provider-protocol/verification.json) 在 Linux 运行当前原生审批桥和从修复脚本提取的 loopback provider，四个序列 allow／reject／present／reload 均通过，业务请求分别为 2／2／2／3，最终正文与真实合成文件副作用均有断言；present 的同一 callId 产生两个独立审批。每个序列另重放最后一次真实请求，**4 次均 HTTP 500 且 accepted 计数不增加**。因此该故障注入探针共收到 13 次模型 POST，其中 9 次业务请求、4 次有意拒绝的重放；这是探针计数，不能回填原 Windows 失败。

这里 `reload` 只是原夹具的序列名称，本地只验证 **write → present → final**，没有实际刷新 renderer，也没有验证接续 ACK。审批决定由程序调用 broker，不代表用户点击 UI。首次 scratch probe 错把 `reasoningMap` 配成 true，四次均在模型请求前失败；[原失败结果与说明](matcher-follow-up/provider-protocol/bootstrap-invalid-probe-config-note.json) 完整保留。改为调用产品的 `resolveProvider` 后才取得上述四个成功序列。

这些本地结果没有改变第二候选的失败结论。**修复后的 Windows 13 项审批专项尚未运行**，不能用本地 probe 替代；也未修改产品代码或放宽 UI 业务断言。

## 同候选的源码通过证据

`source-checks/` 单独保存 [源码审计摘要](source-checks/audit-summary.json)、[实际 checkout 身份](source-checks/checkout-identity.json)、源码日志与修正后的恢复旅程。源码 run `45958375606` 实际检出 `b8ac25431513b02c5dd9ffdbaf8b6fb9e5545f6b`；tree `6e996afdbdf4b2d5eb39034d304cad2e081b46aa` 与 head 一致。

本次源码 **691/691**、组件与隔离 renderer **45/45**、Sites **4/4**，均无失败／取消／跳过。`zhixing-recovery-ui-iqG5O5-journey.json` 实际有 11 条 passed；第 8 条覆盖确认删除后的问题队列、迟到请求不复活及另一根会话的问题仍可见，第 9 条覆盖删除结果的文件字节和重新载入。summary 记录 `rendererErrors: []`、`forgotten: ["chat"]`，TAP 测试完成其异步清理后通过。该证据属于 Windows Electron renderer＋合成 IPC／故障注入，**不替代本轮失败的随包真实 Harness 审批专项**。

## 归档与校验边界

打包 artifact `15180897073` 的 ZIP 为 1,423,465 字节、SHA256 `e5406d740512503b2859908b1d30a07700a1aceab3dbf517f59cf60eece60431`。源码 artifact `15180250939` 的 ZIP 为 41,983 字节、SHA256 `afd03eba093ea20c4c75b988398e69fff4ce262ece4ba94bd98fae7a7e4f6982`。下载记录记载其与 GitHub digest 一致；归档时重新复算两 ZIP，并核对打包 checks 的 46 项文件及源码 artifact 的 14 项原件。

本目录只保留本次必要小文本和审批失败 PNG，不复制成功截图或安装器；未复制文件仍在原 artifact，指纹列于 `original-files-not-copied.json`。原始 JSON／日志不经格式化，目录属性 `-text` 防止 checkout 改写换行。SHA manifest 不含自身。真实云端、签名、用户安装生命周期、后续修复的 Windows 结果和人工视觉验收仍未覆盖。
