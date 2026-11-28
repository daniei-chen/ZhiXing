# 01 · 运行时内核与交办状态机（B / C / D）

> 审计线程 HOME-11 · 基线 `main a73cc7d`（`git log -1 --format=%h` 实测；PR #2「v0.42.0 workbench tabs」已合入，PR #4「排队交办」未合入本树）· 只读审计，未改产品代码、未 commit、未 push。
>
> 取证口径：通读 `electron/runtime.mjs`(900 行)、`electron/runtime-handoffs.mjs`(253)、`electron/runtime-approvals.mjs`(204)、`electron/renderer-lifetime.mjs`、`electron/workspace-save-queue.mjs`、`electron/workspace-persistence.mjs`、`src/App.jsx`(1843)、`src/message-queue.js`、`src/store.js`、`src/conversation-state.js`；实跑 4 组单测；用本机真实内核子进程做了 3 次启动耗时实测。
>
> 本机 `node_modules` 原本不存在，为跑测试执行了一次 `npm ci`（1327 包，10 分钟）。这是环境准备，不是仓库改动。`gh` CLI 在本机不可用，PR 信息只能靠 `git log` 与分支名判断。

---

## B. 代码地图（这一层）

### B1 一条交办在磁盘上留下什么（状态机）

状态机分两半：**渲染层**（`src/App.jsx`）管草稿/队列/气泡，**主机**（`electron/runtime.mjs`）管内核进程与结果交接。两半之间只有一条耐久契约：`agent:begin` 之前必须把「用户消息 + 待定气泡」写进 `workspace.bin`，否则主机拒绝开跑（`electron/main.cjs:659`–`660` 的 `reply` 校验，`agent:begin` 里 `pending` 气泡必须存在）。

| 状态 | 触发点 | 内存持有者 | 磁盘落点 | 是否 `await` |
| --- | --- | --- | --- | --- |
| 草稿 Draft | 输入框 | `inputRef` + `draftSlices` | `drafts.bin`（400 ms 空闲 / 2 s 上限） | 是（`draftWriter.flush()`） |
| 排队 Queued | `queueCurrentDraft()` `src/App.jsx:954` | `queueRef` + `queue` state | `workspace.bin` 的 `queuedMessages` | **否**：`publishQueue` 里 `void persistWorkspaceSnapshot(...)` `src/App.jsx:940` |
| 派发中 Sending | `dispatchQueued()` `src/App.jsx:995` | `queueBusy.current = true` | `queuedMessages[i].sending = true` | **否**，同上 |
| 已提交 Submitted | `startReply()` `src/App.jsx:1205` | `active.current = job`，乐观追加 user + assistant 双气泡 | `await persistWorkspaceSnapshot(submittedState)` `src/App.jsx:1237` | **是**——这是唯一「先落盘再启动内核」的点 |
| 宿主受理 Accepted | `desktop.beginRun` 返回 `src/App.jsx:1244` | `accept()` → `onAccepted` → `acceptQueued()` `src/App.jsx:975` | 队列项被移除；**这次保存是 fire-and-forget** | **否** ← 缺口 |
| 运行中 Running | 主机 `run()` `electron/runtime.mjs:487` | `runs` map + `busy` set | 无（只有 `run/terminal` 事件） | — |
| 结果就绪 Result | `handoff.start` 返回 `electron/runtime-handoffs.mjs:90` | `RuntimeHandoffs.entries`（上限 16） | 无 | — |
| 已交接 Handed off | `receiveHandoff()` `src/App.jsx:895` | `finalizeRun` 改气泡终态 | `await persistWorkspaceSnapshot` `src/App.jsx:903` | 是 |
| 已确认 Acked | `acknowledgeSavedHandoffs` `src/App.jsx:884` | `pendingReceiptAcks` 删除 | `workspace.bin` 里该消息带 `resultReceiptId` | 是 |

三个必须点名的结构事实：

