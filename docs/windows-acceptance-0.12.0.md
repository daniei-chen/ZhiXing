# 知行 0.12.0 Windows 实包验收

记录日期：2026-11-21，Asia/Shanghai。版本继续为 **Windows x64 未签名预发布候选**。本页分别记录源码、目录包、真实页面与实际 NSIS 安装器，不将工具注册、合成服务或旧版本安装记录扩写成全能力验收。

**最终结论**：本页 SHA-256 对应的最终安装器已通过同 Windows 账户、合成资料条件下的 0.11→0.12 升级、同版覆盖、默认卸载保留及重装保留验收；源码、目录包和所列 Windows 界面旅程通过。未覆盖范围继续保留，版本仍为未签名预发布候选。

## 环境与产物一致性

- Windows 11 x64 build 22631；Node.js 24.19.0；Electron 44.7.0；npm 11.17.0。
- Harness 及 SDK 固定 `0.2.2-rc.5`，没有把上游 master 接口当作已安装能力。插件运行时携带独立 Node 和固定 npm CLI。
- 从 `4c245d56ba43943acf9f3f9226912acb5a4e6a35` 继续；最终源码由 GitHub `v0.12.0` 标签定位，提交说明记录通过项和未覆盖范围。
- 最终目录包由标准 `npm run electron:dist` 重建，复制 1,194 个锁定的生产依赖包，保留嵌套路径；部分其他平台可选包不进入 Windows 产物。
- `scripts/verify-packed-sources.mjs` 核对 76 项业务 JS 和编译前端文件，另核对应用版本、入口与声明的生产依赖版本。文件集合指纹为 `d63d8629162998b4f0202cc13198790956d3a63836a65809b916e005b456fde7`。这不是全部传递依赖的完整 SBOM。
- 文件哈希以 Windows 构建工作树和实际编译产物的字节为准；不同 Git 检出换行设置会改变源文件字节。该清单用于核对已测目录与安装结果，不是跨平台逐字节可复现构建的声明。
- 安装根上限为 70 个 UTF-16 代码单元，最长包内相对路径为 188。0.12.0 尚未单独人工验证超长路径交互提示。

## 最终回归结果

| 层级 | 结果 | 范围与本机证据 |
| --- | --- | --- |
| 完整源码 | **164/164，0 fail、0 cancel、0 skip** | `.preview/qa-0.12.0/source-final-serial.log`；使用 `npm test` 相同文件清单、`--test-concurrency=1` 串行执行，约 399 秒 |
| 最终目录包 | **132/132，0 fail、0 cancel、0 skip** | `.preview/qa-0.12.0/packed-release-final.log`；实际包内 Electron 作为 Node，从临时包外 cwd 启动，清空 NODE_PATH/NODE_OPTIONS，约 362 秒 |
| React 独立组件 | **2/2** | `.preview/qa-0.12.0/components-release-final.log`；原生 Electron renderer 验证产出来源浮层与语音组件的竞态/清理，不代表真人麦克风 |
| 前端与 Sites | 构建通过、**4/4** | `.preview/qa-0.12.0/build-release-directory.log`；`npm run test:sites`。主入口约 671 kB，仍有超过 500 kB 的构建提示 |
| 隐私与内核设置 UI | **10/10** | `.preview/qa-0.12.0/packed-kernel-privacy-release/journey.json`；实际版本、Unicode 替换/依据、伪造占位符凭证阻断、本机样例不落盘、真实 Teams 工具目录、搜索空态、配置保存后目录失效、关闭与恢复默认 |
| 完整会话 UI | **12/12** | `.preview/qa-0.12.0/packed-conversation-release/journey.json`；真实 Harness 文件写出及 present、网页与附件来源、诚实的搜索不可用提示、分享/复制/导出审阅、侧边聊天独立历史与附件、首段实时显示、停止及供应商隔离 |
| 页面与缩放矩阵 | **336/336** | `.preview/qa-0.12.0/packed-pages-release/pages.json`；实际 BrowserWindow 与 Electron 内容缩放，范围见下文 |
| 原生浏览器 | 通过 | `.preview/qa-0.12.0/browser-release-final.log`；最终包内 BrowserService 的导航、前后退、文字读取、隔离、范围、可见性和关闭 |

