# 02 · 渲染层与安全边界（B / C / D）

> 审计线程 · 基线 `main a73cc7d`（`git log -1 --format='%h %s'` 实测，`git status --porcelain` 0 行，工作树干净）· 只读审计，未改产品代码、未 commit、未 push。
>
> 取证口径：通读 `electron/preload.cjs`(103)、`electron/main.cjs`(872，含全部 89 条 `ipcMain.handle` 注册)、`src/privacy-core.js`(205)、`src/privacy-recognizers.js`(122)、`src/privacy-policy.js`(39)、`src/privacy-warning.js`(18)、`src/permissions.js`(16)、`src/McpSettings.jsx`(42)、`src/AnswerText.jsx`(30)、`electron/mcp-config.mjs`(68)、`electron/deliverable-access.mjs`(228)、`electron/browser-policy.mjs`(13)、`harness/privacy-bridge.mjs`(220)、`harness/native-project-fs.mjs`(377)、`harness/office-tools.mjs`(218)、`harness/file-policy.mjs`(159)。实跑 6 个隐私/脱敏测试文件 + 1 个 MCP 目的地测试文件 + 1 个脱敏绕过复现脚本 + 1 个 CSP 探针。
>
> 本机 `node_modules` 原本不存在，为跑测试执行了一次 `npm ci`（427 s，1327 包）。这是环境准备，不是仓库改动；审计结束时 `git status --porcelain` 仍为 0 行。

---

## B. 代码地图（这一层）

### B1 渲染层（`src/`，按分工排除 `App.jsx` 的 UI/状态）

| 模块 | 职责 | 行数 | 测试覆盖 |
| --- | --- | --- | --- |
| `src/AnswerText.jsx` | 回答正文渲染：`react-markdown` + `remark-gfm`，覆写 `a`/`img`/`pre`/`code`/`table` 五个组件；外链只认 `^https?://`，其余退化成 `<span>`；`img` 一律降级成文字说明，不加载远程图片 | 30 | `conversation-drafts-ui.test.mjs` |
| `src/privacy-core.js` | `PrivacySession`：`protect()` 识别 + 占位符签发 + `restore()` 还原；`TOKEN` 正则、15 类 `RULES`、按任务隔离的 `#entries` | 205 | `privacy.test.mjs`、`credential-boundary.test.mjs`、`privacy-dynamic-keys.test.mjs`、`privacy-gateway.test.mjs`、`assistant-stream.test.mjs`、`kernel-native.test.mjs`、`office-directory.test.mjs`、`office-file-policy.test.mjs`、`runtime-policy.test.mjs`、`runtime-questions-recovery.test.mjs`、`runtime-vision.test.mjs`、`document-text.test.mjs`、`composer-runtime.test.mjs`（13 个文件） |
| `src/privacy-recognizers.js` | 识别器：`INVISIBLE` 字符集、`detectionView`、`validIban`、`validCard`、`fieldKey`、`childPrivacyContext` | 122 | `privacy.test.mjs`、`credential-boundary.test.mjs` |
| `src/privacy-policy.js` | `PRIVACY_TYPES` 15 类、`normalisePrivacyPolicy`、`privacyPolicyForMode`（raw 模式强制 SECRET 不降级） | 39 | `privacy.test.mjs`、`credential-boundary.test.mjs`、`privacy-dynamic-keys.test.mjs` |
| `src/privacy-warning.js` | `RESTORE_MARK`（`【敏感值待核实】`）与 `restoreNotice`/`exportNotice` 灰字文案 | 18 | `privacy-warning.test.mjs`（5 例） |
| `src/permissions.js` | 3 档权限（请求批准/帮我批准/完整访问）→ `sandbox` + `approval` 预设映射 | 16 | `runtime.test.mjs` |
| `src/trace-filter.js` | 工具时间线检索过滤 | 35 | `trace-filter.test.mjs` |
| `src/error-copy.js` | 失败文案映射 | 39 | `error-copy.test.mjs` |
| `src/run-summary.js` | 运行摘要（含 `restoreNotice` 的会话口径） | 63 | `run-summary.test.mjs` |
| `src/inline-references.js` | 正文行内文件引用解析（`referenceResolver`/`referenceTitle`） | 49 | `inline-references.test.mjs` |
| `src/deliverable-cards.js` | 交付卡片展示模型 | 49 | `deliverable-cards.test.mjs` |
| `src/file-actions.js` | 文件动作菜单文案（4 项） | 30 | `file-actions.test.mjs` |
| `src/McpSettings.jsx` | MCP 设置界面（12 个服务器上限、凭据重填提示） | 42 | **无**（`grep -l McpSettings tests/*.test.mjs` 无命中） |

