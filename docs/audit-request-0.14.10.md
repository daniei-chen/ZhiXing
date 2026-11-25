# 知行 0.14.10 外部审计说明

本版改归档文件的命名与写入方式。新增 `electron/archive-name.mjs`（`archiveFileName`／`numberedName`），主进程 `subagent:archive` 改为独占创建并在重名时退让。 [Windows 验收](windows-acceptance-0.14.10.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.14.9-to-v0.14.10.patch` 核对差异。
2. 读 `electron/archive-name.mjs`：非法字符替换、60 字截断、非法日期兜底、`-2` 序号不退改扩展名。
3. 读 `subagent:archive`：`flag:'wx'` 独占创建、`EEXIST` 后按 `-2`…`-20` 退让、20 次冲突报错、返回最终路径。
4. 重跑实包验收：`npm run test:archive -- "<repo>\release\win-unpacked\知行.exe"`，应为 6 项通过（含预占文件名后的 `-2` 场景）。
5. **重点质疑**：`npm run test:subagent` 仍是失败的实验脚本（子会话从未发出模型请求，4 次请求都来自主会话）。归档实包验收仍是脚本注入的合成子会话记录，不要读成真实模型子任务已验收。
6. 已知限制：命名只在同一目录内退让；日期取自本机时钟；归档只含对话文本；安装器未签名；`historical-upgrade` 仍为 `not_run`；真实云端未覆盖。
7. 依赖未变：1,178／1,162，0 high、0 critical、32 moderate；本版没有引入新依赖。
