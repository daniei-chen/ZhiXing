# 知行 0.14.1 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。本版让「拉取模型目录」的真实网络失败在界面上给出对应文案，并用实包逐条验证。 [迭代记录](iteration-0.14.1.md) · [签名说明](signing.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.14.1)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `3e0b5f17548e940fad1cb8730d417db875c21e2d`，`sourceDirty=false` |
| 源码指纹 | `248d3815d590280929a4eef09d9103187cd9f8c6297fcba3c33507b61cf3533e`，90 个匹配文件 |
| 锁文件 SHA-256 | `81dcda054fbc0be556461c183f85db6da64bd99f81087934528dfa75a8ef3879` |
| Electron | `44.11.5` |
| 源码回归 | 369 项，368 通过，0 失败，0 取消，1 条件跳过 |
| 组件回归 | 14 项，14 通过，0 失败 |
| 站点回归 | 4 项，4 通过，0 失败 |
| 目录包回归 | 323 项，322 通过，0 失败，0 取消，1 条件跳过 |
| Windows 桌面专项（原生文件/审批/导出） | 5/5 |
| Windows 实包错误文案专项 | 4/4 场景 + 4 条主进程日志配对，退出码 0 |
| 启动测量 | 10 次中位数：`initialise` 798 ms、窗口显示 892 ms、可交互 1,057 ms |
| `知行.exe` | 246,511,104 bytes，SHA-256 `61ac81d0afc447383f8bd9bc3d05eacd815967bfaa28cfc91398ab17f2239644` |
| `ZhiXing-0.14.1-x64.exe` | 338,681,362 bytes，SHA-256 `5031d0d1479c9e8c62837887625a519cf3be8433c8cce7ce60655406ae1681c3` |
| `ZhiXing-0.14.1-x64.exe.blockmap` | 314,765 bytes，SHA-256 `3f5905991f7b354244471e7c489acc99154370c7da702e225418fc1c1c63a1d1` |
| `latest.yml` | 342 bytes，SHA-256 `64131742f0019f5c7a48201848b43c248fe3b639c2254b23fb0abb27227efeb3` |
| 安装器签名 | `NotSigned`（证书未申请） |
| `知行.exe` 签名 | `NotSigned` |

## 本版改动

`electron/model-catalog.mjs` 的 `fetchModels` 不再吞掉底层原因：新增 `failureCode(error)`，把 `error.cause.code`、`error.code` 或 `TimeoutError` 收敛成一个受格式约束的错误码，拼进 `无法读取模型列表（CODE）…`。`src/error-copy.js` 的映射不变，因此 401／403／429／DNS／拒连／重置／超时／证书八类文案首次真正对齐到同一个故障。

新增两个测试入口：

- `tests/error-copy.test.mjs`，并入 `npm test`；
- `scripts/test-error-copy-ui.mjs`（`npm run test:errors`），用临时 profile 启动打包 EXE，驱动真实「设置 · 供应商」表单。

## 实包错误文案专项怎么跑的

`node scripts/test-error-copy-ui.mjs "release\win-unpacked\知行.exe"`

| 场景 | 制造方式 | 主进程消息 | 界面显示 |
| --- | --- | --- | --- |
| 真实 401 | `POST`/`GET api.deepseek.com/models`，假 Key | `读取模型列表失败（HTTP 401），已保留当前配置。` | API Key 无效或已过期，请在「设置 · 供应商」中更新后重试。 |
| 不存在的域名 | `https://qa-error-copy-*.invalid/v1` | `无法读取模型列表（ECONNRESET），请检查网络和 API 地址。` | 连接被中途断开，请检查网络后重试。 |
| 关闭的本机端口 | 占端口后关闭，再指向该端口 | `无法读取模型列表（ECONNREFUSED），请检查网络和 API 地址。` | 服务地址拒绝连接，请确认地址和端口是否正确。 |
| 无响应服务 | 本机 HTTP 服务接受连接不响应，12 秒 | `无法读取模型列表（TIMEOUT），请检查网络和 API 地址。` | 请求超时，请检查网络后重试。 |

每个场景同时断言：失败后没有留下供应商、界面文案与技术原文不同、退出码为 0。证据在 `.preview/qa-0.14.1/error-copy-ui/`（`result.json`、四张截图、`app-0.log`）。

## 依赖审计结论

生产清单 1,178 个包，0 high、0 critical、32 moderate、2 条 unique 通告（随包 npm CLI 的 `glob`／`minimatch`，仅插件安装时使用）。Electron `44.11.5`，与上一版一致。

## 证据范围

源码、Windows 实包两层都有本轮新增证据。**合成运行层本轮为空**（故障全部是真实网络/真实本机端口，没有为文案另造合成服务）。

未覆盖：

- **`ENOTFOUND` 文案没有实包证据**。本机 DNS 把任何域名解析到 `198.18.0.x`，拒绝连接时得到 `ECONNRESET`；`ENOTFOUND`／`EAI_AGAIN` 两类只有源码层模式匹配证据。
- **聊天发送失败的正文文案未测**。本轮只覆盖供应商设置的目录拉取入口。
- HTTPS 证书错误、403、429 未构造真实服务端。
- 真实云端模型回答、代码签名、跨账户解密、交互式安装全流程仍未覆盖。