UI 使用最终 `release/win-unpacked/知行.exe`、独立 `--user-data-dir` 和合成项目/模型/MCP 服务。调试端口只用于专用验收实例，正常产品启动不主动开放。没有使用真实业务原件、真实云端账户或原用户的配置作为模型测试材料。

## 确实运行的内核和脱敏能力

| 能力 | 实际通过内容 | 不能据此声称 |
| --- | --- | --- |
| 原生 Agent Teams | 官方服务与工具创建任务、CAS revision 领取/完成、列表、加密重启恢复，执行面板读取真实任务状态 | 文件范围声明是强制访问控制；多家真实云端子模型全部并发验证 |
| 原生 PTC | `run_code` 实际编排 `office_calculate` 得到 10；工作进程不继承模型 Key；规划模式拒绝代码执行 | PTC 已在受限权限下成为安全代码沙箱。该功能默认关，仅在绑定项目和完全访问时生效 |
| Windows 命令边界 | 官方 `dsh-pwsh-sandbox`/`dsh-sandbox-local` 实际拒绝 ask/auto 的项目外写入，允许项目内写入，full 明确放行；环境变量采用必需项白名单 | 隔离全部文件读取、网络，或阻止已授予完全访问的代码读取本机资料 |
| 内核稳定性接线 | 挂载官方结果裁剪、重复工具提醒、协作式超时和时间上下文；真实请求核对时间服务读数 | 完成所有插件故障注入、任意代码强杀或长期压力可靠性评估；未启用明文 spill |
| 模型与协议 | 真实 Harness 对本机 Chat Completions/Messages 收件端验证路由、默认非推理、不支持档位拒绝、429→503→成功、有界重试、父子流归属 | 所有真实云端供应商兼容性，或 OAuth/Responses/Gemini 已接入 |
| 审批与规划 | present 进入主机文件审批；规划检查先于后续执行与审批；只读网页/浏览器快照/MCP 资源依语义放行 | 为任意外部 MCP 工具推断了只读安全性 |
| 本机规则脱敏 | Unicode 规范化检测视图映回原始 UTF-16 位置，字段别名、身份证/Luhn/IBAN 校验、分类动作、自定义词、重叠规则、占位符防伪及工具/HTTP 边界测试 | 全部人名/地址/国家证件/任意编码均可识别；没有独立真实语料召回率或误报率结论 |
| 当前模型凭证 | 长度至少 12 字符的当前 Key，其原文及规范化值在请求、最终回复、流式草稿、执行预览与实时/最终任务板独立阻断；测试实际分别使用 redact/raw | 任意未知秘密均自动识别。短于 12 字符的自定义 Key 仍依赖通用规则，没有独立值匹配；通用规则与当前 Key 比较是两层不同保护 |
| 插件独立运行时 | 移除外部 Node/npm PATH 后，实际管理器完成检查、安装脚本审阅、启用、更新与移除 | 任意第三方原生插件的编译器/系统工具已全部随包提供 |

详细接线、参考 Presidio/scrubadub/Gitleaks 后采用的方法和各项限制见 [0.12.0 迭代记录](iteration-0.12.0.md)。这三个项目的引擎并未内嵌；没有完整 Gitleaks 规则库、熵扫描或 NER 模型。

通用凭证类别默认拦截。若用户显式改为“替换”再选择非脱敏模式，原文模式不执行替换，通用规则也不会在该组合下强制阻断；至少 12 字符的当前模型 Key 独立检查另行生效。这不是任意配置下强制过滤所有凭证的承诺。

## Windows 界面范围

矩阵为 1255×912、1366×768、1920×1080 三种应用客户区尺寸，乘 100%、125%、150%、200% Electron 内容缩放。每配置 28 项，共 336 项：4 个工作区页、14 个设置页、8 个面板和 2 个顶栏检查。检查页面可达、文档横向溢出、控件命中、滚动以及相应断言并保存 PNG；面板截图不代表面板中每种工具都运行了一遍。

