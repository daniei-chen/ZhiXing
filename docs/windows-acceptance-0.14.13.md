# 知行 0.14.13 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.14.13` |
| 构建源码 | `945220688cbf914dd968219a55e2c43a57d777a3`（`sourceDirty=false`） |
| 包内源码 | 96 个文件，指纹 `e642d6d9c62ad9f860e4c1f6916057ce41f584090abcb7065788de101f6119a9` |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | 338,693,960 bytes，SHA-256 `9a03cba1766b449748ce53181ce5d70057f72abde5071b9995a2ea187f0130e0` |
| 应用本体 | `知行.exe` 246,511,104 bytes，SHA-256 `3cc0971bf5fe8ca6037a2fba0a896a89bc05785e1b575b2aa7fa2002a55a823a` |
| blockmap | 314,747 bytes，SHA-256 `c0456dad7840decd735962d7f7de4f17cff965e81bccf8ceedc7dd455d5a0e2a` |
| `latest.yml` | 345 bytes，SHA-256 `ac3cd408fb4f43999472bd0abe8142856c5ff8b1b0a823aeae24e220c47cbea6` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 401：400 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 353：352 通过、1 跳过、0 失败 |
| 包内源码核对 | `verify-packed-sources.mjs` | 96 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 852 ms · 窗口 941 ms · 可交互 1,108 ms（中位） |
| **临时目录清理（实包）** | `npm run test:temp` | **3/3** |
| **真实云端问答（实包）** | `scripts/test-real-cloud-chat.mjs` | **4/4** |

## 临时目录清理验收明细

| 场景 | 结果 |
| --- | --- |
| `~nsu.tmp` 带「知行」字节、45 分钟未写 | 删除，日志记 `bytes` |
| 只有别家应用的 `nsHOST.tmp` | 原样保留，且**不写** `temp.hygiene` 事件 |
| 安装残留 `nsaB12.tmp` 带「知行」字节 + 别家同名目录 | 我们那份删除，别家保留，日志 `targets` 含被删目录名 |
| 证据 | `.preview/qa-0.14.13/temp-hygiene/run-mwvjz10k/result.json` |

## 真实云端验收明细

| 项 | 值 |
| --- | --- |
| 层 | Windows 实包 + 真实云端 |
| 供应商 | 自定义 Chat Completions，真实地址（证据只记 host `zhihui.kaogong.art`） |
| 模型目录 | 拉到 **47** 个模型 |
| 模型 | `deepseek-v4.1-flash` |
| 一次问答 | 4.86 秒返回，界面助手消息正文为「收到」，无错误提示 |
| 日志 | 不含 API Key、不含完整服务地址（脚本断言） |
| 证据 | `.preview/qa-0.14.13/real-cloud/run-mwvk1nol/result.json`、`reply.png` |

## 证据范围

- 真实云端只覆盖**单供应商、单模型、单轮问答**；多轮、工具调用、流式中断、限流、图片输入未验证。
- 清理只覆盖 NSIS 的 `~nsu.tmp` 与 `nsXXXX.tmp` 两种形状，且必须命中「知行／zhixing」字节标记；msi、便携版等其它安装方式留下的残留不在范围。
- 安装生命周期本轮未重跑（0.14.12 在 `0.14.0` 基线上 53 步、38 通过、0 未跑）；本版改动在启动路径的清理逻辑，卸载/重装步骤没有再次执行。
- `visualAcceptance`、`crossWindowsUserDecryption` 仍 `outside_scope`；真实子任务归档仍未通过；安装器未签名。

[本轮迭代](iteration-0.14.13.md) · [能力地图](harness-capability-map.md)
