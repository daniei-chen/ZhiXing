# 0.11.0 Windows 继续验收

日期为 2026-11-20，时区为 Asia/Shanghai。环境为 Windows 11 x64 build 22631、Node v24.19.0、npm 11.17.0。产品修复提交为 `cb002b5`，分支为 `hardening/0.11.0-core`。

## 本轮发现与修复

| 对应问题 | 现场发现 | 修复 |
| --- | --- | --- |
| F03 草稿恢复 | 加密文件仍含草稿，重启后输入框为空 | 恢复当前模式中最近编辑的有效草稿作用域，跳过已删除项目和归档聊天 |
| F03 发送失败 | 提交时清草稿，运行准备或模型请求失败后难以继续修改 | 仅恢复未被后续编辑的原提交版本，新 revision 不被旧回调替换 |
| F05 流式停止 | 服务已输出首段，停止后未保留该前缀 | 原 SDK shutdown 先关闭订阅再触发 Agent disposal。每次运行新增独立加密取消通道，等待原生取消、子任务、前缀事件、最终写入和清理。通道失败标记 interrupted |
| F05 中断恢复 | pending 消息恢复时正文被固定文案替换 | 保留 progressText 或已保存正文，标记 interrupted，不自动重复执行 |
| F08 退出保存 | 活跃写入失败后 pending 保留，等待中的 flush 不结算 | 明确拒绝本批 flush，保留待重试版本，覆盖并发、较新版本和监听器立即重试 |
| F09 状态条 | 保存状态条挡住发送区 | 普通状态移至标题栏，失败提示保留重试入口 |
| F09 外观键盘 | radio 风格外观选项缺少方向键移动 | 补方向键、Home/End、单一 tab stop 与焦点跟随 |

## 自动化和真实界面结果

| 验收层级 | 结果 | 证据 |
| --- | --- | --- |
| Windows 源码全量 | 92/92，0 fail，0 skip | `.preview/qa-0.11.0/source-final.log`，约 115 秒 |
| 最终目录包回归 | 70/70，0 fail，0 skip | `.preview/qa-0.11.0/packed-final.log`，约 321 秒。临时 cwd、空 NODE_PATH/NODE_OPTIONS |
| Sites | 构建及 4/4 路由回归通过 | `npm run build`、`npm run test:sites` |
| 原生浏览器 | 源码和最终目录包模块均通过 | `npm run test:browser` 及指定最终 EXE 的同一脚本。独立可见 Electron 宿主加载对应源码/包内 `BrowserService` 模块。测试单独使用临时 user-data-dir，验证导航、前进/后退、读取、截图、隔离、视图范围和关闭；此项不等同完整 React 页面旅程 |
| MCP 双目的地 UI | 通过 | A 真实 tools/list。改 B 留空被阻止，显式 `{}` 后 B 无鉴权，填入 B 凭据后恢复，禁用再启用保留 B 凭据。B 从未收到 A bearer |
| MCP 扩展边界 | 通过 | 真实 Harness 验证 port/path/host、HTTP→stdio、stdio→HTTP、启停与清空。另有实际 lookup 与审批合成服务回归 |
| 草稿 UI | 通过 | 三项目、办公政务、设置和资料页往返，附件正文恢复，输入短长短回缩。源码版与目录包分别执行 |
| 停止与再次执行 UI | 通过 | 首段后停止保留 QA_LONG_CHUNK，服务记录连接中止。再次执行保留两对问答，后续模型请求包含原 assistant 回复，型号与 high 参数匹配 |
| 错误与恢复 UI | 通过 | 模型确定性 400 保留草稿。Windows 独占文件占用造成保存失败，超过 toast 时长仍有错误与重试入口，释放后新版本落盘 |
| 弹窗与原生视图 | 通过 | Escape、关闭按钮返回入口焦点。实际 WebContentsView 在设置和弹窗中移除，返回后恢复 |
| 整进程重启 | 通过 | 目录包从临时 cwd 重开，仍有 5 项目、7 聊天、1 供应商、1 MCP 和指定草稿。`packed-ui-evidence/full-restart.json` |
| 安装、升级、卸载与重装 | 通过 | 用 0.10.0 实际 NSIS 安装器建立同 SID 合成配置，以最终 0.11.0 安装器升级、同版覆盖、默认卸载保留、重新安装，并逐阶段启动程序从包外 cwd 读取项目、聊天、草稿、供应商与 MCP。53 条步骤均完成。原用户默认数据 90 项文件哈希及原 0.8.1 快捷方式前后匹配。历史 0.10.0 不含草稿格式，故在升级后的 0.11.0 中创建并单独建立草稿基线后验证卸载/重装保留；不声称迁移旧版草稿。报告：`.preview/qa-0.11.0/install-evidence-20261120-115956-b4bf76a3/report.json` |
| 安装路径上限 | 通过 | 由最终包目录计算安装根上限为 70 个 UTF-16 代码单元，121 字符的隔离路径经 silent install 返回 87，未写产品文件或注册；NSIS 创建的空目标目录已清理。交互式安装器的超长路径对话框未单独人工点击验收 |

