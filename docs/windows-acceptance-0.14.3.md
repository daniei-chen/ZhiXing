# 知行 0.14.3 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.14.3` |
| 构建源码 | `a9b7ee1a0e16cb8ba082863f4351a23a712954ed`（`sourceDirty=false`） |
| 包内源码 | 92 个文件，指纹 `2d46e51a5f1c6a4ae3482229027c9b03be99a21441e5b82be802a7ce19dfa9da` |
| 锁文件 | `4c6ff05965c7b41c9f716fe96ccd080d8e21b832568305a01983ba95926e8bdb` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` · Node `v24.19.0` |
| 安装包 | `ZhiXing-0.14.3-x64.exe`，338,684,042 bytes，SHA-256 `423af01b1731056f1181cb96237e3e24815a6ffd8c792849eb1779d9ddf21e95` |
| 应用本体 | `知行.exe`，246,511,104 bytes，SHA-256 `05c063c80136ddc260100dbfd22e1a06b95c1f3b23e2abc484660f2a61045f66` |
| 签名 | `NotSigned`（没有证书，见 [signing.md](signing.md)） |

## 测试与实包验收

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 371 个：370 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14 个全通过 |
| 站点 | `npm run test:sites` | 4 个全通过 |
| 打包源码 | `npm run test:packed` | 323 个：322 通过、1 跳过、0 失败 |
| 原生文件导出（实包） | `test-native-files-export-ui.mjs` | 5 个场景通过 |
| 供应商错误文案（实包） | `test-error-copy-ui.mjs` | 4 个场景 + 4 组日志配对 |
| 聊天发送失败（实包，本版新增） | `test-chat-send-errors.mjs` | 2 个场景 + 2 组日志配对，退出码 0 |
| 包内源码核对 | `verify-packed-sources.mjs` | 92 个文件与测试源码逐字节一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178 个包、实装树 1,162 个包；两者都是 0 high、0 critical、32 moderate、2 条独立公告 |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化完成中位 778 ms · 窗口可见 874 ms · 可交互 1,045 ms |

## 聊天发送失败：实包上真的发了两次

本地假服务让模型目录成功（`GET /v1/models` 返回一个模型），这样供应商存得下来、模型选得中，才走得到发送路径；对话请求则分别制造两种真实失败：

| 场景 | 服务端行为 | 内核给出的原因 | 界面显示 |
| --- | --- | --- | --- |
| Key 无效 | `POST /v1/chat/completions` 返回 401 + `Invalid API key` | `{code:'AUTH', message:'401: {…}'}` → `（HTTP 401）` | `API Key 无效或已过期，请在「设置 · 供应商」中更新后重试。` |
| 连接被断开 | 收下请求后直接销毁 socket | 本机网关记 `{status:502, code:'SERVER'}` → `（HTTP 502）` | `无法连接到模型服务，请检查网络、代理或服务地址后重试。` |

两条界面文案都与主进程日志里的技术原文不同（脚本断言），主进程日志保留 `run.turn-failed` 的完整 `reason`。失败气泡出现的位置、次数、内容都由界面读取，不是脚本自报。

## 安装到真实用户环境

| 步骤 | 结果 |
| --- | --- |
| 冷备份 | `scripts/backup-host-bytes.ps1`：`%APPDATA%\知行` 113 个文件 + 2 条快捷方式逐字节记录，抄完回读比对 |
| 关闭应用 | 4 个进程 → 0 |
| 静默安装 `0.14.3` | 退出码 0，耗时 499 秒 |
| 启动 | 4 个进程；`app.start`：`version 0.14.3`、`previousVersion 0.14.2`、`updated true`；`last-version.txt` = `0.14.3` |
| 快捷方式 | 安装器重写了两条 `.lnk`，目标仍为 `D:\应用\知行\知行.exe`，工作目录 `D:\应用\知行`；新 SHA-256：桌面 `cfa76237…09a5`、开始菜单 `653b7116…4c54` |
| 用户档案字节 | 113 个文件中 102 个逐字节不变，7 个是 Chromium 缓存／`Local State`／`Preferences`，4 个是本应用自己要写的：`last-version.txt`、`logs/app.log`、`workspace.bin`、`automations.bin` |
| 用户数据语义 | 把冷备份和升级后的档案各复制一份，用同一份 `0.14.3` 打开：项目 2→2、会话 0→0、草稿 1→1，项目名与草稿键逐项相同 |

`workspace.bin`／`automations.bin` 的字节变化是加密写入的正常结果（每次写入的 nonce 不同），所以本轮没有拿字节相等当结论，而是回到界面实际读到的数据做对比。

## 依赖审计结论

1,178 个生产包（仓库根；实装树 1,162 个，差值是打包裁剪）全部与 `package-lock.json` 的版本一致；0 个 high、0 个 critical、32 个 moderate，落在 2 条独立公告上，与 `0.14.2` 的结论相同（本版未改依赖）。SBOM 与逐路径公告清单随发布资产提供。

## 证据范围

- 生命周期（安装／覆盖／卸载保留／重装保留）本轮**没有复跑**，`0.14.2` 的证据仍然只对 `0.14.1` 安装包成立；本版只做了「真实安装 + 启动 + 档案对比」。
- 真实云端模型回答未覆盖（没有可用 Key）。401 由本地服务返回真实 HTTP 401，但不是真实供应商。
- `403`／`429`／证书错误／`SERVER`／`CONTEXT_WINDOW_EXCEEDED`／`UNKNOWN_MODEL` 的文案只有映射层测试，没有在实包上制造过这些响应。
- 安装器未签名；视觉验收、跨 Windows 账户解密不在本轮范围。
- 环境注意：本机 shell 里 `ELECTRON_RUN_AS_NODE=1` 时直接启动 `知行.exe` 会以 Node 模式解析参数并立即退出（`bad option: --user-data-dir`）。所有实包脚本都先删除该变量再启动；手动排查时同样要先清掉。

[本轮迭代](iteration-0.14.3.md) · [能力地图](harness-capability-map.md)
