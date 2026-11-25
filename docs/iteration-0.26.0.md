# 知行 0.26.0 · 交付卡片

## 解决什么问题

模型用 `present` 交付文件后，知行的助手气泡里只是把路径堆成一行朴素按钮：没有图标、没有说明、没有文件类型，五个文件就变成一堵按钮墙，也看不出哪个是表格、哪个是 PDF。桌面版（`dsh-client-ui-deliverables`）把交付渲染成轮次末尾的卡片：文件名 + 「说明或文件类型」，双列网格，超过四个默认收起。

## 怎么改

- `src/deliverable-cards.js`（新，纯函数）：`deliverableName`（取路径末段）、`deliverableType`（按扩展名给 Word 文档／表格／演示文稿／PDF 文档／图片／纯文本／压缩包／代码或结构化文本／文件）、`deliverableCaption`（有说明用说明，否则用类型）、`splitDeliverables`（默认展示四个，其余折叠）、`deliverableMoreLabel`（「展开全部 N 个交付」／「收起」）。5 个单测。
- `src/DeliveryCards.jsx`（新）：卡片网格，`data-count` 记录交付总数，`title` 保留完整路径，超过四个给展开／收起按钮；点击仍走既有的 `openDeliverable`（主进程按交付记录校验后再取内容）。
- `src/App.jsx`：助手气泡里的交付按钮行换成 `<DeliveryCards/>`。
- `src/styles.css`：`.deliverable-files` 双列网格（单条时单列）、`.deliverable-card` 的图标与两行文本、`.deliverable-more`。

## 结果

- 源码层：`npm test` 457 项（456 通过 / 1 跳过 / 0 失败，新增 `deliverable-cards` 5 项）；`test:components` 14/14；`test:sites` 4/4。
- Windows 实包层：`npm run test:deliverables` **5/5**——假服务让模型真的调用 `present` 声明五个文件（项目工作区里预放对应文件），内核记下 5 条交付；界面默认只显示 4 张卡片（`data-count=5`）；第一张显示说明「第三季度经营汇总」，其余分别显示「表格」「PDF 文档」「纯文本」；点「展开全部 5 个交付」后 5 张全出、按钮变「收起」；收起回到 4 张。`test:packed` 354（353/1）、原生文件导出、启动采集中位 799 / 904 / 1,073 ms、依赖审计 1,178 / 1,162（0 high、0 critical）均通过。

## 边界

- **只对标了「交付卡片」这一层**。桌面版的**改动文件卡片**（按 git 记录列本轮改动的文件与行数、点击开 review tab）、**收尾正文里的行内代码引用自动变链接**、单文件「在默认应用打开／定位」控件，知行**都没有**；对标表仍是「部分」。
- 卡片点击打开的是知行的文档弹窗，不是桌面版的右侧 Sidebar 预览。
- 类型判定只看扩展名，未知扩展名统一显示「文件」；说明只取交付记录里的 `description`，不解析正文。
- 未在真实云端会话上跑这套验收；证据是本地假 OpenAI 服务 + 打包后的真实内核 + 真实 `present` 工具执行。
