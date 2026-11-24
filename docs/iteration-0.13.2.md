# 知行 0.13.2 · 应用日志与诊断导出

在此之前，知行**没有任何日志文件**，也没有崩溃上报。用户报告「它坏了」时，除了让对方复述现象之外没有任何可查的东西。这一版补上最小可用的诊断基础。

## 应用日志

新增 `electron/app-log.mjs`，把事件按行追加到 `%APPDATA%\知行\zhixing\logs\app.log`：

- **只记事件与错误消息**，不记聊天内容、文件正文、密钥或 cookie。对象里形如 `key`、`token`、`secret`、`password`、`cookie`、`authorization` 的字段统一替换为 `[redacted]`，长字符串截断到 500 字符，嵌套深度不超过 4 层。
- **轮转**：单个文件超过 1 MB 后滚到 `app.log.1`、`app.log.2`，最多保留两份。
- **记录点**：应用启动（版本、是否打包、平台、架构、Electron 版本）、自动更新的每次状态变化、`uncaughtException`、`unhandledRejection`、`child-process-gone`、`render-process-gone`。

注册 `uncaughtException` 后主进程不再因未捕获异常退出——这是有意的取舍：桌面应用崩掉会让用户丢失正在做的事，留证据继续运行更划算。异常会以 `error` 级别落盘。

## 诊断导出

设置 → 关于 → 「导出诊断信息」：选择目录后生成 `zhixing-diagnostics-<时间戳>/`，内含

- `diagnostics.json`：应用版本、Electron / Node / Chrome 版本、平台与内存、启动时长、数据文件大小与项目／会话／自动化数量、当前更新状态、保存队列状态。
- `app.log`（及轮转文件）。

导出内容不含聊天正文、密钥或文件内容，可以直接发给他人。

## 实测

- 单元测试 5 项：写入与读取、密钥字段脱敏、超限轮转、导出复制、不可写目录不抛错。轮转测试暴露出一个真实缺陷——原实现把当前文件直接改名成 `.2`，导致 `.1` 永远不存在；已修正。
- 端到端（真实打包应用、临时档案、`ZHIXING_DIAGNOSTICS_DIR` 指向临时目录）：导出成功，目录内含 `app.log` 与 `diagnostics.json`，`app.start` 事件在册，版本号与平台正确，**扫描未发现形如 `sk-…` 或 `Bearer …` 的凭据**。
- 源码回归 359/360（1 项受文件符号链接权限限制跳过），目录包回归 322/323（0 失败、0 取消、1 跳过），Windows 桌面专项 5/5。

`0.13.1` 那次出现的 2 个目录包测试超时取消，本轮复跑**未复现**，判定为偶发（当时系统负载高），已记录。

## 边界

日志是事件级的，不含用户操作轨迹，也没有远程上报——出问题时仍需要用户主动导出再发出来。没有接入 crashReporter，崩溃转储（minidump）不会生成。日志本身没有加密，与 `workspace.bin` 不同：它按设计不含敏感内容，因此以明文存放。 [Windows 验收](windows-acceptance-0.13.2.md) · [能力地图](harness-capability-map.md)
