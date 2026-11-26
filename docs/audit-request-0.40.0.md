# 知行 0.40.0 审计说明

面向外部审计的检查顺序与已知限制。结论一律标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端，低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：`SHA256SUMS-release.txt` 覆盖 18 个资产，与 `acceptance-summary-0.40.0.json` 一致。
2. **确认没有产品改动**：`git diff v0.39.0 v0.40.0 -- src electron harness public` 应为空；差异只在 `package.json` 与 `docs/`。
3. **核对包内源码**：`packed-source-manifest.json` 的指纹应为 `edb7a25d…`，与 0.38.0／0.39.0 相同。
4. **重跑两条关键门禁**：`npm run test:errors`（真实 401、真实 ENOTFOUND、ECONNREFUSED、TIMEOUT）、`npm run test:overflow-recovery`（真实内核 + 假服务）。
5. **跑源码与打包层**：`npm test`、`npm run test:components`、`npm run test:sites`、`npm run test:packed`。
6. **看生命周期证据**：`.preview/qa-0.38.0/install-evidence-20261126-151544-9a68c361/report.json`（0.38.0 安装包上 50 步）。

## 本版改了什么（供复核）

- `package.json` 版本 `0.39.0 → 0.40.0`。
- 新增 `docs/iteration-0.40.0.md`、`docs/windows-acceptance-0.40.0.md`、`docs/audit-request-0.40.0.md`，更新 `docs/harness-capability-map.md` 与 `AGENTS.md`。
- 产品代码零改动；本版的意义是把逐特性门禁放回随包发布的那份二进制上验证。

## 已知限制（不要当已通过）

- 只复跑 `test:errors` 与 `test:overflow-recovery`；其余逐特性门禁仍是最后一次运行时的结论（详见验收表「未重跑」行）。
- 安装生命周期没有在 0.40.0 安装包上重跑。
- 图像卸载、真实云端、签名未覆盖；首次内容绘制仍为 `null`。
- 长会话「内核退出没在 10 秒内确认」仍未复现，触发条件不明。
