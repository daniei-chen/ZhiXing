# 知行 0.22.1 外部审计说明

0.22.0 声称挂载了 `image-offload`，实际因为 `disabled` 清单里同 id 的禁用优先，插件从未启用。0.22.1 移除该禁用项，并用一条读**落盘补丁**的用例把结论钉死。（[迭代说明](iteration-0.22.1.md) · [Windows 验收](windows-acceptance-0.22.1.md)）

1. 打开 `electron/runtime.mjs` 的 `disabled` 清单，确认里面**没有** `image-offload`；再看同一函数的 `insert` 里有一行 `{id:'image-offload',name:baseRequire.resolve('@deepseek-ai/dsh-compaction-image-offload')}`。
2. 复跑 `node --test tests/runtime-patch.test.mjs`：它会真的调 `prepareRuntime` 写一份补丁，断言 `compaction-basic.config.headroomTokens === 65536`，且 `image-offload` 没有 `disabled:true`、挂载项恰好 1 条。
3. 复跑 `npm test`、`npm run test:packed`、`npm run test:components`、`npm run test:sites`，以及实包 `npm run test:chat`。
4. **重点质疑 1**：本轮**没有**触发真实图像卸载。插件启用 ≠ 验证过它工作；要验需要有图片路由且被判超预算。
5. **重点质疑 2**：真实压缩事件仍未构造；阈值是公式与单测算出来的。
6. **重点质疑 3**：0.22.0 的发布说明与验收页曾写「已挂载」，已在 v0.22.0 release 说明里更正；审计时请以 0.22.1 的补丁内容为准。
7. 安装生命周期仍未重跑（0.19.0 的 53 步）；`ENOTFOUND` 文案仍未端到端触发；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；安装器未签名；依赖无新增（1,178／1,162，0 high、0 critical、32 moderate）。
