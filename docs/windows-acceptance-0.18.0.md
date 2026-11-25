# 知行 0.18.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.18.0` |
| 构建源码 | `d9a1cbcbc6c591bd359d2b7a6f29aa567e1c89a1`（`sourceDirty=false`） |
| 包内源码 | 96 个文件，指纹 `b0f2ff550f7ff975c9223acebf870644512e91afb5661ab9457810b9a7f2a5fa` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,696,128 bytes，SHA-256 `a7f80fd8dbb8b801ba9b15fed36d16481c45198060bdfab0c4a96c8800274d80` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `3b5f496fdb7aa78604dac78cbf60395b8a3c8783ebd4f494f3d7d1d1c25dfa95` |
| blockmap | 314,938 bytes，SHA-256 `8c6712a0ccfb6df95649c369c021bac29d00d1cc56a3b03ed2ec2bfc50f9903c` |
| `latest.yml` | 342 bytes，SHA-256 `6584905cb3a7628eb6ab742fed5a7bf6e574bf723d76a24bf7d20ca0234f058b` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 422：421 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| 供应商页档位 + 模型移除 + 状态行（实包 + 真实云端） | `npm run test:ui-status` | 6/6（新增档位一项） |
| 错误文案（实包 + 真实网络故障） | `npm run test:errors` | 6/6 |
| 占位符降级（实包 + 本地假服务） | `npm run test:restore-gap` | 2/2 |
| 工具时间线（实包 + 本地假服务） | `npm run test:tools-ui` | 2/2 |
| 工具结果脱敏（实包 + 真实云端） | `npm run test:tool-redaction` | 4/4 |
| 真实云端工作区工具（实包） | `npm run test:workspace-tools` | 4/4 |
| 原生文件导出（实包） | `test-native-files-export-ui.mjs` | 5 项 PASS |
| 临时目录清理（实包） | `npm run test:temp` | 3/3 |
| 包内源码核对 | `verify-packed-sources.mjs` | 96 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 1,178 / 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 912 ms · 窗口 1,020 ms · 可交互 1,197 ms（中位）；**首次内容绘制本轮为 `null`（未采到）** |

## 错误文案端到端明细

| 故障 | 真实错误码 | 界面文案 |
| --- | --- | --- |
| `api.deepseek.com` + 假 Key | `HTTP_401` | API Key 无效或已过期，请在「设置 · 供应商」中更新后重试。 |
| 不存在的主机名 | `ECONNRESET`（不是 `ENOTFOUND`） | 连接被中途断开，请检查网络后重试。 |
| 关闭的端口 | `ECONNREFUSED` | 服务地址拒绝连接，请确认地址和端口是否正确。 |
| 无响应地址 | `TIMEOUT`（12 秒） | 请求超时，请检查网络后重试。 |

主进程日志保留真实错误码，界面文案与技术原文分别留档。**`ENOTFOUND` 文案本轮仍未触发**。

## 供应商页档位验收

点「高」后 `loadWorkspace().settings.reasoning === 'high'`，档位按钮 `aria-pressed` 同步，来源是运行时扁平模型清单（`provider.models` 不含 `levels`，第一版因此误报「档位尚未确认」）。

## 证据范围

- 档位只覆盖当前模型；无按模型保存偏好；未做「档位影响输出」的对照实验。
- `ENOTFOUND` 文案未端到端验证。
- 安装生命周期沿用 0.17.0 的 53 步证据（0.14.0 → 0.17.0），本版未重跑。
- 启动探测未采到首次内容绘制（`null`）。
- `visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名。

[本轮迭代](iteration-0.18.0.md) · [能力地图](harness-capability-map.md) · [安装生命周期（0.17.0）](lifecycle-acceptance-0.17.0.md)