1. **`run/terminal` 不是状态的唯一出口。** 主机在 `run()` 的 `finally` 里先 `closeHarness`（`electron/runtime.mjs:789`），再 `finishCleanup`（`:796`），最后才发 `run/terminal`（`:812`）。也就是说「内核进程退出确认」排在「结果交给渲染层」之前。这一层是对的：渲染层拿到终态时，主机已经确认过进程状态。
2. **`RuntimeHandoffs` 是纯内存账本**（`electron/runtime-handoffs.mjs:83`，`entries` 是 `Map`）。主机进程一死，所有未 ACK 的结果都没了——包括已经算完但界面还没保存的那一份。这是设计边界，不是缺陷，但决定了「主进程崩溃」= 「本轮结果丢失，只能重跑」。
3. **恢复靠 `mergeState` 打补丁**（`src/store.js:107`）：加载时若某个 `pending` 气泡在 `runHandoffs` 快照里找不到对应 run，就改写为 `pending:false, stopped:true, status:'interrupted'`。所以「界面刷新后气泡卡在思考中」这类问题在这一层被消掉了。

### B2 重试路径：三条入口，一处重复窗口

三条重发入口互不重叠：

| 入口 | 代码 | 语义 |
| --- | --- | --- |
| 直接发送失败（未受理） | `src/App.jsx:1263`–`1276` | 撤回双气泡 + 草稿还给输入框；`!accepted` 分支，不产生重复 |
| 已受理后失败 | `src/App.jsx:1247` 调用 `restoreFailedSubmission`（定义在 `:1151`） | 只在 `executionStatus` 既非 `cancelled` 也非 `completed` 时把草稿还原；气泡保留为 interrupted |
| 队列重试 | `src/App.jsx:984` `retryQueued` | 只清 `error`/`sending` 两个字段，再由 `dispatchQueued` 重跑 |

**重复窗口（P2）**：`acceptQueued` 的持久化是 `void`（`src/App.jsx:940`）。时间线是

```
await persistWorkspaceSnapshot(submittedState)   ← 磁盘：user 消息 + 待定气泡 + 队列项(仍在)
await desktop.beginRun(...)                      ← 主机受理
accept() → acceptQueued() → publishQueue()       ← 内存：队列项删除
        └─ void persistWorkspaceSnapshot(...)    ← 磁盘：队列项删除（不等待）
```

`beginRun` 返回与这次「不等待的保存」落盘之间被硬杀（断电、任务管理器结束进程、`process.exit`），磁盘上同时存在「同一段文本的 user 消息」和「同一段文本的队列项」。重启后 `mergeState` 把气泡改成 interrupted，队列项则被 `src/store.js` 标成可重试；用户看到同一句话出现两次，点重试就多花一次模型调用。

PR #6 的思路（在提交的消息上打 `queueId`，恢复时按 `queueId` 过滤队列）正是对症的补丁，但**当前树里没有这个字段**：`grep -rn queueId src/ electron/` 无任何命中。所以这个窗口在本基线是敞开的。

另一个更隐蔽但方向相反的窗口：`publishQueue` 的保存失败只写进 `saveStatus`（`src/App.jsx:940` 的 `.catch`），内存里的队列已经删了、磁盘上还在。界面这一轮不会重发（内存已删），重启后磁盘会把队列项复活——所以「保存失败」在这一处表现为「重启后多出一条要重试的旧消息」，不是当场报错。

### B3 每轮固定成本：一个内核进程 = 9.4–11.7 秒

`run()` 每轮 `createHarness` 一次（`electron/runtime.mjs:487`），也就是**每条交办都新起一个 Node 子进程**（`ELECTRON_RUN_AS_NODE`，`electron/runtime.mjs:199`）。我用同一条真实内核、同一条本地合成服务实测了三次冷启动：

```
{"create":210,"start":9410,"run":334,"close":679,"total":10633}
{"create":94,"start":10105,"run":245,"close":158,"total":10602}
{"create":94,"start":11711,"run":306,"close":155,"total":12282}
```

（`create` = `makeHarness` 写 `zhixing.patch.json`；`start` = `h.start()` 等到内核就绪；`run` = 一次合成模型往返；`close` = `h.close()`。）

结论：**固定开销几乎全在 `h.start()`，约 9.4–11.7 秒**，一次真实往返只要 0.25–0.33 秒。用户体感上「第一句话要等十秒」是这个原因，不是模型慢。

