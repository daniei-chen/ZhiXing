# 知行 0.13.4 · 补齐拒绝堆栈

小版本，一处修复，但把「可诊断性」这件事收了个尾。

## 修了什么

`unhandledRejection` 的日志只记了 `message`，没记 `stack`。相比之下 `uncaughtException` 一直都记堆栈。用注入测试复现出来是这样：

```
error unhandledRejection {"message":"zhixing-rejection-probe"}
```

修完：

```
error unhandledRejection {"message":"zhixing-rejection-probe","stack":"Error: zhixing-rejection-probe
  at <anonymous>:1:16
  at Object.internalModuleStat (…)"}
```

一个没有调用栈的拒绝，在排查时基本等于只说「出错了」。堆栈按截断到 2000 字符，和其他记录点一致。

## 四个崩溃记录点现在都有真实证据

这是从 `0.13.2` 开始陆续补的，这一版收尾：

| 记录点 | 验证方式 | 状态 |
| --- | --- | --- |
| `uncaughtException` | Node inspector 注入真实未捕获异常 | 已记录 message＋stack，进程按设计继续运行 |
| `unhandledRejection` | inspector 注入未捕获的 Promise 拒绝 | 本版补上 stack，进程继续运行 |
| `render-process-gone` | CDP 导航到 `chrome://crash/` 制造真实渲染崩溃 | 记录 `reason: crashed`、`exitCode` |
| `child-process-gone` | 强杀进程树（`taskkill /T /F`） | 记录 `type: Utility`、`reason: killed` |

四个都不是「注册了监听器」的声明，而是实际触发并确认落盘的。

## 结果

源码 363/364（1 项条件跳过），目录包 322/323（0 失败、0 取消），Windows 桌面专项 5/5。生产源码指纹从 `ebfae935…` 变为 `0d1c3365…`，是本版唯一的运行逻辑改动。启动 10 次中位数：`initialise` 910 ms、窗口显示 1,031 ms、可交互 1,217 ms。

## 边界

日志仍是事件级：没有用户操作轨迹、没有远程上报、没有 crashReporter 与 minidump。四个记录点验证的是「事件会落盘」，不是「崩溃现场一定能完整重建」——进程被强杀时没有机会写日志，这种情况表现为什么都没有，属预期。

未决项不变：证书未申请、真实云端未接入、`quitAndInstall` 串联路径未测。 [Windows 验收](windows-acceptance-0.13.4.md) · [能力地图](harness-capability-map.md)