### B2 主机侧边界（`electron/` + `harness/`）

| 模块 | 职责 | 行数 | 测试覆盖 |
| --- | --- | --- | --- |
| `electron/preload.cjs` | `contextBridge` 面：89 条 `ipcRenderer.invoke` + 1 条 `send`（`app:quit-prepared`，`electron/preload.cjs:65`）+ 10 条 `on` 订阅；**无** `invoke(channel, ...)` 泛化入口 | 103 | `app-queue-ui.test.mjs`、`app-send-failure-ui.test.mjs`、`capability-ui.test.mjs`、`conversation-drafts-native.test.mjs`、`conversation-recovery-ui.test.mjs`、`delivery-review-ui.test.mjs` |
| `electron/main.cjs` | 窗口/协议/权限/89 条 IPC 通道；`handle()` 统一包装 `trusted()` + 错误遮罩 | 872 | 无同名单测；由各 `*-ui`/`*-native` 用例间接覆盖 |
| `electron/mcp-config.mjs` | MCP 服务器身份（`mcpServerIdentity`）、凭据继承（`updateMcpServers`）、`validateMcpServers` 校验 | 68 | `mcp-identity.test.mjs`(7/7)、`mcp-destination.test.mjs`、`privacy-mcp-native.test.mjs`、`runtime-policy.test.mjs` |
| `electron/deliverable-access.mjs` | 交付文件访问：HMAC 校验 + `timingSafeEqual` + `PRIVATE` 拒绝表 + `dev/ino` 同文件判定 | 228 | `deliverable-access.test.mjs` |
| `electron/browser-policy.mjs` | `browserUrl` 地址规范化：只允许 http/https，loopback 视为 http，拒绝含凭据 URL | 13 | `workbench.test.mjs` |
| `electron/privacy-gateway.mjs` | 上游 HTTP 网关的逐块脱敏/还原 | 146 | `privacy-gateway.test.mjs`（3 例）、`assistant-stream.test.mjs`、`credential-boundary.test.mjs` |
| `harness/privacy-bridge.mjs` | 脱敏映射落盘：`writeBridge`（HMAC-SHA256 式 AEAD 前的 `writeFile`）+ `readBridge` + 锁 | 220 | 22 个测试文件引用（`assistant-stream`、`credential-boundary`、`deliverable-access`、`kernel-native`、`office-*`、`privacy-*`、`runtime-*`、`workspace-*`） |
| `harness/native-project-fs.mjs` | 原生文件系统策略：`resolve`/`checkReadTarget`/`writeText`/`applyPatch` 的路径围栏、符号链接与硬链接判定、结果脱敏 | 377 | **无**（`grep -l native-project-fs tests/*.test.mjs` 无命中） |
| `harness/office-tools.mjs` | 办公工具（Word/Excel/PDF 文本抽取）与结果脱敏 | 218 | `office-directory.test.mjs`、`office-file-policy.test.mjs`、`office.test.mjs`、`privacy-dynamic-keys.test.mjs` |
| `harness/file-policy.mjs` | `within()`、`resolveOfficePath`、`directorySnapshot`、`sameFile` 的路径与 TOCTOU 判定 | 159 | `office-file-policy.test.mjs`、`workspace-atomic-replace.test.mjs` |