按代码顺序，一轮里还有这些固定等待，多数落在失败路径上：

| 等待 | 上限 | 位置 |
| --- | --- | --- |
| 内核 `initialize` | 20 000 ms | `electron/runtime.mjs:200` `initializeTimeoutMs: 20000` |
| 隐私网关 + 控制桥就绪 | 未单独设上限，`start()` 之后 | `electron/runtime.mjs:595` 附近 |
| `waitContext`（上下文回执） | 5 000 ms | `electron/runtime.mjs:73` `waitContext` 内部循环 |
| 关闭内核 | 10 000 ms | `bounded(..., active.cleanupTimeoutMs)` `electron/runtime.mjs:250` |
| 桥关闭（`approvalBridge` 等） | 10 000 ms | `electron/runtime.mjs:790` |

也就是说：一轮**成功**路径的固定成本 ≈ 9.4–11.7 s（启动）+ 0.3 s（往返）+ 关闭；一轮**失败**路径在关闭环节最多再叠 10 s。`run()` 的 `finally` 里桥关闭与内核关闭是串行的，不是并行。

### B4 失败边界：750 / 6 000 / 10 000 三个数怎么叠

`harness.close()` 由 SDK 实现，`disposeEofGraceMs: 750`、`disposeGraceMs: 6000`（`electron/runtime.mjs:200`）。SDK 的语义是：先等 stdin EOF 750 ms，再等强制终止确认 6 000 ms，都超时就抛错。所以 SDK 自身最坏 ≈ 6 750 ms。知行在它外面再套一层 `bounded(..., 10000)`（`electron/runtime.mjs:250`）。

失败路径的实际耗时（按代码推导，非实测）：

1. `run()` 的 `finally` → `closeHarness`：SDK 约 6 750 ms 抛错 → 包成 `RUNTIME_CLOSE_FAILED`。
2. `harnessClosed = false` → `cleanup_pending`，`scheduleCleanup` 排 1 s 后重试（`electron/runtime.mjs:327`，`cleanupRetryDelays = [1000, 3000, 10000]`，`electron/runtime.mjs:302`）。
3. 重试走 `terminateKnownProcess(child, 6000)`（`electron/runtime.mjs:231`），最坏再 6 s。
4. 三次重试（1 s / 3 s / 10 s）用尽后 `scheduleCleanup` 直接 return（`electron/runtime.mjs:327` 的 `cleanupAttempts >= cleanupRetryDelays.length`），**此后不再有任何自动重试**。

合计约 6.75 + 1 + 6 + 3 + 6 + 10 + 6 ≈ **38.8 秒**，然后进入永久隔离。

`cleanup_pending` 留下的东西，逐项列清楚：

| 留下什么 | 为什么 |
| --- | --- |
| `runs` map 里的这条 run | 只有 `releaseRun()` 会删（`electron/runtime.mjs:331`），且调用点要求 `harnessClosed` 为真（`:816`），退出确认前不删 |
| `busy` set 里的 `sessionId` | 同一处，导致该会话每次 `run()`/`preview()`/`runPrepared()` 都被拒（`electron/runtime.mjs:458`、`:474`、`:495`） |
| `runSettlements` 里的 settlement | 供 `waitForRun` 复用 |
| 内核子进程（可能还活着） | 这就是「没确认退出」本身 |
| 临时 `DSH_HOME` 目录 | `finishCleanup` 只在 `processExited` 为真时才删（`electron/runtime.mjs:796`） |
| 加密的 `privacy-bridge` 与 `context` 文件 | 同上，`bridgeFile` 只在确认退出后才删 |
| 未 ACK 的 `RuntimeHandoffs` 条目 | 主机内存，占着 16 条上限中的一条 |

界面能做的只有「重试清理」（`src/App.jsx:1726` 的按钮，`onClick` → `retryCleanup`，定义在 `:1478`）。**没有「放弃并强制释放」入口**。

### B5 并发：五个闸门 + 三个名额

渲染层有五个互不相同的闸门，名字相近但语义不同：

