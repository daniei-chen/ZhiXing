# 知行 0.13.7 · Electron 安全升级

修掉一条一直没被看到的 high，并补上让它消失的盲区。

## 发现

`npm audit --omit=dev` 报 0 high、34 moderate，这个数字在之前几个版本里一直没变，我按「不可达路径」维持着。这次把它摊开看，实际只有 **3 条 unique 通告**，34 是路径展开的数量：

| 通告 | 包 | 来源 |
| --- | --- | --- |
| GHSA-3g3m-2fjr-6pw4 | `glob` 13.0.6 | npm CLI 内部 |
| GHSA-g3hv-75wg-m249 | `minimatch` 10.2.5 | npm CLI 内部 |
| GHSA-w5hq-g745-h8pq | `uuid` 8.3.2 | `exceljs` |

三条都在不可达路径上：前两条属于随包的 npm CLI，只在插件安装时用；`uuid` 那条需要调用 `v3/v5/v6` 并传入 `buf`，而 `exceljs` 只用 `v4()`。

**但顺手跑了一次完整的 `npm audit`（不加 `--omit=dev`），发现了第 4 条：**

```
electron  44.0.0-alpha.1 - 44.9.0
Severity: high
Electron: Mitigation for compromised eMudhra intermediate certificates
GHSA-jr5w-w6x2-84p9
```

产品用的正是 `44.7.0`，落在受影响区间内。这条影响的是 TLS 证书校验，而应用会发起 HTTPS 请求（模型服务、更新检查），不是装饰性的。

**它为什么一直没出现**：Electron 在 `package.json` 里是 `devDependencies`，但打包后它就是**应用运行时本身**。审计脚本按 `expected.dev` 过滤，正好把它滤掉了。`--omit=dev` 同理。

## 改了什么

**升级 `electron` 44.7.0 → 44.11.5**，修复版本。

**审计脚本补上盲区**：`production-inventory.json` 现在带 `runtime.electron` 字段，并写明「Electron 以 devDependency 形式声明但作为运行时发布，其通告要用 `npm audit`（不带 `--omit=dev`）或 Electron 安全页面单独核对」。

## 结果

升级后重跑 `npm audit`：**39 moderate，0 high**。生产审计仍是 34 moderate、0 high、0 critical——那 34 条就是上面三条不可达通告的路径展开。

源码回归 364 项、363 通过、0 失败、1 条件跳过；目录包回归 322/323、0 失败、0 取消；Windows 桌面专项 5/5。启动 10 次中位数：`initialise` 925 ms、窗口显示 1,048 ms、可交互 1,227 ms——与升级前（939 / 1,047 / 1,234）基本持平，没有回退。

`知行.exe` 从 246,317,568 变为 246,511,104 bytes，符合跨 4 个小版本的变化。

## 边界

Electron 跨了 4 个小版本，本轮的回归覆盖源码、目录包和 Windows 桌面专项，但**安装生命周期、覆盖升级、自动更新实跑没有在本版复跑**。自动更新链路在上一个版本刚验证通过，本版只换了运行时，理论上不受影响，但没有实测就不算证据。

签名仍未验证（无证书）；真实云端、交互式安装、跨账户未覆盖。

[Windows 验收](windows-acceptance-0.13.7.md) · [能力地图](harness-capability-map.md)