没有更改 Windows 系统 DPI、物理显示器分辨率或完成读屏/WCAG 全量审计。墨竹品牌和中性灰白沿用已有设计，不宣称与 ChatGPT/Codex 像素一致。

## 实际 NSIS 安装器与生命周期

最终安装器基于上述已测目录使用 `--prepackaged` 构建，没有再重建一份未测前端。应用 EXE 与 NSIS 安装器均通过 9 个尺寸的墨竹图标资源检查，品牌原 PNG 的 SHA-256 未变。两份 EXE 的 Authenticode 状态均为 `NotSigned`。

| 资产 | bytes | SHA-256 |
| --- | ---: | --- |
| `ZhiXing-0.12.0-x64.exe` | 564,499,586 | `CB535B135DC824BC1784BC497945E3971608BB9BAA072817B84B11D705F5298E` |
| `ZhiXing-0.12.0-x64.exe.blockmap` | 490,576 | `4F659A84AAC198B0EDC3F0832E13CDC57D8207CEBE613EAFC764979C0A80791B` |
| `win-unpacked/知行.exe` | 246,317,568 | `D3F02148E194B00F91DD1E5B88AAE9DEBF03A232921FA720FE27D16462962BD3` |

发行安装器与本机 `release/知行-0.12.0-x64.exe` 为相同字节，只使用 ASCII 发行文件名，便于下载与外部核验。

**本版本安装器已通过配置条件下的自动化非视觉生命周期验收**。报告状态为 `passed_configured_nonvisual_lifecycle`，53 条记录：38 条通过检查、15 条启动/基线等观察记录。原始报告为 `.preview/qa-0.12.0/install-evidence-20261121-174851-0d80ea6e/report.json`，SHA-256 为 `0BD020EB9FC3BF2EA99FE5A1B6F577B9D0130E7669E1E991DEFAA956896CDC80`。

| 实际 NSIS 阶段 | 结果 | 本机耗时 |
| --- | --- | ---: |
| 0.11.0 基线安装 | 通过，退出码 0 | 548.05 秒 |
| 0.11.0 → 0.12.0 升级 | 通过，退出码 0 | 499.53 秒 |
| 0.12.0 同版覆盖 | 通过，退出码 0 | 505.9 秒 |
| 默认卸载并保留配置 | 通过，退出码 0 | 25.67 秒 |
| 0.12.0 重装 | 通过，退出码 0 | 376.53 秒 |
| 最终测试安装清理 | 通过，退出码 0 | 31.49 秒 |

合成 profile 位于独立的自定义 `--user-data-dir`，并非真实用户的默认 AppData 档案。卸载保留结论限定于这份合成档案；原默认目录另有字节保护和恢复流程，不能由最终恢复后的哈希反推其从未被卸载器改动，也不声称默认真实档案已作逻辑保留验收。

测试在同一个 Windows SID、独立且包含中文/空格的短安装目录和合成资料上执行，使用实际安装器进行静默当前用户安装。报告中的“首次安装”是 **0.11.0 基线安装**；没有把它记作 0.12.0 空配置新装。安装解包在本机耗时较长，上表保留实际测量，不作普遍性能承诺。

升级、覆盖及重装后的主程序均从安装目录外启动，通过真实 preload 读取项目、聊天、设置、供应商、MCP 和四个作用域的纯文本草稿，逐项比较逻辑哈希；每次正常退出后刷新密文字节基线，再验证下一次 NSIS 操作未改变已关闭配置。四份草稿来自已持久化的 0.11.0 合成状态，验证其升级到 0.12.0 后及卸载/重装后的保留；没有附件草稿。

0.12.0 升级、覆盖和重装这三次安装结果均匹配上述 **76 项业务/编译前端文件指纹**，主程序 EXE 的 SHA-256 也与已测目录包一致。最终包没有再被不同的未测构建替换。

原用户默认资料只作冷字节备份和哈希保护，不解密或用于模型测试。每阶段保护检查、最终原注册占用/快捷方式/默认数据存在性及字节恢复均通过。最终测试安装已卸载，测试注册已移除。升级/覆盖使用 `--updated`；卸载使用 `--keep-shortcuts` 后人工恢复原快捷方式字节，因此**不把普通卸载的快捷方式自动清理列为通过项**。

