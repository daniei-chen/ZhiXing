# 知行 0.16.0 外部审计说明

本版两件事：供应商模型列表可以移除单个模型（`hiddenModels`，含「恢复全部」）；补上工具结果路径的脱敏证据。 [Windows 验收](windows-acceptance-0.16.0.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.15.2-to-v0.16.0.patch` 核对差异，重点看 `electron/providers.mjs` 的 `setModelHidden` 与两处过滤、`electron/main.cjs` 的 `providers:hidden-model`、`src/ProviderSettings.jsx` 的移除/恢复逻辑、`tests/providers-hidden-model.test.mjs`。
2. 复跑 `npm test`（412 项）与 `npm run test:packed`（353 项）。
3. 复跑真实云端两套（自备 `ZHIXING_CLOUD_BASE_URL`／`ZHIXING_CLOUD_API_KEY`／`ZHIXING_CLOUD_MODEL`）：
   - `npm run test:ui-status -- ".\release\win-unpacked\知行.exe"`：47 行模型、移除一行、「已隐藏 1 个模型」、恢复回 47 行、状态行只出现「思考中」。
   - `npm run test:tool-redaction -- ".\release\win-unpacked\知行.exe"`：工作区文件含假手机号与假邮箱，模型用文件工具读出后界面还原原文，模型自述只看到占位符，应用日志不含号码与 Key。
4. **重点质疑 1**：模型如果**原样复述**占位符，回答会整段变成「输出包含无法归属本任务的占位符，已停止还原」。这是防跨任务误还原的保护，代价是牺牲整段回答；本版没有改这个降级策略，测试也刻意绕开了它。审计时请把它当作已知限制，而不是脱敏失败。
5. **重点质疑 2**：隐藏模型只是展示与路由过滤，不删除供应商记录；重新拉取不会把隐藏项带回来，唯一恢复入口是「恢复全部」。
6. **重点质疑 3**：工具结果脱敏只验了手机号与邮箱；其他类别与二进制/图片未覆盖。工作区由脚本注入，不是界面「新建项目」路径。
7. 构建源码是 `b93b38d`，之后只提交了测试脚本的用例顺序调整；`src/`、`electron/` 与包内一致（`verify-packed-sources` 96 个文件指纹 `b05898d6…`）。
8. 安装生命周期本版未重跑；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名；依赖未变（1,178／1,162，0 high、0 critical、32 moderate）。
