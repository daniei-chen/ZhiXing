# 知行 0.37.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.37.0` |
| 构建源码 | `17d5a096583cb71d7099efb00ef7ba6a106d6da7`（`sourceDirty=false`） |
| 包内源码指纹 | `594e05c97f74a72acde7818f52151fdd6a32737b470d84204cf3d5f0cfc43ec9`（100 个文件） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | `ZhiXing-0.37.0-x64.exe` 338,713,479 B · `4158d7cfce9d71b709a60944151bdecff29da496c4a8394556b342754c03b26e` |
| 增量包 | `ZhiXing-0.37.0-x64.exe.blockmap` 314,764 B · `2421b3f654c95d8e141dd47cdd68bd2927905fa8d9ae4d280fe39d416a6b3de7` |
| 更新描述 | `latest.yml` 342 B · `d29f1be2c8157b83e1aa20154faed5ce69fd33cdadcb8c2552ca2241ed13f27c` |
| 应用可执行 | `知行.exe` 246,511,104 B · `cf23cfbf0771065eebc8e82e4ffa64629122e31c700fad7010c5ede9863cb37b` |
| 签名 | `NotSigned` |

## 测试

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 505：504 通过、1 跳过、0 失败（新增 `tests/context-window.test.mjs` 6 例） |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| **切换型号的窗口口径（本版改动）** | `npm run test:model-switch` | **5/5**：新增第 1 例在点完型号、**尚未发出请求**时断言用量已是 `32,768`；其后「先压缩 → 提交更短 → 有答复 → 用量一致」四例照旧 |
| 切换压缩失败路径 | `npm run test:model-window` | 4/4（本版复跑） |
| 溢出恢复 | `npm run test:overflow-recovery` | 本版未重跑（0.35.0 为 4/4） |
| 手动压缩 | `npm run test:compact-command` | 本版未重跑（0.35.0 为 5/5） |
| 自动压缩 | `npm run test:compaction` | 本版未重跑（0.23.0） |
| 错误文案端到端 | `npm run test:errors` | 本版未重跑（0.32.0 为 6/6，含真实 ENOTFOUND） |
| 改动对比／改动卡片／交付动作／行内引用／交付卡片／轨迹检索／消息反馈 | `test:review`／`test:changes`／`test:actions`／`test:inline-refs`／`test:deliverables`／`test:execution-search`／`test:feedback` | 本版未重跑（沿用 0.30.0／0.30.0／0.29.0／0.27.0／0.26.0／0.25.0／0.24.0） |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过（脚本退出码 0；其结果文件只记状态，故不声明条数） |
| 包内源码核对 | `verify-packed-sources.mjs` | 100 个文件与构建提交一致 |
| 依赖审计 | `audit-production-dependencies.mjs`（仓库／随包） | 1,178／1,162 个包，0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 调试端口 952 ms、CDP 1,349 ms、可交互 1,637 ms（中位）；首次内容绘制 `null`。本机本轮负载偏高，与 0.36.0 的 724／1,020／1,247 不可直接比较 |

## 证据范围

- 本版改的是输入区用量的分母口径（`src/context-window.js` ＋ `src/App.jsx` 一处接线），证据来自打包 EXE 上的真实内核 + 本地假供应商。
- 新增断言是**文本断言**：切换型号后立刻读到 `32,768`。没有做视觉核对（换行、字号、窄窗口截断）。
- 分子仍是上一次实测的历史大小，不是为新窗口重新测量的值。
- 目录里既无型号级、也无供应商级窗口时，分母退回一次实测值或 128,000，仍可能与实际不一致。
- 极小窗口（8,192）压缩不收敛的行为未变，仍只给可行动文案。
- 图像卸载、真实云端、签名未覆盖；**安装生命周期没有为本版重跑**，仍是 0.24.0 的 53 步证据。
- 长会话下「无法确认内核已退出」的触发条件仍未查实。
- `visualAcceptance` 与 `crossWindowsUserDecryption` 仍为 `outside_scope`。

[本轮迭代](iteration-0.37.0.md) · [审计说明](audit-request-0.37.0.md) · [机制对照](harness-parity.md)
