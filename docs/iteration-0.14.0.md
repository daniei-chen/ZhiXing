# 知行 0.14.0 · 一处错误文案，全应用生效

上一版给网络错误加了友好文案，但只加在了 `App.jsx` 一处。

## 发现

`errorText` 这个函数在 `src/` 里被定义了 **5 次**：

| 文件 | 有没有友好化 |
| --- | --- |
| `App.jsx` | 有（0.13.9 加的） |
| `AutomationDialog.jsx` | 没有 |
| `HarnessPlugins.jsx` | 没有 |
| `PluginMarket.jsx` | 没有 |
| `ProviderSettings.jsx` | 没有 |

五个文件各自复制了一份「剥掉 IPC 前缀」的逻辑。上一版只在其中一份里加了映射，于是**供应商设置、定时任务、插件市场、Harness 插件这四处的错误仍然是原始技术文本**——而这恰恰是最容易出网络问题的地方：配置供应商时填错 Key 拿到 401，就在 `ProviderSettings.jsx` 里显示成 `Error: Request failed with status code 401`。

## 改了什么

新增 `src/error-copy.js`，导出 `friendlyError` 和 `errorText`。五个文件删掉各自的定义，改为统一 import。

顺带把 `errorText` 的入参做了防御：`String(error?.message ?? error)`，非 Error 对象（字符串、undefined）不会再抛 `Cannot read properties of undefined`。

## 结果

源码回归 364 项、363 通过、0 失败、1 条件跳过；组件回归 14/14；站点 4/4；目录包回归 322/323、0 失败、0 取消；Windows 桌面专项 5/5。

启动 10 次中位数 836 / 932 / 1,102 ms（上一版 815 / 906 / 1,072，同一水平）。

依赖审计不变：1,162 个包，0 high、0 critical、32 moderate、2 条 unique 通告。

## 边界

**文案映射仍未在真实网络故障下实测**。上一版是这样，这一版仍然是这样——本轮的验证是「重构没有破坏既有行为」加「覆盖范围扩大到全部五个界面」，但没有构造真实的 401、DNS 失败或超时去看界面到底显示什么。

这一条欠了两版了。下一轮优先补：用假 Key 触发真实 401，在供应商设置页确认显示的是「API Key 无效或已过期」而不是裸的错误串。

签名仍未验证（无证书）；真实云端未覆盖。

[Windows 验收](windows-acceptance-0.14.0.md) · [能力地图](harness-capability-map.md)
