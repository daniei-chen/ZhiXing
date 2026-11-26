# 知行 0.39.0 审计说明

面向外部审计的检查顺序与已知限制。结论一律标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端，低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：`SHA256SUMS-release.txt` 覆盖 18 个资产，与 `acceptance-summary-0.39.0.json` 一致。
2. **确认这版没有产品改动**：`git diff v0.38.0 v0.39.0 -- src electron harness public` 应为空；差异只在 `package.json` 版本号与 `docs/`。
3. **读生命周期证据**：`.preview/qa-0.38.0/install-evidence-20261126-151544-9a68c361/report.json`——`status`、50 条 `steps` 的 `passed`／`observed` 分布、`coverage` 里的 `historicalUpgrade` 与两个 `outside_scope`。
4. **跑源码层**：`npm test`、`npm run test:components`、`npm run test:sites`。
5. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`。
6. **复算哈希**：安装器／blockmap／`latest.yml`／`知行.exe` 四件与 `acceptance-summary-0.39.0.json` 的 `artifacts` 一致。

## 本版改了什么（供复核）

- `package.json` 版本 `0.38.0 → 0.39.0`。
- 新增 `docs/iteration-0.39.0.md`、`docs/windows-acceptance-0.39.0.md`、`docs/audit-request-0.39.0.md`，更新 `docs/harness-capability-map.md` 与 `AGENTS.md`。
- 产品代码零改动。

## 已知限制（不要当已通过）

- 生命周期是在 **0.38.0 安装包**上跑的；`0.39.0` 安装包本身**没有重跑**。两版产品代码相同，但安装器的字节不同。
- `historicalUpgrade` 只是 `passed_same_account_fixture_only`，且只覆盖 0.14.0 → 0.38.0；没有验中间版本升级。
- 15 条 `observed` 不是断言通过；`visualAcceptance` 与 `crossWindowsUserDecryption` 仍是 `outside_scope`。
- 本版没有重跑 `test:model-switch`、`test:model-window`、`test:errors`、`test:overflow-recovery`、`test:compact-command`、`test:compaction`、`test:review`、`test:changes`、`test:actions`、`test:inline-refs`、`test:deliverables`、`test:execution-search`、`test:feedback`。
- 图像卸载、真实云端、签名未覆盖；首次内容绘制仍为 `null`。
- 长会话「内核退出没在 10 秒内确认」仍未复现，触发条件不明。
