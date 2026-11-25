# 知行 0.15.0 外部审计说明

本版改的是用户直接反馈的两点：运行中不再显示内核阶段名（改为「思考中」或正在跑的工具），供应商页面里拉取到的模型可以直接「设为当前」。 [Windows 验收](windows-acceptance-0.15.0.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.14.14-to-v0.15.0.patch` 核对差异，重点看 `src/run-status.js`、`src/App.jsx` 的状态行、`src/ProviderSettings.jsx` 的模型列表、`src/Settings.jsx` 的传参。
2. 复跑 `npm test`（406 项，含 `tests/run-status.test.mjs` 5 项）与 `npm run test:packed`（353 项）。
3. 复跑界面验收需要自备供应商：`ZHIXING_CLOUD_BASE_URL`、`ZHIXING_CLOUD_API_KEY`、可选 `ZHIXING_CLOUD_MODEL`，然后 `npm run test:ui-status -- ".\release\win-unpacked\知行.exe"`。它会断言模型列表展开、有「设为当前」、当前项唯一、点击后工作区模型真的改变，并且运行中的状态行不含内核阶段文案。
4. **重点质疑**：状态行只区分「思考中」与「正在<工具>」，并没有把模型推理正文内联到消息下方；工具调用的参数与结果仍只在右侧执行面板，因此不能说「与 DeepSeek Harness 完全一致」。
5. **重点质疑**：没有实现「删除单个模型」。目前移除的唯一对象是整个供应商；「手动添加模型 ID」改完需重新拉取。
6. 真实云端只覆盖一个供应商、一个模型；`auto` 只验证设置落盘，没有让它回答。
7. 安装生命周期本版未重跑；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名；依赖未变（1,178／1,162，0 high、0 critical、32 moderate）。