| 闸门 | 类型 | 语义 | 位置 |
| --- | --- | --- | --- |
| `loaded` | state | 工作空间已读完 | `src/App.jsx:654` |
| `busy` | state | `submit()` 正在跑（prepare/落盘/起内核） | `src/App.jsx:1067` |
| `queueBusy` | ref | 队列派发锁 | `src/App.jsx:997`、`:1004` |
| `active` | ref | 当前这一轮（`job`） | `src/App.jsx:1205` |
| `running` | state | 给界面看的运行中状态 | `src/App.jsx:95` |

自动派发的 `useEffect` 同时检查五个（`src/App.jsx:654`），这是全仓库最严格的一处。真正需要点名的三处：

1. **`submit()` 在「本轮是别的聊天」时静默早退。** `src/App.jsx:1069`–`1071`：`if (active.current) { if (!sideTarget && !repeatMessageId && !actionCommand && active.current.chatId === chatId) queueCurrentDraft(); return; }`。当 `active.current.chatId !== chatId` 时直接 `return`，不排队、不提示、不 toast。用户在聊天 A 跑着的时候到聊天 B 按回车，什么都不会发生。这是「静默失败」而非「排队」。
2. **`queueBusy` 只靠 `acceptQueued` 或 catch 释放。** `src/App.jsx:1004` 置 true，`src/App.jsx:1005` 的 `acceptQueued` 置 false，`src/App.jsx:1060` 的 catch 置 false。若 `desktop.prepareRun` 或 `startReply` 里的 `await` 永不返回（主机卡住），`queueBusy` 永远为 true，队列与输入框同时死锁，且**没有任何超时**。只能靠全局错误恢复重挂 App 才恢复。
3. **主机侧只有三个名额，且 `cleanup_pending` 也占名额。** `electron/runtime.mjs:494` 的 `if (this.runs.size >= 3)`。`runs` 只在 `releaseRun()` 里删除，而隔离中的 run 恰恰不会走到那一步。于是**三个卡住的内核 = 全应用所有聊天都不能再发起任何一轮**，报错文案是「已有三个任务在运行，请稍后再试。」——此时并没有任务在运行。`check()` 用的是同一个计数（`electron/runtime.mjs:400`），所以「内核能力自检」也会一起被拒。

### B6 IPC 契约：谁校验、runId 归谁、渲染层能伪造什么

**入口守卫**：`trusted(event)` 要求 `event.sender === windowRef.webContents`、`senderFrame === mainFrame`、`senderFrame.url === 'zhixing://app/index.html'`（`electron/main.cjs:284`）。三个条件同时满足，所以只有本应用的主框架能调；子框架、`file://`、`data:` 都被拒。这是这一层唯一的边界，且它是对的。

**参数校验**分散在主机侧，不在 `handle()` 里：

| 通道 | 校验点 | 强度 |
| --- | --- | --- |
| `agent:prepare` | `run()` 里 `sessionId` 正则、`prompt` 长度 ≤ 600 000、`customTerms` ≤ 100（`electron/runtime.mjs:429`） | 强 |
| `agent:begin` | `usedRunIds` 去重 + `runs.has(runId)`（`electron/runtime.mjs:494` 附近的 `start()`） | 强 |
| `agent:run-prepared` | 同 `run()` | 强，但**绕过了「待定气泡必须先落盘」** |
| `agent:await-handoff` | `RuntimeHandoffs.wait()` 用 `runId` 查表，查不到抛错 | 中 |
| `agent:ack-handoff` | `RuntimeHandoffs.acknowledge()` 只认 `saved` 谓词（`electron/runtime-handoffs.mjs:200`） | 中 |

**`runId` 归渲染层**：`runId` 由 `src/App.jsx` 的 `uuid()` 生成，随 `agent:begin` 送到主机。主机不做「这个 runId 是不是我发的」的检查，只做「用没用过」的检查。所以渲染层能伪造一个全新的 `runId`——但那等于「又发一轮」，不是提权。真正需要注意的是**语义**：主机无法区分「同一轮的重试」和「用户真的又发了一次」，只能靠 `usedRunIds` 去重。

