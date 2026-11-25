# 知行 0.30.0 · 改动对比视图

## 解决什么问题

0.28.0 给出「本轮改动 N 个文件」，但点一行只是跳到工作面板的文件页——**看不到改了什么**。桌面版点这一行打开的是 review tab：左边选文件，右边看这个文件在本轮开始与结束时的逐行对比。

## 对标口径

桌面版（`dsh-client-ui-deliverables`）：`changes-review` 是右侧 Sidebar 的一种 tab（地址 `dsh-resource://changes-review/session/…`，轮次号进标题），内容是「一次一个文件」的对比——文件选择器、该文件的增删行数、统一或并排两种视图、换行或滚动开关，以及打开文件本身的操作；数据来自 Host 的 `changes.summary` 与 `changes.diff`。

知行这一版：工作面板新增「改动」视图，左边文件列表（工作区相对名 + 每文件 `+a −d`），右边选中文件的统一对比行（行号列 + 内容），改动两侧各留 3 行上下文、远处相同的行折叠成 `⋯`；点改动文件卡片的一行直接进入这个视图并选中该文件。

## 怎么改

- `electron/review-diff.mjs`（新，7 个单测）：`unifiedRows` 行级 LCS + 上下文裁剪 + 行数上限（2,000 行后标 `truncated`）；`collectDiffs` 按 120 条／256 KB 上限收集；`mergeDiffs` 把同一路径的多次编辑按时间顺序拼接、段间留 `gap`。超过 64 KB 或 4,000 行的文件只给「跳过」标记，不伪造对比行。
- `electron/runtime.mjs`：`tool/result` 的 `meta.diffs` 里连 before/after 文本一起收集（创建文件时用 `write` 调用参数的内容补一条），输出前与正文走同一个保险库还原占位符、按 `config.workspaceRoot` 折算相对名，随 `changeDiffs` 回到界面。
- `src/review-view.js`（新，5 个单测）＋ `src/ReviewPanel.jsx`（新）：标题、每文件行数、四种行类型（add／remove／context／gap）、空态与「太大只给行数」的说明。
- `src/Workbench.jsx`：新增「改动」视图与面板；`src/App.jsx`：`openReview(path)`，改动文件卡片点击改为进入该视图并选中对应文件；`src/conversation-state.js` 带上 `changeDiffs`。
- `scripts/test-review-ui.mjs` ＋ `npm run test:review` 进发布门禁。

## 结果

- 源码层：`npm test` 492 项（491 通过 / 1 跳过 / 0 失败，新增 12 项）；`test:components` 14/14；`test:sites` 4/4。
- Windows 实包层：`npm run test:review` **6/6**——真实内核写四次文件（纪要.md 三次、清单.md 一次）；卡片两行；点第一行进入「改动」视图且只选中一个文件；新增行含「第七行」「改过的第三行」、删除行含「第八行」且**不**把保留下来的「第一行」「第二行」标成删除；两批改动之间出现折叠行；切到清单.md 后对比区标题与三行新增随之变化；工作区文件内容等于最后一次写入。`test:changes` 5/5（点击预期改为进入「改动」视图）。
- `test:packed`、原生文件导出、包内源码核对、依赖审计、启动探测均通过（数字见 `acceptance-summary-0.30.0.json`）。

## 边界

- **仍然没有 git 工作树快照**：终端／PowerShell 与外部程序写出的文件不进对比。对比的是「每次工具写入的前后文本」，不是「轮次开始与结束的整文件快照」——同一文件被多次写入时，看到的是一段段拼接的对比（中间有 `⋯`），而不是一次性总差异。
- 没有并排（side-by-side）视图、没有换行开关、没有 review tab 的独立地址；对比视图是工作面板里的一个视图。
- review 里的「在默认应用中打开／定位」控件**没有**接；打开与定位目前只在交付卡片上（0.29.0）。
- 超过 64 KB 或 4,000 行的文件只给行数与「太大」说明；超过 2,000 行显示上限会截断并标注。
- 伪造/异常 `meta.diffs`（空路径、前后完全相同）不会产生对比行；`office_write_file` 这类不产生 `meta.diffs` 的工具仍然不统计。
- 实包证据来自本地假服务 + 真实内核，**未在真实云端会话上跑**。
