# 知行 0.13.8 · 清掉 uuid 8.x

把一条停更的依赖换掉，顺带把审计数字从 34 降到 32。

## 为什么

`npm audit` 建议的修法是 `npm audit fix --force`，那会把 `exceljs` 降级到 `3.4.0`——一个 breaking change，为了消一条不可达的通告而砸掉 Office 导出，不划算。

实际情况是：`exceljs@4.4.0` 依赖 `uuid@8.3.2`，而 `uuid@8` 已经**停止维护**，8.3.2 就是 8.x 的最后一版，没有修复版本可升。`uuid` 自己的 deprecated 提示写着：

> uuid@10 and below is no longer supported. For ESM codebases, update to uuid@latest. For CommonJS codebases, use uuid@11

## 改了什么

在 `package.json` 的 `overrides` 里加一条 `"uuid": "^11.1.1"`，强制整个依赖树用 11.1.1。

安全性上站得住：`exceljs` 只 `require('uuid')` 取 `v4`，而 `uuid@11` 保留 `v4` 的 CJS 导出。那条通告（`GHSA-w5hq-g745-h8pq`）针对的是 `v3/v5/v6` 传入 `buf` 时的越界，`exceljs` 根本不调用这几个函数。

验证：`exceljs` 建工作簿并写出 xlsx 得到 6389 字节，正常。

## 结果

生产依赖审计从 **34 moderate 降到 32**，unique 通告从 **3 条降到 2 条**。剩下两条是随包 npm CLI 内部的 `glob`／`minimatch`，只在插件安装时用。

源码回归 364 项、363 通过、0 失败、1 条件跳过；目录包回归 322/323、0 失败、0 取消；Windows 桌面专项 5/5。

## 顺带补了上一版欠的验证

`0.13.7` 换了 Electron 运行时，当时没复跑自动更新。这轮补上：用打包的 `0.13.6` 做起点跑完整链路——检测到 `0.13.7`、下载 286 秒、静默安装、**应用在安装完成后被安装器拉起**（`18:26:23`，4 个进程，路径在测试目录下）。Electron 升级没有破坏自动更新。

## 边界

**验证脚本自身仍有缺陷**：它靠进程存在与否判断「是否重启」，而在 Windows 下把中文进程名经 `execFileSync` 传给 PowerShell 会编码错乱，匹配不到；改用安装路径匹配后，手动跑能得到 4，但脚本循环里依然报失败。**结论以进程实测为准，脚本输出不作数**。这条已记在能力地图里。

安装生命周期细节、跨版本存档兼容的证据来自更早版本，本版未复跑。签名仍未验证（无证书）；真实云端、交互式安装、跨账户未覆盖。

[Windows 验收](windows-acceptance-0.13.8.md) · [能力地图](harness-capability-map.md)