## 窗口与缩放

每个配置检查 4 个工作区页面、14 个设置页和 6 个工作面板，共 24 个检查点。三客户区尺寸乘四档内容缩放共 288 个检查点，源码版和最终目录包均逐项运行并保存 PNG。

| 客户区尺寸 | 内容缩放 |
| --- | --- |
| 1255×912 | 100%、125%、150%、200% |
| 1366×768 | 100%、125%、150%、200% |
| 1920×1080 | 100%、125%、150%、200% |

通过真实 BrowserWindow 调整窗口，通过 `webContents.setZoomFactor` 调整内容缩放。旅程使用 Chromium 输入事件点击实际控件，检查滚动可达、命中遮挡和文档横向溢出。窄视口用侧栏开关导航，设置分类提供横向滚动，下方内容可垂直滚动。

本轮没有改变 Windows 系统 DPI 或切换物理显示器分辨率。上述尺寸为应用客户区，缩放为应用内容。参考为用户提供的 Codex 截图，保留墨竹品牌和知行中性工作台，不作像素一致或完整 WCAG 声明。

## 原始证据与复验

源码截图和结果位于 `.preview/qa-0.11.0/ui-evidence`，目录包证据位于 `.preview/qa-0.11.0/packed-ui-evidence`。各目录包含 `drafts.json`、`workflows.json`、`recovery.json`、`pages.json` 及截图。收件记录位于 `.preview/qa-local-services/receipts.jsonl`，仅含本机合成资料。

`npm test` 和 `npm run test:packed -- ".\release\win-unpacked\知行.exe"` 已纳入新增 MCP、生命周期与保存队列回归，没有删除有效断言或增加 skip。原生浏览器回归使用独立临时 Electron 用户目录，并显示测试宿主窗口，避免和桌面 Electron 进程竞争共享的默认 GPU 缓存目录。

`npm run test:ui -- drafts`、`workflows`、`recovery`、`pages` 对隔离 Windows 实例执行真实 React/IPC 旅程。由测试负责人启动专用 `--user-data-dir` 实例，测试端口为回环 `--remote-debugging-port=9333` 和主进程 `--inspect=9334`。`scripts/qa-local-services.mjs` 提供本机合成模型和 MCP A/B。测试脚本不打入产品，正常启动不会主动开放调试端口。

最终源码门禁为 `npm test` 92/92、`npm run test:sites` 4/4、构建通过。最终目录包 `npm run test:packed -- ".\release\win-unpacked\知行.exe"` 序列复跑 70/70，0 失败、0 跳过。首次序列复跑有两个环境敏感失败，临时工作区删除时报 `EBUSY`，工作树测试超过 20 秒。随后的独立序列复跑全绿，未删断言或降低门槛。浏览器源码版与包内版回归通过。

最终 Windows x64 NSIS 安装器为 `release/知行-0.11.0-x64.exe`，559,028,208 bytes，SHA-256 `FBDF578B24A85367A077127DA12C4CF2B61717BCF4DC18CB26637C004D1BD56E`。最终应用为 `release/win-unpacked/知行.exe`，246,317,568 bytes，SHA-256 `18126185C3FAD8E55E706444B4DD390AC3E9416DAE798EAA40526B515D76E795`。安装器及应用 EXE 均通过 9 尺寸墨竹图标校验，品牌原 PNG 哈希不变。安装器未签名。安装器仅对不超过 70 字符的安装根接受安装。

## 数据和能力边界

本轮不升级工作区 schema，不清除用户资料。恢复逻辑读取已有加密草稿和会话。中断任务保留正文，由用户明确再次执行后才发起新运行。历史版本迁移验收使用同一个 Windows SID 和合成资料，未测试跨 Windows 用户解密。安装文件未签名，界面缩放属于应用内容缩放，不代表 Windows DPI 物理屏幕切换。

真实云端供应商效果、真人麦克风、完整 OAuth、模型视觉输入与全分支迁移仍需后续独立验收。构建有前端主块超过 500 kB 的提示，安装器未签名。完整能力范围继续由 `harness-capability-map.md` 追踪。
