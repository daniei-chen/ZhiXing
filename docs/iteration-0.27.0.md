# 知行 0.27.0 · 行内文件引用

## 解决什么问题

模型在结尾写「主文件是 `季度汇总.docx`」时，知行把它渲染成一段死的行内代码：用户得自己往下翻交付卡片、再对照文件名。桌面版（`dsh-client-ui-deliverables` 的「行内代码链接」）会把这类 token 解析成本轮产出或已交付的文件，变成可点的链接，完整路径进 `title`。

## 怎么改

- `src/inline-references.js`（新，纯函数）：`baseName`、`looksLikePath`、`resolveReference`、`referenceResolver`、`referenceTitle`。规则照桌面版：按**精确目标路径**或**唯一 basename** 解析，所有匹配事实必须指向同一文件；重名 basename 保持不可点击；不做后缀或当前目录猜测。7 个单测。
- `src/AnswerText.jsx`：`code` 渲染分支改用独立 `Code` 组件；命中时渲染 `code.inline-file-ref`（`role="link"`、`tabIndex=0`、`title` 为完整路径、Enter／空格可触发），点击仍走 `openDeliverable`（主进程校验交付记录）。围栏代码块用 `BlockCode` context 与行内代码分开，代码块里的单行内容不会变成链接。
- `src/App.jsx`：助手正文把该消息自己的 `deliverables` 作为候选集传给 `AnswerText`。
- `src/styles.css`：`.inline-file-ref` 的下划线、悬停底色与键盘焦点样式。

## 结果

- 源码层：`npm test` 464 项（463 通过 / 1 跳过 / 0 失败，新增 `inline-references` 7 项）；`test:components` 14/14；`test:sites` 4/4。
- Windows 实包层：`npm run test:inline-refs` **5/5**——四个文件经真实 `present` 交付（其中两个同名 `明细.xlsx`），收尾正文点名后**正好两个**可点击引用（`季度汇总.docx`、`说明.pdf`），`title` 是完整路径且带 `role="link"`；重名 basename 与未交付的 `不存在.docx` 保持普通代码；代码块里不出现引用。`test:packed` 354（353/1）、原生文件导出、启动中位 807 / 909 / 1,080 ms、依赖审计 1,178 / 1,162（0 high、0 critical）均通过。

## 边界

- 候选集**只有** `present` 交付的文件：知行没有改动文件卡片，也没有 review tab，所以 git 改动与普通文件写入不会变成链接。
- 桌面版还支持「该目标记录的精确参数」这一路匹配；知行不保存工具参数原文，未实现。
- **绝对路径在正文里会被脱敏链路替换成 `【敏感值待核实】`**（实测：把完整路径写进回答，渲染出来是占位符），所以打包验收只覆盖「唯一 basename」这一路；「精确路径」只在单测里覆盖，未在实包上端到端验证。
- 行内引用点击打开的是文档弹窗，不是桌面版的右侧 Sidebar 预览；歧义时整条不链接，没有交互式消歧。
- 未在真实云端会话上跑这套验收。
