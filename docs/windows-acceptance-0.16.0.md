# 知行 0.16.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.16.0` |
| 构建源码 | `b93b38d3c451a1a55cb2fe13f274a45b1f5aadab`（构建时 `sourceDirty=false`；之后只提交了测试脚本调整，`src/`、`electron/` 未再变化） |
| 包内源码 | 96 个文件，指纹 `b05898d60ff10a1f3f24f03d63f4c9e49b91d4e38404c68b36fa27081da17f86` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,696,034 bytes，SHA-256 `8443430b4d2e2df260b515e6350a9a36b66c12102ef975bad9dec1b9356e2b3b` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `f81c2912d509030872389ccfbbcb2a9ebb97d4954cc609de5dba28254ce15737` |
| blockmap | 314,859 bytes，SHA-256 `d2ba191dd53f4828722fdde45f78adb1af8ae09a262f5c6dc2b88136ff944912` |
| `latest.yml` | 342 bytes，SHA-256 `05549332e1c1ecced0a8b89f11384af22a403f57fe54704ee46d091d7d38d390` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 412：411 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 353：352 通过、1 跳过、0 失败 |
| 原生文件导出（实包） | `test-native-files-export-ui.mjs` | 5 项 PASS |
| 临时目录清理（实包） | `npm run test:temp` | 3/3 |
| 模型移除 + 状态行（实包 + 真实云端） | `npm run test:ui-status` | 5/5 |
| 工具结果脱敏（实包 + 真实云端） | `npm run test:tool-redaction` | 4/4 |
| 工具时间线（实包 + 真实内核） | `npm run test:tools-ui` | 2/2 |
| 包内源码核对 | `verify-packed-sources.mjs` | 96 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 902 ms · 窗口 1,002 ms · 可交互 1,176 ms（中位） |

## 界面验收明细

| 检查 | 结果 |
| --- | --- |
| 模型列表 | 47 行、46 个「设为当前」+ 1 个「当前」 |
| 移除一个模型 | 46 行，出现「已隐藏 1 个模型」 |
| 恢复全部 | 回到 47 行 |
| 工具读文件（含假手机号/邮箱） | 界面还原 `13800138000` 与 `qa-tool-redaction@example.com` |
| 模型自述 | 只说看到占位符，没有贴出原始号码 |
| 应用日志 | 不含原始号码与 API Key |

## 证据范围

- 真实云端只代表当次供应商与模型（`zhihui.kaogong.art`、`deepseek-v4.1-flash`）。
- 模型复述占位符时会整段显示「输出包含无法归属本任务的占位符，已停止还原」；本版未改这一行为。
- 工具结果脱敏只覆盖手机号与邮箱两类。
- 安装生命周期本轮未重跑；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名。

[本轮迭代](iteration-0.16.0.md) · [能力地图](harness-capability-map.md)
