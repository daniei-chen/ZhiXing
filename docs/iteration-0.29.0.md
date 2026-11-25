# 知行 0.29.0 · 交付文件动作（打开／定位）

## 解决什么问题

交付卡片点开只能在知行里预览截图式内容，**拿不到文件本身**：想用 Word 打开它、想在资源管理器里找到它，都没有入口。桌面版每张交付卡片都带「在默认应用中打开」与「在文件管理器中显示」两个动作。

## 对标口径

桌面版（`dsh-client-ui-deliverables`）：`PresentedAction = 'open' | 'reveal'`；两个动作通过 `deliverables.file.actions` 槽位贡献给卡片，由卡片的上下文菜单触发；服务端是 `POST /api/present.open`，**只接受本轮声明过、按会话事件坐标核验过的文件**；返回 `opened`／`revealed`／`failed(openError|revealError)`／`skipped`；卡片状态有 `opening`／`revealing`／`error`／`revealError`／`nativeUnavailable`；文件管理器名称由 Host 提供（`finder`／`explorer`／`directory`），不由浏览器猜。

知行这一版：卡片右上角的「文件操作」按钮打开三项菜单（预览／在默认应用中打开／在文件管理器中显示），主进程 `deliverables:action` 先走 `DeliverableAccess.locate` 核验签名与文件身份，再 `shell.openPath` 或 `shell.showItemInFolder`。

## 怎么改

- `electron/deliverable-access.mjs`：新增 `verify`（解析 `zx-delivery-v1` 引用、HMAC 校验、文件身份校验）与 `locate`（供打开／定位用，返回已核验路径）。
- `electron/main.cjs`：`deliverables:action`——动作只收 `open`／`reveal`，未知动作 `DELIVERABLE_ACTION`；`shell.openPath` 返回的非空错误串进 `DELIVERABLE_OPEN`。
- `electron/preload.cjs`：`deliverableAction`。
- `src/file-actions.js`（新，4 个单测）：动作清单与进行中／成功／失败文案。
- `src/DeliveryCards.jsx`：每张卡片加「文件操作」按钮（`⋯`）与菜单；Escape、点击外部关闭；动作进行中把副标题换成「正在打开…／正在定位…」。
- `src/App.jsx`：`deliverableAction` 先 `listDeliverables` 找到该路径的已核验引用，再调 IPC；成功／失败都走 toast。
- `src/styles.css`：`.deliverable-slot`／`.deliverable-actions`／`.file-action-menu`。
- `scripts/test-deliverable-actions-ui.mjs` ＋ `npm run test:actions` 进发布门禁。

## 结果

- 源码层：`npm test` 480 项（479 通过 / 1 跳过 / 0 失败）；`test:components` 14/14；`test:sites` 4/4。
- Windows 实包层：`npm run test:actions` **7/7**——真实 `present` 交付两份文件；每张卡片都有动作入口；菜单三项与桌面版文案一致；Escape 关闭；点「在文件管理器中显示」后出现「已在文件管理器中显示。」；删掉文件后同一动作给「找不到这个文件的位置…」；伪造 `zx-delivery-v1` 引用被拒绝（本轮实测返回「交付文件不属于当前会话或项目。」）。
- `test:packed`、原生文件导出、包内源码核对、依赖审计、启动探测均通过（数字见 `acceptance-summary-0.29.0.json`）。

## 边界

- **「在默认应用中打开」的成功路径没有在自动验收里点击**：真点会拉起系统默认应用，属于用户态操作。自动验收只核对了该项存在且可点，属「未覆盖」。
- 没有实现桌面版的 `skipped`（同一文件重复请求合并）与 `nativeUnavailable`（无桌面会话）两种状态；知行对应场景直接给错误提示。
- 文件管理器没有做 Host 侧区分（Windows 只有 explorer），不显示别的平台名字。
- 动作入口是「⋯」菜单，不是桌面版的右键上下文菜单。
- 只覆盖「本轮 `present` 声明过」的文件；改动文件卡片（`write`／`edit`）的行还没有接这两个动作。
- 实包证据来自本地假服务 + 真实内核，**未在真实云端会话上跑**。