**`agent:run-prepared` 是活口子（P2）**：`electron/main.cjs` 里注册了 `agent:run-prepared`，它直接调 `run()`，不经过 `agent:begin` 的「待定气泡必须已落盘」前置检查，也不产生 `RuntimeHandoffs` 记录。所以从它进来的这一轮**没有耐久回执**——主机崩了，结果就没了，而界面上那轮还在。当前 `src/App.jsx` 的非 demo 路径走的是 `agent:begin`（`src/App.jsx:1244`），`runPrepared` 只在 demo 分支里被调用（`src/App.jsx:1250` 的 `demo ? {...} : await desktop.runPrepared(...)`），所以这个口子在正式路径上是**死代码**。但它是活的 IPC 通道，且比 `agent:begin` 弱一档。

**结果能不能伪造**：`agent:ack-handoff` 的 `saved` 谓词读的是 `workspaceContext`（`electron/main.cjs` 的 `ack` 分支），也就是**渲染层自己写进 `workspace.bin` 的内容**。渲染层可以写一条带正确 `resultReceiptId` 的假消息，然后 ACK，主机就会丢掉它手里那份唯一完整的私有结果。这不是提权（渲染层本来就能读写自己的磁盘），但它是**数据完整性**上的一个自证陷阱：ACK 的信任根在渲染层，不在主机。

---

## C. 运行实况（这一层跑出来的）

### C1 单测：4 组通过，1 组不稳

| 套件 | 结果 | 耗时 |
| --- | --- | --- |
| `tests/runtime-handoffs.test.mjs` | **13/13 通过** | 0.61 s |
| `tests/runtime-cleanup.test.mjs` + `tests/runtime-finalization.test.mjs` | **24/24 通过** | 7.4 s |
| `tests/runtime-approvals.test.mjs` | 通过（并入 5 套件合计 28 例） | — |
| `tests/runtime-lifecycle.test.mjs` | **不稳**：4 次运行，通过数 1 / 4 / 2 / 1（5 例/次） | 每例 12–24 s |

`runtime-lifecycle` 的 4 次运行明细（失败原因每次都一样）：

```
✖ 停止保留已生成正文… (22113ms)         ✖ 再次执行… (16751ms)
✖ openai 首个流式 chunk 后取消… (22033ms) ✖ deepseek 首个流式 chunk 后取消… (22699ms)
✖ Runtime lifecycle did not settle within the test deadline.
   at tests/runtime-lifecycle.test.mjs:34:37
```

同一个用例在 13.1 s 通过、在 22.1 s 失败——`within()` 的默认预算 15 000 ms（`tests/runtime-lifecycle.test.mjs:28`）比本机实测的内核启动（9.4–11.7 s）加合成服务往返更紧。**这不是产品挂了，是门禁的预算比硬件慢。** 但它意味着：这条门禁在本机有约 60% 概率红，任何「lifecycle 全绿」的证据都必须带机器与耗时，否则无法复现。

### C2 内核启动实测（3 次，本机 Windows）

```
{"create":210,"start":9410,"run":334,"close":679,"total":10633}
{"create":94,"start":10105,"run":245,"close":158,"total":10602}
{"create":94,"start":11711,"run":306,"close":155,"total":12282}
```

`h.start()` 占 88–95%。三次都成功，说明内核子进程在本机可以正常起停；`finishReason` 为 `error` 是因为合成服务没实现 Anthropic 协议，与启动无关。

### C3 环境事实（影响结论可信度）

- `npm ci` 之前 `node_modules` 不存在，所有 `tests/runtime*.test.mjs` 在 import 阶段就红（`Cannot find module '@deepseek-ai/dsh-sdk-client'`）。也就是说**这批测试在干净 checkout 上默认不可跑**，必须先装依赖。
- `gh` CLI 不可用，`git log` 显示 HEAD 为 `a73cc7d`（PR #2 已合入，PR #4 未合入）。历史记录里提到的「PR #6 强杀后不重发已受理的排队交办」补丁**不在本树**，所以 B2 的重复窗口是当前基线的真实状态，不是已修问题。

---

## D. 缺陷与风险清单

按严重度排序。本层没有 P0：没有一条会让用户在**正常路径**上丢数据或算错；最重的是「一个卡住的内核能让全应用停摆」。

