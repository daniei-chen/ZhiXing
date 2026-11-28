# docs/audit —— 2026-11-28 审计的中间产物

本目录保存四份分层审计报告，与 Captain handoff 上的原件**逐字节一致**（`md5sum` 相同，未编辑）：

- `01-runtime.md` —— 运行时内核与交办状态机（B/C/D）
- `02-security.md` —— 渲染层与安全边界（B/C/D）
- `03-build-release.md` —— 构建、打包、发布与落盘（C/D）
- `04-upstream-peers.md` —— 上游关系与同行对照（E/F）

主文档 [`../AUDIT-2026-11-28.md`](../AUDIT-2026-11-28.md) 的 §B 由 01/02/03 的 B 节合并，§D 由四份的 D 节合并去重，§E/§F 取自 04。本目录沿用原始编号（`NN·Dn`、`NN·P1-n`），主文档用 `Dnn` 重排，两者在 §D 每条末尾的括号里对应。

这四份是按原样归档的证据，不是维护中的文档，因此与 `docs/evidence/` 一样登记在 `.quality-scope.json` 的 `generatedDirectories` 里，不参与 Prettier/ESLint 门禁——改格式就等于改证据。
