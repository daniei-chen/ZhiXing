# 知行 0.28.0 · 本轮改动文件卡片

## 解决什么问题

一轮跑完，用户只能看交付卡片（`present` 声明的文件），**看不出这轮到底改了哪些文件、改了多少行**。桌面版在每轮结束时给一张改动文件卡片：列出文件与增删行数，点击进入 review。

## 对标口径

桌面版（`dsh-workspace-changes`）：在每轮**开始和结束各取一次 git 工作树快照**，对 git 覆盖不到的路径在每次文件工具编辑前后做**整文件捕获**；摘要随 `workspace/changes` 事件发到界面，字段是 `path` + 工作区相对的 `display` + `added` / `deleted`；卡片放在收尾正文之后、交付卡片之前；没有摘要时卡片不出现。

知行这一版先做**文件工具捕获**这一半：`write` / `edit` 的 `tool/result` 自带 `meta.diffs`（每个已应用 hunk 的前后文本），主进程用行级 LCS 算增删行数；创建文件时工具结果里没有 hunk，改用 `write` 调用参数里的内容计入新增；路径先按会话保险库还原，再按会话工作区折算成相对展示名，同一路径多次编辑累加。

## 怎么改

- `electron/change-summary.mjs`（新）：`lineDelta`（行级 LCS）、`diffEntries`（`meta.diffs` → 条目）、`mergeEntries`（按路径合并、保留展示名、200 个文件上限）、`changeTotals`；7 个单测。
- `electron/runtime.mjs`：记 `write` / `edit` 的调用参数；`tool/result` 到达时收集条目；输出前用与正文相同的保险库还原路径，按 `config.workspaceRoot` 折算 `display`，写进 `changes` 并随 `finalization.changes` 回到界面。
- `src/changed-files.js`（新，4 个单测）＋ `src/ChangedFiles.jsx`（新）：标题「本轮改动 N 个文件」、合计「+新增 −删除」、每行「文件名 +a −d」，缺行数写「行数未记录」，估算写「约 +N −M」；点击行打开工作面板的「文件」页。
- `src/conversation-state.js`、`src/App.jsx`：把 `changes` 落到消息上，渲染顺序是收尾正文 → 改动文件卡片 → 交付卡片。
- `src/styles.css`：`.change-files` 样式；`npm run test:changes` 进发布门禁。

## 结果

- 源码层：`npm test` 476 项（475 通过 / 1 跳过 / 0 失败）；`test:components` 14/14；`test:sites` 4/4。
- Windows 实包层：`npm run test:changes` **5/5**——真实内核在项目工作区里写三次文件（同一路径两次、另一个文件一次），卡片「本轮改动 2 个文件」「+11 −0」，两行分别 `+8 −0`、`+3 −0`，工作区文件内容确实是模型最后一次写入，点击行后工作面板视图切到 `files`。`test:packed` 354（353/1）、原生文件导出、启动中位与依赖审计均通过。

## 边界

- **没有 git 快照**：终端／PowerShell 写出的文件、外部程序改的文件不会进卡片（桌面版靠 git 快照覆盖）。
- 没有 review tab，也没有逐文件对比视图；点击只打开工作面板的文件页，不做单文件定位。
- 不产生 `meta.diffs` 的工具（例如 `office_write_file`）不统计。
- 超过 4,000 行或 64 KB 的改动只给「约 +N −M」的估算值。
- 同一路径既有创建又有编辑时，行数是各次写入的累加，不等于最终文件的真实增删（与桌面版「按快照算真实差异」不同）。
- 实包验收用本地假服务 + 真实内核，**未在真实云端会话上跑**。