`P1 · electron/runtime.mjs:494 · 三个 cleanup_pending 就能让全应用停止发起新任务`

`runs.size >= 3` 是全局名额，而 `runs` 里的隔离项（`cleanup_pending`）不会自己消失——只有 `releaseRun()` 会删，而它的调用点要求「内核退出已确认」（`electron/runtime.mjs:816`）。三台机器上各卡一次，或同一台机器上三次硬杀，`runs.size` 就到 3，此后**任何聊天**发起任何一轮都返回「已有三个任务在运行，请稍后再试。」（`electron/runtime.mjs:494`），`check()` 的内核自检同样被拒（`electron/runtime.mjs:400`）。文案是错的（并没有任务在运行），且没有任何界面入口能强制释放。为什么算 P1：错误文案把用户引向「等一会」，而实际需要的是「重启应用」或「重试清理」，两者界面都没提示。

`P1 · electron/runtime.mjs:331 · 隔离中的会话被永久占住，且没有「放弃」出口`

`busy` set 只在 `releaseRun()` 里删 `sessionId`（`electron/runtime.mjs:331`）。隔离期间该会话的 `run()`/`preview()`/`runPrepared()` 全被拒（`electron/runtime.mjs:458`、`:474`、`:495`），`sessionBusyMessage` 会给出「上一轮的内核还没确认退出」这种正确文案——但界面只给「重试清理」一个按钮（`src/App.jsx:1726`）。重试三次都失败后（约 38.8 s，见 B4），用户没有任何办法把这个会话解封，只能重启应用。为什么算 P1：这是一条**只能靠重启逃生**的死路，且应用没有告诉用户这一点。

`P2 · src/App.jsx:940 · 队列项移除是不等待的保存，硬杀会留下重复提交`

时间线见 B2。`acceptQueued` → `publishQueue` → `void persistWorkspaceSnapshot(...)`：磁盘上「队列项已删」这件事没有任何人等待。`beginRun` 返回与这次保存落盘之间被硬杀，重启后同一段文本既是 interrupted 消息又是可重试队列项。修法就是 PR #6 的 `queueId` 标记（当前 `grep -rn queueId src/ electron/` 无命中）。为什么算 P2 而不是 P1：需要「硬杀正好落在这几十毫秒窗口内」，且后果是重复一次模型调用，不是丢数据。

`P2 · electron/main.cjs（agent:run-prepared 注册处）· 绕过「待定气泡先落盘」的 IPC 通道仍然活着`

`agent:begin` 要求 `reply` 在 `workspaceContext` 里处于 `pending`（`electron/main.cjs:659`–`660` 的校验），`agent:run-prepared` 没有这个前置，也不产生 `RuntimeHandoffs` 记录。正式路径不走它（`src/App.jsx:1244` 走 `agent:begin`，`runPrepared` 只在 demo 分支），所以它是死代码——但它是**活的 IPC 通道**，且一旦被重新启用，这一轮就没有耐久回执：主机崩了结果就没了，而界面那轮还在转。为什么算 P2：当前不可达，但撤掉它比留着便宜。

`P2 · src/App.jsx:1069 · 别的聊天正在跑时按回车，静默无反应`

`submit()` 的早退分支：`if (active.current) { if (... && active.current.chatId === chatId) queueCurrentDraft(); return; }`。当 `active.current.chatId !== chatId` 时直接 `return`，不排队、不 toast、不写草稿。用户在聊天 A 跑着时到聊天 B 按回车，界面什么都不发生。队列逻辑本身是按聊天隔离的（`src/message-queue.js` 的 `queuedFor`），所以「在 B 排队」在数据上是合法的，只是 `submit()` 没走到那一步。为什么算 P2：不丢数据，但用户会以为输入法坏了，然后重复按。

`P2 · src/App.jsx:1004 · queueBusy 只在 accept 或 catch 里释放，主机卡住就永久死锁`