### B3 脱敏管线的实际形状（这一层唯一真正的外发闸门）

```
渲染层 App.jsx:1040  new PrivacySession(chatId).protect(text, ...)   ← 预览用，不落盘
   ↓
主进程 runtime.mjs:449  privacyPolicyForMode(...) → PrivacySession.protect()
   ↓                    （redact 模式才走 vault；raw 模式仍强制 SECRET 不降级）
privacy-gateway.mjs:69  逐块 restore/protect，SSE 分块边界单独处理
   ↓
privacy-bridge.mjs      映射落盘（AEAD 加密 + 锁），跨进程给 harness 用
```

`protect()` 的识别顺序在 `src/privacy-core.js:54`–`205`：`TOKEN` 先按本任务签发的占位符保留，再走 `RULES`（15 类正则），`detectionView` 负责把全角/零宽/方向控制字符归一化。**`detectionView` 用的是 `privacy-recognizers.js:3` 的 `INVISIBLE` 集合**——这是 P0 那条的根因位置。

### B4 死代码与冗余

- `src/privacy-core.js:4` 的 `TOKEN` 正则与 `privacy-recognizers.js` 的 `PLACEHOLDER` 形状重复定义一次（两处都写 `⟦ZX-…⟧`），改一处漏一处。
- `src/message-feedback.js` 只有 3 行，是 `electron/message-feedback.mjs` 的再导出；渲染层没有任何模块 import 它（`grep -rn "message-feedback" src/` 只命中自身）。
- `src/privacy-core.js` 的 `validCard`/`validId` 只在 `RULES` 里被引用一次，`validId` 没有对应测试（`grep -rn "validId" tests/` 无命中）。
- `harness/native-project-fs.mjs` 的 `checkReadTarget` 分支在 `scope.run` 内被调用，但 `scope` 只在 `tools/pre-execute` 里 `run` 一次——`working_directory` 之外的工具不会命中该分支，属于当前不可达路径。

---

## C. 运行实况

### C1 单测（6 个隐私/脱敏文件，一次跑完）

```
node --test tests/privacy.test.mjs tests/credential-boundary.test.mjs \
  tests/privacy-dynamic-keys.test.mjs tests/privacy-gateway.test.mjs \
  tests/privacy-warning.test.mjs tests/mcp-identity.test.mjs
```

结果：**46 例 / 46 通过 / 0 失败 / 18.29 s**（`ℹ tests 46`、`ℹ pass 46`、`ℹ fail 0`、`ℹ duration_ms 18287.6965`）。

分文件实测（同一批，逐文件汇总）：

| 文件 | 例数 | 结果 | 耗时 |
| --- | --- | --- | --- |
| `tests/mcp-identity.test.mjs` | 7 | 7/7 | 369 ms |
| `tests/privacy-warning.test.mjs` | 5 | 5/5 | 244 ms |
| `tests/privacy-dynamic-keys.test.mjs` | 12 | 12/12 | 2 849 ms |
| `tests/privacy-gateway.test.mjs` | 3 | 3/3 | 874 ms |
| `tests/privacy.test.mjs` + `tests/credential-boundary.test.mjs` | 19 | 19/19 | 并入 46 例 |

### C2 MCP 目的地测试（单独跑，慢且不稳）

```
node --test tests/mcp-destination.test.mjs
```

结果：**12 例 / 11 通过 / 1 失败 / 200.8 s**。失败例是 `tests/mcp-destination.test.mjs:144`「真实 HTTP MCP 仅切换 enabled 保留凭据…」，耗时 32 957 ms，报 `RequestTimeoutError: initialize timed out after 20000ms waiting for 知行 SDK 内核`。

并入 8 文件一起跑时（`privacy` + `credential-boundary` + `privacy-dynamic-keys` + `privacy-gateway` + `privacy-warning` + `mcp-identity` + `mcp-destination`）合计 **59 例 / 58 通过 / 1 失败 / 270.5 s**，失败例变成 `:303`（长流取消），说明这两条失败例是**同一类内核初始化超时**在互相挤占，不是稳定复现的产品缺陷。

