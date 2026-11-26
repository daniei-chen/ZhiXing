# 知行 0.38.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.38.0` |
| 构建源码 | `fb4b320ae2502397525ff01639ce5bdd9eab7919`（`sourceDirty=false`） |
| 包内源码指纹 | `edb7a25d5ae471781d372c5abedb7b134b25afb9c52fa9a675d13d7c64e04390`（100 个文件） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | `ZhiXing-0.38.0-x64.exe` 338,713,467 B · `bf32a52a6589b6a6f594b6c379bc252490e6e1be62702bee6b63120f705b42fa` |
| 增量包 | `ZhiXing-0.38.0-x64.exe.blockmap` 314,891 B · `ef7c2cdd283ca40c1c706f5bcc6cc0a933478acd8f3944e8305cefe140911245` |
| 更新描述 | `latest.yml` 342 B · `2bd334ecd95ff9d9ae8c36e63250d22da947c39320f1babe4e79c87fe2ed348d` |
| 应用可执行 | `知行.exe` 246,511,104 B · `943499d8fb2d8b8ee0281a0d9af6d9cf2b871a8c1bacb48bea441d80c6cbbcd8` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 505：504 通过、1 跳过、0 失败 |
| 收尾与隔离 | `node --test tests/runtime-finalization.test.mjs` | **19/19**（新增断言：拒绝文案含「内核还没确认退出」，且不含「正在执行」「正在运行」「请先停止」） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| 切换压缩成功路径 | `npm run test:model-switch` | 本版未重跑（0.37.0 为 5/5） |
| 切换压缩失败路径 | `npm run test:model-window` | 本版未重跑（0.37.0 为 4/4） |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过（脚本退出码 0；结果文件只记状态，不声明条数） |
| 包内源码核对 | `verify-packed-sources.mjs` | 100 个文件与构建提交一致 |
| 依赖审计 | `audit-production-dependencies.mjs`（仓库／随包） | 1,178／1,162 个包，0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 调试端口 673 ms、CDP 926 ms、可交互 1,136 ms（中位）；首次内容绘制 `null` |

## 证据范围

- 本版只改「会话被待收尾状态挡住时」的拒绝文案（`electron/runtime.mjs` 的 `sessionBusyMessage`），四个入口共用；隔离行为、关闭时序、恢复文件策略**一律未改**。
- 这条文案只在「内核退出没在 10 秒内被确认」时出现。本轮写了 18 轮短对话的探针（`.preview/qa-0.38.0/exit-probe/`），跑完一次也没有触发收尾失败，因此**实包上没有造出该状态**，属于未覆盖；证据只在源码层（单测）与打包层（既有门禁）。
- 触发条件仍未查实：上一版两次出现都在第 8–9 轮，本轮 18 轮未复现，无法归因到轮数或篇幅。
- 界面横幅「内核退出尚未确认，该会话暂不能重新执行。」与「重试清理」按钮是既有实现，未做视觉核对。
- 图像卸载、真实云端、签名未覆盖；**安装生命周期没有为本版重跑**，仍是 0.24.0 的 53 步证据。
- `visualAcceptance` 与 `crossWindowsUserDecryption` 仍为 `outside_scope`。

[本轮迭代](iteration-0.38.0.md) · [审计说明](audit-request-0.38.0.md) · [机制对照](harness-parity.md)
