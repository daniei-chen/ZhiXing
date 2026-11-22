# 知行 0.12.3 Windows 验收记录

记录日期：2026-11-22，Asia/Shanghai。版本为 Windows x64 未签名预发布候选，内核固定 DeepSeek Harness `0.2.2-rc.5`。本文区分源码确认、合成运行、Windows 实包、真实云端验证和待验范围；所有安装器、provenance 和生命周期字段均来自本版实际构建与验收。

## 源码与组件门禁

| 层级 | 当前结果 | 证据 |
| --- | --- | --- |
| 完整源码 | **337 项，336 通过，0 失败，0 取消，1 条件跳过** | `.preview/qa-0.12.3/lead/source-full.log` |
| OCR/文档/上下文聚焦回归 | **20/20** | `.preview/qa-0.12.3/lead/focused-ocr-plan.log` |
| Windows Electron 组件与隔离旅程 | **14/14** | `.preview/qa-0.12.3/lead/components.log` |
| 前端构建 | **通过** | `.preview/qa-0.12.3/lead/build.log` |
| Sites worker | **4/4** | `.preview/qa-0.12.3/lead/sites.log` |

唯一条件跳过是 Windows 文件符号链接权限条件。没有用 skip、删断言或截图数量让源码门禁变绿。

## 0.12.3 真实修复覆盖

- 图片工具：Windows 本机 OCR → `office_read_file` → 任务脱敏映射 → 本地 Messages 回环；原始电话和图片字节均不出站，最终文本在本机还原。
- 规划命令：`/plan` 不增加模型请求，并在返回结果的 `context.planning` 中报告 `true`；`/plan off` 的下一次状态检查按命令目标等待 `false`。
- 取消：OCR PowerShell 子进程接收 `AbortSignal`，取消路径不留下继续工作的本机识别进程。
- 既有边界：R01 动态键/schema、R02 交付审阅、R03/R04 退出与保存恢复、R05/R07/R08 删除/终态/失败恢复/资料去重、R09 锁恢复、R10 目录分页和能力清单继续由源码回归覆盖。

## 最终安装包门禁

以下字段必须来自 0.12.3 同一构建，不能沿用 0.12.2 的旧指纹：

| 资产或门禁 | 结果 | 证据 |
| --- | --- | --- |
| 构建源码提交 | **`621a26112afe720399c583ef537f1e8e96b5a8f5`** | `release/win-unpacked/resources/app/build-provenance.json` |
| 包内 provenance | **79 个业务文件匹配；source fingerprint `68b95aad07df7bb8805b68091e2dd4bd54d9d94bf6de2ef1d0337011c2e288f8`；`sourceDirty=false`；Node `v24.19.0`；lock SHA `944c4dc6d91dc8169a762801ca5d1bfc067cbcaf16d19678557e86109322e1a4`** | `.preview/qa-0.12.3/lead/packed-source-manifest.json` |
| 目录包包内回归 | **305 项，304 通过，0 失败，0 取消，1 条件跳过** | `.preview/qa-0.12.3/lead/packed-test.log` |
| Windows renderer 页面与业务旅程 | **内核隐私 15/15；交付 7/7；运行恢复 8/8；审计会话 8/8；既有会话 12/12；页面矩阵 336/336** | `.preview/qa-0.12.3/lead/windows-*.log`；`.preview/qa-0.12.3/audit/` |
| `知行-0.12.3-x64.exe` | **562,803,952 bytes；未签名** | `release/知行-0.12.3-x64.exe` |
| 安装器 SHA-256 | **`3954C5785DF26EF110DC0B156BA4B4397670153E2E90BE98245B87F9451F0B26`** | `.preview/qa-0.12.3/lead/assets-0.12.3.json` |
| blockmap | **489,676 bytes；`9E53F84EBCA7A7AE1F18CA6DFAA953C361809CA2719B671724B5BD7CDC26A101`** | `release/知行-0.12.3-x64.exe.blockmap` |
| 应用 EXE SHA-256 | **`54D1B7C25FF13566782268593292718B4061E0AA1E01A456F3A6B6C7D83E15A1`** | `release/win-unpacked/知行.exe` |
| 品牌资源 | **应用 EXE 与安装器各 9 个墨竹图标尺寸；原始 PNG SHA-256 未变** | `node scripts/verify-brand.mjs ...` |
| NSIS 升级、覆盖、卸载保留、重装 | **53 步骤，38 passed，15 observed，0 failed；`passed_configured_nonvisual_lifecycle`** | `.preview/qa-0.12.3/install-evidence-20261122-191249-5551e1e1/report.json` |

## DeepSeek Harness 与脱敏能力边界

已真正接入并由源码、合成运行或本版 Windows 实包确认的范围包括：DeepSeek 原生路由、Chat Completions/Messages 兼容路由、用户指定的 provider/model/reasoning 严格校验；Agent Teams；受项目与完全访问门槛约束的 PTC `run_code`；MCP 连接和工具；浏览器、终端、Office/PDF 文字提取；Windows OCR；Agent `office_read_file` 图片读取；SenseVoice 本机语音；运行时能力 manifest；自动化与工作流的本机调度；导出/分享审阅快照；脱敏映射隔离、动态键/schema 边界、凭证强制阻断、工具结果保护、失败/取消/退出/重启恢复。

本版的 OCR 证据只证明：原图由本机读取，识别文字经过现有隐私网关后才进入模型，原始图片字节不会出站。模型视觉、原图遮罩、扫描版式的完整理解和全面 NER 仍未接入。

## Windows 实包与安装生命周期

0.12.3 真实目录包正常退出已通过，应用退出码为 0。包内回归为 **305 项，304 通过，0 失败，0 取消，1 条件跳过**；条件跳过仍是 Windows 文件符号链接权限不足时的 `owner.json` 符号链接测试。页面矩阵不是全部内核能力的覆盖率，安装生命周期使用隔离 profile 和合成资料，不替代真实用户资料或真实云端验收。

NSIS 生命周期在同一 Windows SID 下用 0.12.0 历史安装器建立合成资料，再完成 0.12.3 首次安装、历史升级、同版覆盖、默认卸载保留、重装保留和包外 cwd 启动。项目、聊天、草稿、MCP、供应商和加密配置的读回与字节保持均通过；报告明确把视觉验收和跨 Windows 账户解密列为范围外。该报告没有读取或解密真实用户资料。

## 真实云端验证与未覆盖

本轮没有真实云端账户矩阵、真实用户 API Key、真实业务资料、交互安装、所有用户安装、跨 Windows 账户解密、普通卸载快捷方式清理、物理 DPI、真人麦克风、完整读屏和大规模压力验收。常驻 Host、跨启动 live jobs/MCP、MCP/供应商 OAuth、独立搜索、Responses/Gemini、异构子模型路由、模型视觉、原图打码、全面 NER、增量加密事件/Blob、完整原生 Office/文件工具、typed XLSX、正式 DOCX 模板和真实 Git 插件安装仍待专项验证。

普通脱敏继续自动处理，不增加逐次确认；raw/非脱敏模式仍阻断凭证。能力清单中的 `registered/effective/enabled/blockedReason` 只说明当前注册目录、路由和门槛，不把同名工具、配置开关或目录存在升级为已接入。

## 证据与发布收口

GitHub 发布资产使用公开名 `ZhiXing-0.12.3-x64.exe`、对应 blockmap、SHA-256 清单和本页。QA 脚本的动态版本 profile 门禁修改发生在构建后，未进入该二进制；它们随文档收口提交发布。不得覆盖已存在的 `v0.12.2` 标签或发行页。