### C3 脱敏绕过复现（本层唯一的 P0，脚本实测）

```
node --input-type=module -e "…new PrivacySession().protect('手机 '+phone+' 证件 '+idn)…"
```

同一手机号 `13800138000`、同一身份证号 `110105194105…`（18 位，校验位按 MOD-11-2 算），在中间插入 5 种不可见字符后调用 `protect()`：

| 插法 | `entities` | 手机号是否被替换 | 身份证是否被替换 |
| --- | --- | --- | --- |
| 不插（基线） | 2 | 是 | 是 |
| U+200B ZWSP | 2 | 是 | 是 |
| **U+3164 Hangul Filler** | **1** | **否（原样输出）** | **否（原样输出）** |
| **U+115F Hangul Choseong Filler** | **1** | **否** | **否** |
| **U+FFA0 Halfwidth Hangul Filler** | **1** | **否** | **否** |
| **U+FE0F Variation Selector-16** | **1** | **否** | **否** |
| **U+E0100 Variation Selector Supplement** | **0** | **否** | **否** |

实测输出（U+3164 那一行）：

```
手机 138ㅤ00138000 证件 110105194105ㅤ…  → entities: 1
```

即 `protect()` 认为「只有 1 个实体」，把手机号与身份证号**原样**留在了返回值里。同一条链路上 `PrivacySession` 是外发前唯一的闸门（`electron/runtime.mjs:449`、`electron/privacy-gateway.mjs:69`），所以这 4 个字符就是一条真实的脱敏绕过。

### C4 preload 面与通道对账（无孤儿通道、无死通道）

```
grep -c 'ipcRenderer.invoke' electron/preload.cjs        → 89
grep -c 'ipcRenderer.send'   electron/preload.cjs        → 1
grep -c 'ipcRenderer.on'     electron/preload.cjs        → 10
grep -o "handle('[a-z:-]*'" electron/main.cjs | wc -l    → 90
```

`comm -23`（preload 有、main 无）：**空**。`comm -13`（main 有、preload 无）：只有 `zhixing` 一条，那是 `protocol.handle('zhixing://…')`（`electron/main.cjs:810`），不是 IPC 通道。所以 **89 条 invoke 全部有对应 `handle()`，89 条 `handle()` 全部被 preload 引用，没有 `invoke(channel, ...)` 泛化逃生口**。

`handle()` 的统一包装在 `electron/main.cjs:285`–`298`：`trusted(event)` 在最外层（`:289`），`will-navigate` 只允许 `zhixing://app/index.html`（`:784`），`setWindowOpenHandler` 一律 `deny`（`:781`）。

### C5 CSP 探针（判定「空转」的依据）

探针：独立 Electron 进程，注册自定义协议 + `onHeadersReceived` 注入同一条 CSP，页面里放一段内联脚本，读 `console-message` 与执行结果。

```
CONSOLE: Executing inline script violates the following Content Security Policy directive
         'script-src 'self''. … The action has been blocked.
RESULT headersFired=1 inlineScriptRan=false
```

结论：**`electron/main.cjs:819` 的 CSP 不是空转**——`onHeadersReceived` 触发 1 次，内联脚本被拦下（`inlineScriptRan=false`）。判定依据是这两行实测输出，不是读代码推断。真正缺的是另外两件事，见 D5。

---

## D. 缺陷与风险清单

按严重度排序。这一层有 1 条 P0，其余为 P1/P2。

### D1 · `P0 · src/privacy-recognizers.js:3（:5 重复同一集合）· 脱敏可被不可见字符绕过`

