# 知行 0.23.0 外部审计说明

本版不改运行时代码，交付的是**压缩事件的可复现证据**：0.22.0 把阈值对齐桌面版（headroom 65,536 → 128k 窗口阈值 54,272），但从未观察过压缩真的发生。0.23.0 用 `npm run test:compaction` 在 Windows 实包上把它跑出来。（[迭代说明](iteration-0.23.0.md) · [Windows 验收](windows-acceptance-0.23.0.md)）

1. 看测试本身：`scripts/test-compaction-ui.mjs`。判据字符串来自 `dsh-compaction-basic/lib/index.js` 的 `COMPACTION_INSTRUCTION`（摘要请求最后一条 user 消息以 `You are now acting as a compaction engine` 开头）与 `CHECKPOINT_PREAMBLE`（压缩后请求含 `This is an automatically generated checkpoint`）。断言排在 `record()` 之前——第一版把它们写反了，16 轮没触发压缩却报 PASS。
2. 复跑 `npm run test:compaction`，看 `.preview/qa-<版本>/compaction-ui/run-*/result.json` 里的 `requests`：应看到请求字符数从 28,274 递增到 216,056，第 8 条是摘要请求（`isSummary:true`），第 9 条 `hasCheckpoint:true` 且字符数降到 122,222、消息 17→10。
3. 复跑 `npm test`、`npm run test:packed`、`npm run test:components`、`npm run test:sites` 与实包链路（`test:chat`、`test:restore-gap`、`test:tools-ui`、真实云端三项）。
4. **重点质疑 1**：只验「压缩会发生、请求会变小、界面不报错」，**没有评估摘要质量**。真实云端下摘要是否保住关键信息，未验。
5. **重点质疑 2**：压缩在**本地假服务**上触发，不是真实供应商；真实云端长会话未跑。
6. **重点质疑 3**：界面不显示压缩提示，是本版的对标结论（桌面版轨迹与会话前端都搜不到 `compacted`／`checkpoint` 渲染），不是遗漏；如果审计方认为桌面版其实有提示，请指出具体包与文件，这条结论要改。
7. **重点质疑 4**：`image-offload` 的真实卸载仍未观察；小窗口 headroom 收缩分支仍只有单测。
8. 安装生命周期仍未重跑（0.19.0 的 53 步）；`ENOTFOUND` 文案仍未端到端触发；安装器未签名；依赖无新增（1,178／1,162，0 high、0 critical、32 moderate）。