**仍未覆盖**：0.12.0 空配置全新安装、交互式安装/卸载、所有用户安装、普通卸载快捷方式自动清理、跨 Windows 用户解密、真实用户资料迁移及带附件草稿保留。0.11.0 的旧包结论独立保留，本节仅针对本页公布 SHA-256 的 0.12.0 安装器。

GitHub `v0.12.0` 发行资产提供完整安装器、blockmap、`SHA256SUMS.txt`、`ZhiXing-0.12.0-audit.json` 与 `ZhiXing-0.12.0-packed-sources.json`。审计摘要公开测试层级、通过/观察数、源码提交及未覆盖范围，不包含原始 profile、凭据、SID 或主机备份。

## 失败记录与复验方式

- 首轮包内测试发现插件版本探测依赖系统 npm。加入固定生产 npm、私有命令入口和 Unicode 路径环境传递后重建；移除外部 Node/npm 后的插件生命周期通过。
- 本轮测试曾出现内核 20 秒初始化超时、语音子进程 30 秒启动超时、组件 renderer 启动超时及一次 PTC 规划旅程未完成。独立复验及最终串行源码/包内全量均通过；语音夹具补充启动阶段日志，PTC 夹具保留合成诊断。没有删除有效断言或增加 skip。尚无长期压力统计，单次全绿不等于偶发稳定性风险已穷尽。
- 早期页面截图因 QA 窗口最小化超时。脚本仅恢复专用 QA BrowserWindow，并以 `showInactive()` 准备截图表面；不更改用户的其他窗口，也未放宽页面断言。
- 所有早期失败日志仍保留在本机 `.preview/qa-0.12.0/`。GitHub 仅上传摘要、文件指纹及校验值，原始测试 profile、加密配置、SID 和主机备份不公开。

## 未覆盖与未实现

以下不作为本次通过项：

- 常驻 Harness Host、跨轮存活 MCP/Jobs、MCP/供应商 OAuth、按需工具及重连、DeepSeek 账号登录、独立搜索凭据、Responses/Gemini 协议。
- 完整原生 filesystem/ripgrep/局部编辑、Agent Office 三工具、离线 Python、异构子模型、外部代理、会话内工作树与原生 Host 调度。
- 增量加密事件/Blob；现有工作区仍有 12 MiB 上限、历史全量加密写回。敏感 signed thinking 仍失败关闭，没有静默改签名块。
- 模型视觉、原图打码、图片/音频/PDF 原始字节和 Office 隐藏对象的全面脱敏、NER、全部敏感信息召回。
- 真实云端供应商矩阵、真人麦克风、物理 DPI、无障碍全量审计、Windows 签名、长期稳定性与全部第三方插件编译环境。
- 0.12.0 空配置全新安装、交互式安装/卸载、所有用户安装、普通卸载快捷方式自动清理、跨 Windows 用户解密、真实用户资料迁移及带附件草稿的安装保留。

## 复验入口

```powershell
npm ci
npm test
npm run test:components
npm run test:sites
npm run electron:dist
npm run test:packed -- ".\release\win-unpacked\知行.exe"
node scripts/verify-packed-sources.mjs
npx --no-install electron-builder --prepackaged release/win-unpacked --win nsis --x64
node scripts/verify-brand.mjs "release/win-unpacked/知行.exe" "release/知行-0.12.0-x64.exe"
```

页面旅程脚本为 `scripts/test-kernel-privacy-ui.mjs`、`scripts/test-conversation-ui.mjs --phase all` 与 `scripts/test-ui.mjs pages`；必须使用隔离实例和合成项目。安装生命周期由 `scripts/qa-install-lifecycle.ps1` 执行，先 Inspect，只允许无冲突注册/进程、冷字节备份和同 SID 合成 fixture，不停止其他应用或使用真实资料。

[外部审计说明](audit-request.md) · [内核能力地图](harness-capability-map.md) · [历史 0.11.0 验收](windows-acceptance-0.11.0.md)