**现象**：`INVISIBLE` 正则只有 `[\u00ad\u034f\u061c\u180e\u200b-\u200f\u2060-\u206f]` 加 `\uFEFF`，缺 Hangul Filler 系（U+3164 / U+115F / U+FFA0）与变体选择符（U+FE0F / U+E0100–E01EF）。把其中任意一个插进手机号或身份证号中间，`PrivacySession.protect()` 就不再识别该实体，原文原样返回（C3 实测：`entities` 从 2 掉到 1 或 0）。

**为什么是问题**：`PrivacySession` 是外发前唯一闸门（`electron/runtime.mjs:449`、`electron/privacy-gateway.mjs:69`）。绕过它等于把手机号、身份证号明文送进模型请求与上游日志——而用户不需要任何特权，只要在输入框里粘一个不可见字符，或者从网页/文档里复制一段带填充符的文本。这条已被大队长独立复现，正在另一个线程修，本线程只记录、不改代码。

**怎么验**：`node --input-type=module` 起一个 `PrivacySession`，对同一手机号分别插 5 种字符各调一次 `protect()`，看 `entities.length` 与返回文本里是否还含原号码。C3 的表就是这条命令的原始输出。

### D2 · `P1 · electron/main.cjs:296 · IPC 错误串只遮 sk- 前缀，其余凭据形状原样回到渲染层`

**现象**：`handle()` 的 catch 里只有 `message.replace(/sk-[A-Za-z0-9_-]{12,}/g,'[已隐藏凭据]')`，然后 `slice(0,600)` 抛给渲染层。而脱敏引擎自己的 `SECRET` 规则（`src/privacy-core.js:6`–`13`）覆盖 `ghp_`、`AKIA`、`AIza`、`Bearer`、JWT、`-----BEGIN … PRIVATE KEY-----` 等十余种形状。也就是说，**模型路径遮得住的，IPC 错误路径遮不住**。

**为什么是问题**：任何 handler 把上游/文件系统错误原文抛出来时，只要里面带了非 `sk-` 形状的凭据（GitHub token、AWS key、JWT、私钥片段），它就会进 toast、进 `exportDiagnostics` 的诊断包、进用户截图。`src/error-copy.js` 只是把文案映射成人话，不做二次遮罩。

**怎么验**：读 `electron/main.cjs:296` 那一行正则；或让任一 handler 抛一个含 `ghp_…` 的错误，看渲染层 toast 是否原样显示。

### D3 · `P1 · harness/native-project-fs.mjs:221 · 377 行文件写入围栏零直接单测`

**现象**：`grep -l native-project-fs tests/*.test.mjs` 无命中。这个模块管的是模型写文件的唯一原生入口——`NativeProjectFileSystem.resolve`（`:221` 的 `super.resolve` 覆写、`:248` `checkReadTarget`、`:283` `writeText`、`:298` `editText`、`:360` `patchText`）、`writeText`/`applyPatch` 的路径围栏、符号链接与硬链接判定（`nlink`）、`applyPatch` 的 TOCTOU 复核。同层的 `harness/file-policy.mjs`(159) 有 `office-file-policy.test.mjs` 与 `workspace-atomic-replace.test.mjs` 两个文件覆盖，唯独这个更靠前的模块没有。

**为什么是问题**：路径围栏写错一行就是「模型能写到工作区外」，而这层没有一条用例会在改坏时报红。B4 还记了一条：`checkReadTarget` 分支当前不可达，说明这层已经有未经测试的死路径。

**怎么验**：`grep -l native-project-fs tests/*.test.mjs`（空）；再 `grep -n "nlink\|realpath" harness/native-project-fs.mjs` 对照 `harness/file-policy.mjs` 的同名判定，看两处是否一致。

### D4 · `P2 · electron/mcp-config.mjs:5 · MCP 环境变量黑名单漏 PATH / NODE_PATH / LD_PRELOAD`

**现象**：`RESERVED` 只挡 `DEEPSEEK_API_KEY`、`ZHIXING_*`、`ELECTRON_*`、`NODE_OPTIONS`，`PATH`、`NODE_PATH`、`LD_PRELOAD`、`DYLD_INSERT_LIBRARIES`、`COMSPEC` 都不在黑名单里，`stringify` 校验（`:60`）也不拦。stdio 传输的 `env` 会原样交给子进程。

