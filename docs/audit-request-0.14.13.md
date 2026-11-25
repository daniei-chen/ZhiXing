# 知行 0.14.13 外部审计说明

本版有两件事：修掉安装残留清不干净的问题（产品代码改动），以及第一次用**真实云端**验证问答链路（验收改动）。 [Windows 验收](windows-acceptance-0.14.13.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.14.12-to-v0.14.13.patch` 核对差异，重点看 `electron/temp-hygiene.mjs`、`electron/main.cjs` 的启动清理、`tests/temp-hygiene.test.mjs` 与 `scripts/test-temp-hygiene.mjs`。
2. 复跑实包清理验收：`npm run test:temp -- ".\release\win-unpacked\知行.exe"`，三个场景都应通过；注意第二个场景要求「只有别家目录时不写 `temp.hygiene` 事件」，这是有意的（避免把别人的安装当成我们的问题）。
3. 复跑真实云端验收需要你自己提供供应商：`ZHIXING_CLOUD_BASE_URL`、`ZHIXING_CLOUD_API_KEY`、可选 `ZHIXING_CLOUD_MODEL`，然后 `node scripts/test-real-cloud-chat.mjs "release\win-unpacked\知行.exe"`。脚本会断言日志里既不出现 Key 也不出现完整地址；证据只写入耗时与正文摘录。
4. **重点质疑**：真实云端只跑通一次单轮问答（一个供应商、一个模型、一条消息），不能据此说「所有供应商／多轮／工具调用／图片输入都可用」；限流、超时、流式中断都没测。
5. **重点质疑**：清理只认 NSIS 的两种目录名和「知行／zhixing」字节标记；删除失败只记录不重试；别家应用的同类目录必须原样保留（本机 11 个候选里 6 个不是我们的）。
6. 安装生命周期本版未重跑（0.14.12 刚在 `0.14.0` 基线上跑过 53 步）；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`。
7. 真实子任务归档仍未通过（子会话从未发出模型请求），归档验收仍是合成子会话记录；安装器未签名；依赖未变（1,178／1,162，0 high、0 critical、32 moderate）。
