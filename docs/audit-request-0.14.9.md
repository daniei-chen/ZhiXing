# 知行 0.14.9 外部审计说明

本版把「一次交办的多个子任务」合成一份归档。新增 `archiveAllMarkdown`（`src/subagent-archive.js`）与执行面板标题行的「全部归档」（`src/ExecutionPanel.jsx`）。 [Windows 验收](windows-acceptance-0.14.9.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.14.8-to-v0.14.9.patch` 核对差异。
2. 读 `archiveAllMarkdown`：确认标题降级（`##` 子会话 / `###` 子消息）、跳过无对话子任务、全空时报错。
3. 重跑实包验收：`npm run test:archive -- "<repo>\release\win-unpacked\知行.exe"`，应为 5 项通过。
4. **重点质疑**：`npm run test:subagent` 本轮是**失败**的。它试图用本地假模型服务跑一次真实子任务再归档，结果是子任务确实启动了（工具返回 `started subagent qa-sales`，profile 里生成子会话历史），但子会话没有向配置的供应商发出任何模型请求，等待 30 秒仍为 0。仓库里保留了脚本与失败证据（`.preview/qa-0.14.9/real-subagent-archive/`），没有把它写进发布门禁，也没有据此宣称「真实子任务归档已验收」。
5. 归档实包验收仍是脚本注入的合成子会话记录；不要读成真实模型子任务产出。
6. 已知限制：归档只含对话文本；文本是界面显示（已脱敏、可能截断）的版本；只覆盖当前选中交办；安装器未签名；`historical-upgrade` 仍为 `not_run`；真实云端未覆盖。
7. 依赖未变：1,178／1,162，0 high、0 critical、32 moderate；本版没有引入新依赖。
