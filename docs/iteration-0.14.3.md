# 知行 0.14.3 · 聊天发送失败也要说清下一步

`0.14.1` 把「供应商目录拉取失败」的错误文案做成了端到端可验证的链路，并在结尾写明了边界：**聊天发送失败的那一面没有验过**。这一版就是补那一面。

## 用户实际看到的是什么

发送失败时，正文气泡里只有一句话：

> 模型未完成本次请求。请检查服务地址、模型 ID、API Key 或额度。

这句话把四种完全不同的处境说成同一种：Key 错了、地址不对、网络断了、服务端自己出错。用户读完仍然不知道该改哪里——这正是 `0.14.1` 已经为供应商目录解决、却在发送路径上漏掉的问题。

## 改了什么

内核其实知道原因。一次失败的数据交互会在 `turn/end` 事件里留下 `reason.error`，但形状因适配器而异，本轮在实包上实测到三种：

| 适配器 | `reason.error` | 缺什么 |
| --- | --- | --- |
| Messages（`deepseek` 协议） | `{status: 401, code: 'HTTP_401', message}` | 无 |
| Chat Completions（自定义 `openai` 协议） | `{code: 'AUTH', message: '401: {"message":"Invalid API key",…}'}` | **没有 status 字段** |
| 本机隐私网关接住的上游断连 | `{status: 502, code: 'SERVER', message}` | 无 |

于是分两层：

1. **`electron/run-failure.mjs`（新）** 只做一件事——把内核给出的 HTTP 状态或它自己的失败代码写进用户句子的括号里。状态来源有三处：`error.status`、`message` 开头的三位状态码、消息里的 `HTTP nnn`。代码只带**能给出下一步**的那些（`AUTH`／`ACCOUNT_TOKEN_INVALID`／`MISSING_CREDENTIAL`／`INVALID_CREDENTIAL`／`RATE_LIMIT`／`QUOTA`／`ACCOUNT_QUOTA`／`TRANSPORT`／`TIMEOUT`／`SERVER`／`CONTEXT_WINDOW_EXCEEDED`／`UNKNOWN_MODEL`）；`CONTENT_REFUSED` 这类无法建议动作的代码保持原句，**不编造原因**。
2. **`src/error-copy.js`** 把带括号的代码映射成可行动文案，`src/conversation-state.js` 在写气泡时调用同一个 `errorText`，技术原文留在 `errorDetail` 里供执行面板排查——与 `0.14.1` 的「原始文本只进诊断日志」一致。

另外两处顺带修正：

- **网关的 502/503/504 归为「连不上服务」**：本机隐私网关连不上上游时返回 502，用户看到的应该是「无法连接到模型服务」，而不是一个 502 号码。500 不动，它是上游自己的错，不能冒充网络故障。
- **`electron-builder.yml` 补上 `src/error-copy.js`**：`conversation-state.js` 现在依赖它，而主进程会从安装目录直接加载这个文件。**这是打包测试抓到的**——`npm run test:packed` 报 `ERR_MODULE_NOT_FOUND`，否则安装出来的应用一发送就崩。

## 分层验证到哪一层

| 层 | 证据 | 结果 |
| --- | --- | --- |
| 源码 | `tests/error-copy.test.mjs` 新增 3 组断言（状态识别、代码映射、未知代码不编造） | 371 个测试，370 通过、1 跳过、0 失败 |
| 合成运行 | 同一份测试在打包后的应用里跑（`npm run test:packed`） | 323 个，322 通过、1 跳过、0 失败 |
| Windows 实包 | **新增** `scripts/test-chat-send-errors.mjs`：本地假服务让模型目录成功、对话分别返回 401 和直接断连，走真实界面发送 | 2 个场景通过；界面文案与主进程技术原文逐条配对，两条都不同 |
| Windows 实包（回归） | `scripts/test-error-copy-ui.mjs` 在同一个包上重跑 | 4 个场景通过，4 组日志配对 |
| 真实云端 | 没有可用 Key | **未覆盖** |

实包上看到的四句话：

- 401 → `API Key 无效或已过期，请在「设置 · 供应商」中更新后重试。`（技术原文 `…（HTTP 401）…`）
- 连接被断开 → `无法连接到模型服务，请检查网络、代理或服务地址后重试。`（技术原文 `…（HTTP 502）…`）

## 途中被分层验证拦下的四件事

按发现顺序：

1. **第一次实包运行**：界面仍是笼统句。原因是我最初只读 `error.status`，而 Chat Completions 路径根本没有这个字段。
2. **第二次**：主进程已经写出 `（HTTP 401）`，界面却原样显示——气泡在 `conversation-state.js` 里直接复制 `error.message`，绕过了整句映射。
3. **第三次**：断连场景显示 `（HTTP 502）`，没有任何映射命中。网关其实已经给了中文原因，但被状态码盖住了。
4. **打包测试**：`ERR_MODULE_NOT_FOUND src/error-copy.js`。包内缺文件——如果只看源码测试，这个包会带着「一发送就崩」的缺陷发出去。

四次都是「上一层过了、下一层没过」，没有一次是猜出来的。诊断日志（`run.turn-failed`）保留了内核原始 `reason`，后面排查不必再重跑一遍实包。

## 边界

- **401 与断连是本地假服务给出的真实 HTTP 行为，不是真实供应商**。没有可用 Key，真实云端回包本轮仍未覆盖。
- **`403`／`429`／证书错误／`SERVER`／`CONTEXT_WINDOW_EXCEEDED`／`UNKNOWN_MODEL` 的文案只有源码层证据**：映射表测试通过，但没有在实包上制造过这些响应。
- **聊天路径的超时文案未端到端验证**：只有映射层；超时的实包证据仍来自 `0.14.1` 的供应商目录场景，本版重跑通过。
- **502 的语义被合并**：网关连不上上游、以及上游自己返回 502，用户看到的都是「无法连接到模型服务」。这是有意的取舍，但意味着这一句不能用来区分责任方。
- **安装生命周期本轮没有复跑**：`0.14.2` 的证据仍然只对 `0.14.1` 安装包成立。本版安装器只做真实安装与启动确认。
- 冻结环境仍是一台机器、一个 Windows 账户；安装器未签名。

[Windows 验收](windows-acceptance-0.14.3.md) · [能力地图](harness-capability-map.md)
