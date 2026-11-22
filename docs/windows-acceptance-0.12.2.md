# 知行 0.12.2 Windows 验收记录

记录日期：2026-11-22，Asia/Shanghai。版本为 Windows x64 未签名预发布候选，内核固定 DeepSeek Harness `0.2.2-rc.5`。本文区分源码确认、合成运行、Windows 实包、真实云端验证和待验范围；最终资产、provenance 和安装生命周期均来自本轮实际构建与验收。

## 源码与组件门禁

| 层级 | 当前结果 | 证据 |
| --- | --- | --- |
| 完整源码 | **335 项，334 通过，0 失败，0 取消，1 条件跳过** | `.preview/qa-0.12.2/lead/source-full-pre-version-docs.log` |
| 能力清单和真实 Runtime 检查 | **7 项通过** | `.preview/qa-0.12.2/lead/capability-native-ui-second.log` |
| R09/R10/草稿恢复焦点回归 | **154 项，153 通过，0 失败，1 条件跳过** | `.preview/qa-0.12.2/lead/focused-integrated.log` |
| Windows Electron 组件与隔离旅程 | **14/14** | `.preview/qa-0.12.2/lead/components-0.12.2.log` |
| 前端构建 | **通过** | `.preview/qa-0.12.2/lead/electron-dist-0.12.2.log` |
| Sites worker | **4/4** | `.preview/qa-0.12.2/lead/sites-0.12.2.log` |

唯一条件跳过是 Windows 不授予文件符号链接权限时的 `owner.json` 符号链接测试。真实 junction、owner-entry junction、恶意元数据和不确定 PID 复现均已执行并通过。没有使用 skip 让完整源码门禁变绿。

## 本轮真实覆盖

- R09 覆盖主锁和 guard 在 mkdir 后、owner 写入前、发布前和发布后崩溃。覆盖活进程保护、死 owner 回收、同进程重入、并发 writer、token 替换、坏 owner、目录链接、junction、Windows 删除中错误和取消。
- R10 覆盖 0、1、119、120、121、1,000 和 10,001 个直接条目。121 项和 1,000 项按页完整返回。超过 10,000 项明确报错。结果保留排序、续页、总数、隐私处理、审批和目录变化检查。
- 草稿覆盖三份连续新草稿的可见列表、逐份回切、附件保留、JSON 文件重载、首次发送失败后的实际 chat 归属、删除项目后的迟到附件和较新编辑保护。真实 Electron renderer 旅程为 4 个检查点，草稿打开 7 次，页面重载 3 次，合成 `runPrepared` 1 次，模型请求 0 次。
- 能力清单覆盖注册目录、模型工具声明、PTC `run_code` 直达、办公工具程序化调用，以及项目、权限、协议、联网、规划和开关条件。设置页对过期或失败的迟到检查结果会清空，不保留旧状态。

## 最终安装包门禁

构建、包内回归、Windows renderer、品牌资源和安装生命周期均来自同一生产构建链。包内 `build-provenance.json` 指向提交 `719cad9a56ee3434f4cc215b174dcf9f54629de1`，并记录 `sourceDirty=false`。

| 资产或门禁 | 结果 | 证据 |
| --- | --- | --- |
| 构建源码提交 | **`719cad9a56ee3434f4cc215b174dcf9f54629de1`** | `release/win-unpacked/resources/app/build-provenance.json` |
| 包内 provenance | **79 个业务文件匹配；source fingerprint `53fe751bc64f2fff683766a08989ca439861de302d1d249446571968566edba9`；Node `v24.19.0`；lock SHA `f01488ac2be5367e3e2361f7a7001ec002958620a86010b73d5c9696fa48c912`** | `.preview/qa-0.12.2/lead/packed-source-manifest-0.12.2.json` |
| 目录包包内回归 | **303 项，302 通过，0 失败，0 取消，1 条件跳过** | `.preview/qa-0.12.2/lead/packed-test-0.12.2.log` |
| Windows renderer 最终包 | **正常退出通过；品牌资源通过；页面矩阵 336/336** | `.preview/qa-0.12.2-audit/lead/qa-normal-exit-final.json`; `.preview/qa-0.12.2-audit/windows-pages-0.12.2-rerun2/pages.json` |
| `知行-0.12.2-x64.exe` | **562,803,697 bytes；未签名** | `release/知行-0.12.2-x64.exe` |
| 安装器 SHA-256 | **`6CEEDFCA7083546D30F56ABCFCC3F373E39C994E2E4D344D81D8DE43E3811C29`** | `SHA256SUMS.txt` / 发布页 |
| blockmap | **489,622 bytes；`BCD4C764F717C4CE3F447112AEF3CF354B94BC99819FBED2AAE07EAE82D156F5`** | `release/知行-0.12.2-x64.exe.blockmap` |
| 应用 EXE | **246,317,568 bytes；`CF670B47557E2733908A3B3609478B702B73001E0AA897A9F5C6D51A3DF48F43`** | `release/win-unpacked/知行.exe` |
| 品牌资源 | **应用 EXE 与安装器均为 9 个墨竹图标尺寸；原始 PNG 哈希保持** | `node scripts/verify-brand.mjs ...` |
| NSIS 升级、覆盖、卸载保留、重装 | **53 步骤，38 passed，15 observed，0 failed；状态 `passed_configured_nonvisual_lifecycle`** | `.preview/qa-0.12.2/install-evidence-20261122-163945-7cbee9c2/report.json` |

## 安装生命周期细项