`queueBusy.current = true` 之后，只有 `acceptQueued`（`src/App.jsx:1005`）或 `dispatchQueued` 的 catch（`src/App.jsx:1060`）会置 false。中间的 `await desktop.prepareRun(...)` 与 `await startReply(...)` **没有任何超时**。主机侧 `manager.preview()` 里 `readVault`/`readBridge`/`fs.stat` 都没有超时（`electron/runtime.mjs:431` 起），`handle()` 的外层也没有超时（`electron/main.cjs:289`–`290`）。主机一旦卡在读文件上，渲染层的队列与输入框同时死锁，且没有任何提示。为什么算 P2：需要主机 I/O 卡住才触发，但触发后用户只能重启。

`P2 · electron/main.cjs:289–290 · handle() 把所有 IPC 错误压成一条 message，结构化字段全丢`

`run()` 抛出的错误带 `code`/`stage`/`finalization`（`electron/runtime.mjs:815` 附近的 `AggregateError` 分支），但 `handle()` 的 catch 只保留 `e.message`（`electron/main.cjs:289`–`290`）。所以走 `agent:prepare`/`agent:begin` 直接失败的那条路，渲染层拿到的是纯文本，`code`/`stage`/`finalization` 都没了。**结果路径**不受影响（`RuntimeHandoffs` 的 `failureOutcome` 会保留这些字段，`electron/runtime-handoffs.mjs:25`–`37`），但**启动路径**受影响。为什么算 P2：错误分类只能靠字符串匹配，`src/error-copy.js` 的映射会漏。

`P3 · electron/runtime-approvals.mjs:132 · 格式不合规的审批请求被静默拒绝，没有解释`

`request()` 在参数不合规时返回 `{outcome:'rejected'}`（`electron/runtime-approvals.mjs:132`、`:135`），审批卡片不会出现，用户看到的是「工具调用失败」。同一条路径上，`onApproval` 缺失时也是 `rejected`（`electron/runtime.mjs:227` 的 `configuration.onApproval ? ... : {outcome:'rejected'}`）。为什么算 P3：需要上游发出畸形请求才触发，但触发后用户完全无法归因。

`P3 · tests/runtime-lifecycle.test.mjs:28 · 门禁预算 15 s 比本机内核启动更紧，约 60% 概率红`

`within()` 默认 15 000 ms，而本机 `h.start()` 实测 9.4–11.7 s，再加合成服务往返与网关启动。同一用例 13.1 s 通过、22.1 s 失败。4 次运行通过数 1/4/2/1。为什么算 P3：不影响产品，但让「lifecycle 全绿」这条证据在本机不可复现，任何据此写的发布结论都要标注机器与耗时。

`P3 · electron/runtime.mjs:200 · 关闭内核与关闭桥是串行等待，最坏各 10 s`

`run()` 的 `finally` 先 `await closeHarness(...)`（`electron/runtime.mjs:789`），再 `Promise.allSettled([...bridges].map(close))`（`:790`）。两者都各自 `bounded(..., 10000)`，串行下来最坏 20 s，而它们之间没有依赖。为什么算 P3：只影响失败路径的收尾时长，不影响正确性。

---

### 附：本层没有发现的问题（写下来是为了避免下一轮重复排查）

- **审批不走渲染层**：`runtime-approvals.mjs` 在主进程里持有 `pending` 表，`answer()` 做四重匹配——`hostEpoch`（`:167`）、`requestId`（`:168`）、`runId` 与 `rootSessionId`（`:170`），并拒绝任何多余键（`:161`–`162`）。`requestId` 由主机 `randomUUID()` 分配（`:138`），不是上游的 `callId`。渲染层要伪造一次审批，必须同时猜中 epoch、requestId、runId、rootSessionId 四个值，实际不可行。
- **`run/terminal` 只发一次**：`RuntimeHandoffs` 的 `settled` 状态 + `emit` 的单次语义，`runtime-finalization.test.mjs` 的 24 例里有专门覆盖。
- **`cleanup_pending` 不会被「迟到的 run/terminal」误释放**：`releaseRun()` 的调用点要求 `harnessClosed`（即 `processExited`）为真，而 `run/terminal` 本身不携带这个信息。
- **`busy` set 与 `runs` map 的增删是同步的**：`run()` 里 `busy.add` 与 `runs.set` 在同一行（`electron/runtime.mjs:497`），没有中间态。
