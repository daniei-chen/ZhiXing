# 知行 0.17.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.17.0` |
| 构建源码 | `e540727456dd036b1c601b1e20e634368d5c75f0`（构建时 `sourceDirty=false`；之后只提交了 `tests/runtime-finalization.test.mjs` 的用例改写） |
| 包内源码 | 96 个文件，指纹 `26e7338274b8b135810723b9e71486001c2d243165fc4b1573c0173dcf8396f8` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,695,868 bytes，SHA-256 `9407aac4710eef07eef665632e562ece313d07147b9358d461537bfd14618a7f` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `6a8c36f8e4a27fc9865fc87a731c95e266c5aaf15dcbae96faf1fec7d9003d14` |
| blockmap | 314,858 bytes，SHA-256 `e7094e4c47aab74b69f4de2d5924ad00b2ec4c676ac457cee9b321fa239e3521` |
| `latest.yml` | 342 bytes，SHA-256 `500f33dd04c70cdd7439d34be0349eba35b60f8a471b1e5147707e01c91ab84e` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 416：415 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过、0 失败 |
| 原生文件导出（实包） | `test-native-files-export-ui.mjs` | 5 项 PASS |
| 临时目录清理（实包） | `npm run test:temp` | 3/3 |
| **占位符降级（实包 + 真实内核 + 本地假服务）** | `npm run test:restore-gap` | **2/2** |
| 工具结果脱敏（实包 + 真实云端） | `npm run test:tool-redaction` | 4/4 |
| 模型移除 + 状态行（实包 + 真实云端） | `npm run test:ui-status` | 5/5 |
| 真实云端工作区工具（实包） | `npm run test:workspace-tools` | 4/4 |
| 工具时间线（实包 + 真实内核） | `npm run test:tools-ui` | 2/2 |
| 包内源码核对 | `verify-packed-sources.mjs` | 96 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 966 ms · 窗口 1,074 ms · 可交互 1,280 ms（中位）；首次内容绘制 304 ms |

## 占位符降级验收明细

| 项 | 值 |
| --- | --- |
| 假服务返回 | `这是复述：⟦ZX-qa-unknown⟧ 结束。` |
| 界面正文 | 保留，令牌位置为 `【敏感值待核实】` |
| 提示文案 | `有 1 处占位符无法归属本次任务，已按【敏感值待核实】保留；原文没有还原，模型也没有看到原始内容。` |
| 错误提示 | 无（`.run-error-detail` 为空） |
| 日志 | 出现 `privacy.restore-unknown {"count":1}` |
| 证据 | `.preview/qa-0.17.0/restore-gap/run-mwvspfou/`（`restore-gap.png`、`result.json`） |

## 证据范围

- 降级只覆盖「无法归属的令牌」；令牌被模型改写或拼错仍按未知处理。
- 提示只在气泡下方；导出、分享与请求详情没有同样标记。
- 真实云端四套里没有一条故意让模型复述令牌，本版复现依赖本地假服务。
- 安装生命周期本轮未重跑；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名。

[本轮迭代](iteration-0.17.0.md) · [能力地图](harness-capability-map.md)