**为什么是问题**：MCP 服务器配置是用户可编辑的（`src/McpSettings.jsx`），一个被诱导粘贴的配置就能通过 `PATH`/`NODE_PATH` 改变子进程解析到的模块，或通过 `LD_PRELOAD` 注入库——这正是 `NODE_OPTIONS` 被挡掉的理由，同一类风险没被同类处理。

**怎么验**：读 `electron/mcp-config.mjs:5` 的 `RESERVED`；或在 `mcp:save` 里提交一个 `env: {PATH: '…'}` 的 stdio 服务器，看 `validateMcpServers` 是否放行。

### D5 · `P2 · electron/main.cjs:819 · CSP 没有报告通道，拦截不留痕`

**现象**：`Content-Security-Policy` 只有一条指令串，没有 `report-uri`/`report-to`；`electron/` 里也没有任何 `console-message` 监听（`grep -rn "console-message" electron/` 无命中）。C5 探针证明拦截本身是有效的（`headersFired=1`、`inlineScriptRan=false`），但拦截事件只出现在当时那一次 devtools 控制台里，事后没有任何地方能查到「这次启动被 CSP 拦过」。

**为什么是问题**：CSP 是这一层唯一能挡住「注入进渲染层的脚本」的机制，而它被触发时静默无记录——线上出现一次注入尝试，`electron/app-log.mjs` 里不会有任何一行。同一处还有第二个缺口：`browser-service.mjs:13` 用 `session.fromPartition` 另起分区会话，CSP 只挂在 `defaultSession`，分区里的页面没有这条策略（这是设计使然，但值得在文档里写明「分区不受 CSP 约束」）。

**怎么验**：读 `electron/main.cjs:819` 的指令串（无 `report-uri`）；`grep -rn "console-message" electron/`（空）；C5 的两行实测输出证明拦截生效但不留痕。

### D6 · `P2 · electron/browser-policy.mjs:4 · 内置浏览器对 loopback/私网地址不设限`

**现象**：`browserUrl` 把 `localhost`、`127.0.0.1`、`[::1]` 特判成 `http://` 并放行（`:4`–`:7`），其余只做协议白名单。也就是说模型可以让内置浏览器打开 `http://127.0.0.1:<任意端口>/…`，并把页面内容读回上下文。

**为什么是问题**：本机常见服务（开发服务器、管理面板、Ollama/本地推理端口、数据库 Web UI）都没有鉴权或只有弱鉴权。一个被注入的网页只要说「请打开 http://127.0.0.1:11434/api/tags 并总结」，内容就会进模型上下文，再经脱敏闸门（而闸门本身有 D1 的绕过）外发。这不是新面，但它是「模型可被指使访问本机服务」的现成通道，且没有任何提示或确认。

**怎么验**：读 `electron/browser-policy.mjs:1`–`13`；或在真实会话里让模型打开一个本地端口，看 `browser:state` 是否直接返回页面内容。

### D7 · `P2 · src/AnswerText.jsx:20 · 复制按钮把失败吞掉`

**现象**：`pre` 的复制按钮走 `navigator.clipboard.writeText(event.currentTarget.closest('.answer-code').querySelector('pre').textContent).catch(()=>{})`——`closest` 返回 `null` 时 `querySelector` 会抛 `TypeError`，而 `.catch(()=>{})` 把 `writeText` 的失败也一起吞掉，用户点「复制代码」没有任何反馈，无论成功还是失败。

**为什么是问题**：渲染层里唯一一处「用户以为复制了、实际没复制」的静默失败；对安全审计而言它的意义是反面证据——这一层普遍有 toast，唯独这里没有，说明「静默失败」不是设计选择而是遗漏。

**怎么验**：读 `src/AnswerText.jsx:20`；或在 devtools 里把 `navigator.clipboard.writeText` 改成 reject，点复制，看是否有任何提示。

