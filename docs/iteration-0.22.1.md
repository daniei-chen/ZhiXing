# 知行 0.22.1 · 更正：image-offload 在 0.22.0 里其实没启用

## 问题

0.22.0 的目标是把压缩口径对齐 Harness 桌面版，同时补挂桌面版基础层一直有的 `image-offload`。发布说明与验收页都写了「已挂载」。

发布之后去做运行时核对（读 `prepareRuntime` 真正写出的 `zhixing.patch.json`），发现那一行是：

```json
{ "id": "image-offload", "disabled": true }
```

原因：知行的 `disabled` 清单里本来就写着 `image-offload`（和 `subprocess`、`jobs` 排在一起），而 0.22.0 又加了一条同 id 的 `insert` 挂载。**同一个 id 上，禁用优先**——所以插件一次都没被启用。压缩那一半是真的（headroom 65,536 已写进补丁），但「已挂载 image-offload」这句是错的。

## 怎么改

- `electron/runtime.mjs` 的 `disabled` 清单去掉 `image-offload`，保留 `insert` 里的挂载项。
- 新增 `tests/runtime-patch.test.mjs` 两条：`prepareRuntime` 写出的补丁里 `compaction-basic.config` 必须是 `{headroomTokens:65536,maxTokens:65536,thresholdRatio:0.8,retainRatio:0.16}`；`image-offload` **不许**出现 `disabled:true`，且必须作为挂载项插进去。这条用例盯的是补丁文件本身，而不是「我加了一行 insert」这个动作。

## 结果

| 层 | 结果 |
| --- | --- |
| 源码 `npm test` | 见验收页（新增 2 条运行时补丁用例） |
| 运行时补丁核对 | `compaction-basic` = 65,536；`image-offload` 禁用行 0 条、挂载 1 条；`disabled` 清单不再含它 |
| 实包链路 | `test:chat`、`test:restore-gap`、`test:ui-status` 等复跑 |

## 边界

- **仍然没有触发过真实的图像卸载**：插件现在是启用状态，但它只在「图片路由被判定超预算」时动作，本轮没有图片超预算场景。
- 真实压缩事件仍未构造（0.22.0 的边界继续有效）。
- 这条错误值得记住：挂载一项插件不能只看「我写了 insert」，必须读**落盘后的补丁**，并确认同 id 上没有 disable。
- 安装生命周期仍未重跑；`ENOTFOUND` 文案仍未端到端触发；安装器未签名。