同一 Windows 账户下，脚本使用 0.12.0 实际安装器建立合成历史资料，再执行 0.12.2 首次安装、历史升级、同版覆盖、默认卸载保留和重装。每个阶段均从包外 cwd 启动真实应用并通过 preload/主进程读取配置，不解密或读取真实用户资料。

| 项目 | 结果 |
| --- | --- |
| 首次安装和包外启动 | 通过；应用读回 3 个项目、1 个聊天、4 个草稿、1 个 MCP、1 个供应商 |
| 0.12.0 → 0.12.2 历史升级 | 通过；项目、聊天、草稿、MCP、供应商和加密配置哈希保持；同账户合成资料，不代表旧版真实草稿格式迁移 |
| 同版覆盖 | 通过；安装注册、应用 EXE、provenance 和配置字节保持 |
| 卸载保留 | 通过；产品注册移除，原用户默认数据和原快捷方式字节哈希恢复 |
| 重装保留 | 通过；重新注册 0.12.2，资料、草稿、MCP、供应商和加密文件可读 |
| 清理 | 通过；测试安装、注册和临时快捷方式清理完成，主机原有数据恢复 |

## Windows 实包页面与业务旅程

| 旅程 | 结果 | 证据层级 |
| --- | --- | --- |
| Agent 内核与隐私设置 | **15/15** | 真实 0.12.2 目录包、真实 preload/主进程、合成输入；覆盖 Unicode/零宽脱敏、凭证阻断、raw 模式、Teams 工具目录、禁用重启和默认恢复 |
| 交付边界 | **7/7** | 真实主进程写出 TXT/DOCX/XLSX 和剪贴板审阅；保存前策略变化、范围/格式/正文篡改均拒绝；原生保存对话框 UX 未测，使用合成选择适配器 |
| 运行恢复 | **8/8** | 真实 RuntimeManager/AutomationService/Harness/回环服务；覆盖退出未确认隔离、终态、ENOSPC、只保存重试、加密文件读回和执行次数不增加 |
| 审计会话 | **7/7 业务检查** | 真实失败恢复、流式取消、资料去重、附件上限、孤儿草稿、删除级联、加密文件和重载；早期原 QA 进程退出收尾超时，后续独立正常退出已通过，不把早期超时算作业务失败 |
| 既有会话 | **12/12** | 真实模型/供应商/推理档位、浏览器、来源、产出、侧边聊天、停止、导出和项目工作区旅程；本机合成服务，无真实云端账户 |
| 页面、入口和面板矩阵 | **336/336** | 3 个客户区尺寸 × 4 个内容缩放档；4 个工作区页面、14 个设置页、三顶栏入口、8 个面板；无横向溢出。截图证据与 DOM/尺寸断言一并保存 |

页面矩阵第一次运行在最后一个截图调用遇到 Chromium `Page.captureScreenshot` 超时；QA 采集层随后改为只对截图证据 best-effort，并保持所有 DOM、尺寸、入口和溢出断言严格失败。第二次完整运行 336/336 通过，未使用 skip 或删除断言。

## DeepSeek Harness 与脱敏能力边界

已真正接入并由源码、合成运行或 Windows 实包确认的范围包括：DeepSeek 原生路由、Chat Completions/Messages 兼容路由、用户指定的 provider/model/reasoning 严格校验；Agent Teams；默认关闭且受项目与完全访问门槛约束的 PTC `run_code`；MCP 连接和工具；浏览器、终端、Office/PDF 文字提取、本机 OCR、SenseVoice 本机语音；运行时能力 manifest；自动化与工作流的本机调度；导出/分享审阅快照；脱敏映射隔离、动态键/schema 边界、凭证强制阻断、工具结果保护、失败/取消/退出/重启恢复。

这些证据证明的是当前接线和边界行为，不代表所有 DeepSeek 上游产品能力已经全部接入，也不代表真实云端质量。下列范围仍未覆盖或未完成：常驻 Host、跨启动 live jobs/MCP、MCP/供应商 OAuth、独立搜索连接、Responses/Gemini、异构子模型路由、模型视觉输入、原图打码、全面 NER、任意编码识别、增量加密事件/Blob、完整原生文件与 Office parity、typed XLSX、正式 DOCX 模板、Git 实际插件安装、交互式安装、跨账户解密、真人麦克风、物理 DPI、完整读屏和大规模压力。

普通脱敏继续自动处理，不增加逐次确认。凭证即使在 raw/非脱敏模式也会阻断；未解析附件、模型视觉和原图遮罩不能标为已脱敏。能力地图中的 `registered/effective/enabled/blockedReason` 只说明当前注册目录、路由和门槛，不把同名工具、配置开关或目录存在升级为已接入。

## 未覆盖范围

本轮没有真实云端账户矩阵、真实用户 API Key、真实业务资料、交互安装、所有用户安装、跨 Windows 账户解密、普通卸载快捷方式清理、物理 DPI、真人麦克风、完整读屏和大规模压力验收。安装生命周期虽覆盖 silent NSIS 的安装、升级、覆盖、卸载保留和重装保留，但不覆盖交互式路径选择、跨账户数据迁移或用户真实资料升级。安装阶段耗时和包体大小也不能由功能门禁推断。

生产依赖的既有 moderate 影响记录仍按上一版清单和实际包内路径复核，不写成零风险。

## 发布提交与证据

生产包对应构建提交 `719cad9a56ee3434f4cc215b174dcf9f54629de1`。最终文档和 QA 采集适配会在后续提交中发布；它们不改变包内 provenance。发布材料包含 `SHA256SUMS.txt`、本页、能力地图、迭代记录、packed source manifest、完整 diff 和机器可读 Windows 生命周期/旅程证据。
