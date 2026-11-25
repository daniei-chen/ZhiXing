# 知行 0.15.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.15.0` |
| 构建源码 | `d287eeea2aae63b78f4541c57da8d03462a1770b`（`sourceDirty=false`） |
| 包内源码 | 96 个文件，指纹 `44eab80bfedecca65d94c13874e146af48473723805011ef8f810efe4397cead` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,694,906 bytes，SHA-256 `2a7da1a6fad0b7923f0fffb075ffcc955bc4eacf99dde73e6ff6f13a90880f99` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `3b931621355079efabb12aac6741987e50d52f9edde7fde39c39f609b7311c9e` |
| blockmap | 314,886 bytes，SHA-256 `c88b5487ddfba344df86efcfe7b5ed09c7c02132165b7591c5d48a9a88ebe03c` |
| `latest.yml` | 342 bytes，SHA-256 `768d7051ca2a79f7ea3e56538219ac2ba6b0fb32d053cb3760f55a067a8ebd33` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 406：405 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 353：352 通过、1 跳过、0 失败 |
| 原生文件导出（实包） | `test-native-files-export-ui.mjs` | 5 项 PASS |
| 临时目录清理（实包） | `npm run test:temp` | 3/3 |
| 包内源码核对 | `verify-packed-sources.mjs` | 96 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 928 ms · 窗口 1,037 ms · 可交互 1,217 ms（中位） |
| **状态行 + 模型选择（实包 + 真实云端）** | `npm run test:ui-status` | **4/4** |

## 界面验收明细

| 检查 | 结果 |
| --- | --- |
| 供应商保存并拉取模型 | 47 个 |
| 「已保存的模型」 | 默认展开，47 行；46 个「设为当前」+ 1 个「当前」 |
| 点击「设为当前」 | 工作区模型 `deepseek-v4.1-flash` → `auto`，提示「已把「Auto」设为当前模型」 |
| 发消息后的状态行 | 只出现「思考中」；断言不含「内核」「初始化」「启动」等阶段文案 |
| 证据 | `.preview/qa-0.15.0/run-status-ui/run-mwvlzycv/result.json`、`provider-models.png` |

## 证据范围

- 界面验收使用真实云端（`zhihui.kaogong.art`、`deepseek-v4.1-flash`），只代表该供应商与模型；`auto` 只验证设置切换，未让它实际回答。
- 未做「删除单个模型」；未在内联展示模型推理正文与工具调用明细（仍在执行面板）。
- 安装生命周期本轮未重跑；`visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名。

[本轮迭代](iteration-0.15.0.md) · [能力地图](harness-capability-map.md)
