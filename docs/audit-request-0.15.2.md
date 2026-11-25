# 知行 0.15.2 外部审计说明

本版没有改产品代码，补的是真实云端下的工具调用验收：文件类工具只在项目工作区里挂载，之前的真实云端脚本都跑在首页会话，所以只能证明「没有工具」。 [Windows 验收](windows-acceptance-0.15.2.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.15.1-to-v0.15.2.patch` 核对差异，本版应只有 `scripts/test-real-cloud-workspace-tools.mjs`、`package.json` 的一条脚本与文档变化，`src/`、`electron/` 不变。
2. 复跑 `npm test`（408 项）与 `npm run test:packed`（353 项）。
3. 复跑真实云端工作区验收：自备 `ZHIXING_CLOUD_BASE_URL`／`ZHIXING_CLOUD_API_KEY`／`ZHIXING_CLOUD_MODEL`，执行 `npm run test:workspace-tools -- ".\release\win-unpacked\知行.exe"`。脚本会建临时工作区、注入项目、点进项目会话、要求模型调用 `glob`，并断言时间线出现「调用 · 查找项目文件」且回答带回数量 2。
4. **重点质疑**：只覆盖列举类工具（`glob`、目录列举）。写入、覆盖、`apply_patch`、终端、MCP 都没有证据。
5. **重点质疑**：工作区文件不含敏感信息，因此**没有验证工具结果路径上的脱敏与还原**。这是目前脱敏链路唯一的空白段。
6. 工作区由 `loadWorkspace`/`saveWorkspace` 注入，不是从界面「新建项目」对话框创建；界面路径本身的历史验收属于 0.14.x。
7. 同构建上另有两套实包证据：状态行与模型选择 4/4（真实云端）、工具时间线 2/2（本地假服务 + 真实内核）。
8. 安装生命周期本版未重跑；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名；依赖未变（1,178／1,162，0 high、0 critical、32 moderate）。