---

### 附：本层没有发现的问题（避免下一轮重复审）

- **preload 无泛化逃生口**：89 条 `invoke` 全是固定通道名，`comm -23` 双向差集为空（C4）。`handle()` 在 `electron/main.cjs:285` 统一包 `trusted()`，`will-navigate` 只认 `zhixing://app/index.html`（`:784`），`setWindowOpenHandler` 一律 `deny`（`:781`）。
- **交付文件访问是强边界**：`electron/deliverable-access.mjs` 先验 HMAC 再 `timingSafeEqual`（`:165`、`:215`），`PRIVATE` 拒绝表挡 `.ssh`/`.env`/`.pem`/`privacy-bridge.bin`，`dev/ino` 判同文件，`within()` 判路径。`harness/file-policy.mjs` 的 `resolveOfficePath` 还做了 TOCTOU 复核（`directorySnapshot` + `sameFile`）。
- **内置浏览器 URL 策略**：`browserUrl` 拒绝含凭据的 URL，只放行 http/https（D6 只针对 loopback 放行这一点）。
- **MCP 身份与凭据继承**：`mcpServerIdentity` 用 protocol/host/port/path 的哈希做身份，换地址就要求重填凭据（`updateMcpServers` 的 `credentialReentryRequired`），`publicMcpServers` 只回 `envKeys`/`headerKeys` 不回值。
- **CSP 在默认会话上是生效的**（C5 实测），不是空转。
- **`PrivacySession` 的跨任务隔离是有效的**：`protect()` 只保留本任务签发的占位符，伪造的 `⟦ZX-…⟧` 不会被当成受保护值（`privacy.test.mjs` 的「伪造占位符不能隐藏凭证和手机号」一条）。

---

## 未核对

以下都是「读到了疑点、但没验到底」的，按可疑度排序：

1. **`harness/native-project-fs.mjs` 是否被内核端到端用例间接覆盖**。没有直接单测（D3），但 `kernel-native.test.mjs` 可能经内核路径打到它；没跑过一条针对它的断言。
2. **D1 的字符面是否穷尽**。只验了 U+3164 / U+115F / U+FFA0 / U+FE0F / U+E0100 五种。U+2064、U+180B–180D、U+E0020–E007F（标签字符）、U+FFF9–FFFB 这些 Cf/Co 类是否也能穿过，没逐一试。
3. **`electron/browser-service.mjs` 分区会话的权限策略**。只确认 `setPermissionRequestHandler`/`setPermissionCheckHandler` 挂在 `defaultSession`（`main.cjs:818`–`819`），分区里的 `WebContentsView` 是否继承、是否单独设过，没追。
4. **`electron/privacy-gateway.mjs`(146) 的长流与并发**。只有 `privacy-gateway.test.mjs` 3 例 + `assistant-stream` 覆盖，SSE 分块边界在真实长流下的还原一致性没验。
5. **`harness/office-tools.mjs` 的三处 `restore` + `blocked` 检查**（`:97`/`:113`/`:152`）是否覆盖所有工具返回路径。只读了这三处，没逐条追调用方。
6. **`electron/deliverable-access.mjs` 的 HMAC 密钥来源与轮换**。`readVault`/`readBridge` 的密钥从哪来、什么时候轮换，没追到生成点。
7. **`electron/mcp-config.mjs` 的 `mcpServerIdentity` 对 stdio 的 `cwd` 兜底**。`process.cwd()` 在主进程工作目录变化时会漂移，是否会导致同一服务器被判定成「新地址」而要求重填凭据，没验。
8. **`src/App.jsx`(1843)**。按分工排除，未审；渲染层的状态机与它如何调用 `protect()` 只看了调用点（`:1040`）。
9. **`src/McpSettings.jsx`(42)**。无任何单测，也没逐行读——它是 MCP 凭据输入的界面，是否会把凭据回显到 DOM/日志，没验。
