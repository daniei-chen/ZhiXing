# 知行 0.24.0 外部审计说明

本版新增逐消息反馈，形态照 `dsh-message-feedback` + `dsh-command-feedback`：赞/踩、七个固定分类、可选备注（8192 字节），只记本机、不进模型历史、不随导出带出。（[迭代说明](iteration-0.24.0.md) · [Windows 验收](windows-acceptance-0.24.0.md)）

1. 读 `electron/message-feedback.mjs`：分类 id 与桌面版仓库文档 `dsh-command-feedback/README.zh.md` 的七个 id 逐字一致；`validateFeedback` 的失败码与桌面版同名（`note-blank`／`note-too-large`／`category-invalid`）；字节数按 UTF-8 码点自己算（**组件测试跑在 jsdom 里没有 `TextEncoder`**，第一版因此挂了 8 个渲染用例）。
2. 看 `electron/main.cjs` 的 `feedback:load`／`feedback:save`／`feedback:clear`：写 `feedback.bin`（`safeStorage` 加密），不碰工作空间，也不进模型历史。
3. 复跑 `npm run test:feedback`（实包 + 本地假 OpenAI 服务），7 个 case：按钮存在、面板 7 个分类且文案一致、保存后显示「本机反馈：赞 · 任务结果」、`feedback.bin` 字节里没有备注明文与分类 id 明文、读回备注完整、清除后 0 条且**模型请求数不变**、刷新后清空仍生效。
4. 复跑 `npm test`（446：445 通过、1 跳过、0 失败）、`npm run test:packed`、`npm run test:components`（14/14）、`npm run test:sites`（4/4），以及实包链路。
5. **重点质疑 1**：只做了逐消息反馈。桌面版的会话级 `/feedback` 命令与弹窗（同一套分类）没有实现，未核对桌面版弹窗的逐像素样子。
6. **重点质疑 2**：反馈存在知行自己的加密文件里，**不是**桌面版那种 Session 日志事件；语义等价（不进模型历史、可清除），格式与位置不同，不能声称「同一份数据」。
7. **重点质疑 3**：`api.github.com` 从 2026-11-26 00:06 起连续约 100 分钟返回 `000`（DNS 解析到本地代理的 fake-IP 段 `198.18.0.13`，而 `raw.githubusercontent.com`／`uploads.github.com` 同时正常），v0.23.0 与 v0.24.0 的 release 都因此延后。02:0x 恢复后两版都补发：远端各 18 个资产，逐文件比对 `mismatched=0`、`extras=[]`。延迟本身是事实，发布不是。
8. 安装生命周期仍未重跑（0.19.0 的 53 步）；`ENOTFOUND` 文案仍未端到端触发；安装器未签名；依赖无新增（1,178／1,162，0 high、0 critical、32 moderate）。
