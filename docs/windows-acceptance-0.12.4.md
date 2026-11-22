# 知行 0.12.4 Windows 验收记录

记录日期：2026-11-22，Asia/Shanghai。版本为 Windows x64 未签名预发布候选，内核固定 DeepSeek Harness `0.2.2-rc.5`。本文区分源码确认、合成运行、Windows 实包、真实云端验证和待验范围；所有资产字段均来自同一 0.12.4 生产构建。

## 同包资产与门禁

| 层级 | 结果 | 证据 |
| --- | --- | --- |
| 构建源码提交 | **`2e5db25458eb60897449e37e718cd4ac8b9a7266`** | `release/win-unpacked/resources/app/build-provenance.json` |
| 包内 provenance | **`sourceDirty=false`；Node `v24.19.0`；lock SHA `83d1d4536ef2346ed19bce141f24e5693b11eef0f70ae51c09e991583826bb60`** | 同上 |
| 包内 source manifest | **80 个业务文件匹配；source fingerprint `d4376bf01aef58401c7bfaf0e04fbbf51d29cab0584472fca67f79a7b0aa6a85`** | `.preview/qa-0.12.4/packed-source-manifest-0.12.4.json` |
| 源码全量 | **338 项，337 通过，0 失败，0 取消，1 条件跳过** | `npm test` 终态记录；唯一跳过为 Windows 文件符号链接权限条件 |
| 组件 | **14/14** | `npm run test:components` |
| Sites worker | **4/4** | `npm run test:sites` |
| 目录包回归 | **305 项，304 通过，0 失败，0 取消，1 条件跳过** | `npm run test:packed -- ".\\release\\win-unpacked\\知行.exe"` |
| 应用 EXE | **246,317,568 bytes；SHA-256 `3BBB30BCD4A139CED609348BF70953178777EDFE3C51994406A5EBF463159575`** | `release/win-unpacked/知行.exe` |
| 安装器 | **562,809,342 bytes；SHA-256 `6F2FF27B5DEA129A45690955B7272E54105DEBA8C546A081C278FA42F1F9ECC3`** | `release/知行-0.12.4-x64.exe` |
| blockmap | **489,641 bytes；SHA-256 `3E2FD34629BEB23E3262F8478D1A4D6FC74EE55D10134407D89D0825E223231A`** | `release/知行-0.12.4-x64.exe.blockmap` |
| 品牌资源 | **应用 EXE 与安装器均为 9 个墨竹图标尺寸；原始 PNG SHA-256 未变** | `node scripts/verify-brand.mjs ...` |

## 视觉输入和脱敏边界

| 检查 | 结果 | 证据与解释 |
| --- | --- | --- |
| 视觉回环 | **通过** | `tests/runtime-vision.test.mjs` 使用真实 Windows OCR、主进程遮罩副本、官方 `attachment-local`、SDK `image` block 和本机 Messages 收件 |
| 图片出站边界 | **通过** | 收件请求包含遮罩副本 base64 和 `image` block，不包含原图 base64；一次交办只产生一次模型请求 |
| 模型模态门槛 | **通过** | 未声明 `image` 的模型发送前返回 `VISION_MODEL_UNSUPPORTED`，不静默换模型 |
| 原图隔离 | **通过源码确认** | renderer/工作区只保存 UUID、哈希、隐私策略和覆盖范围；主进程发送前重读并校验批准副本 |

普通脱敏继续自动处理，不增加逐次发送确认；raw/非脱敏模式仍阻断凭证。遮罩只覆盖 OCR 识别且命中现有规则的词框，不能宣称覆盖所有图像隐私内容。

## Windows 实包业务旅程

| 旅程 | 结果 | 证据 |
| --- | --- | --- |
| 内核/隐私设置与能力目录 | **15/15** | `.preview/qa-0.12.4-audit/windows-kernel-privacy-0.12.4/journey.json` |
| 交付边界 | **7/7** | `.preview/qa-0.12.4-audit/windows-delivery-0.12.4/journey.json` |
| 运行恢复与保存重试 | **7/7** | `.preview/qa-0.12.4-audit/windows-runtime-recovery-0.12.4/result.json` |
| 审计会话、删除级联与资料去重 | **8/8** | `.preview/qa-0.12.4-audit/windows-audit-conversation-0.12.4/result.json` |
| 既有会话、双供应商、侧边聊天与流式停止 | **12/12** | `.preview/qa-0.12.4-audit/windows-conversation-0.12.4-rerun/journey.json` |
| 页面/入口/面板矩阵 | **336/336** | `.preview/qa-0.12.4-audit/windows-pages-0.12.4-rerun/pages.json` |
| 实包正常关闭 | **通过，退出码 0** | `.preview/qa-0.12.4-audit/lead/qa-normal-exit-final.json` |

页面矩阵覆盖三种窗口尺寸、100%/125%/150%/200% 缩放、设置页、三个顶栏入口和八个工作面板。第一次运行因前一轮实包已正常退出而连接失败，未计入通过数；随后重新启动同一目录包，最终 `pages.json` 为 336 条全通过记录。

## NSIS 安装生命周期

报告：`.preview/qa-0.12.4/install-evidence-20261122-220223-bfde781b/report.json`

最终状态为 **`passed_configured_nonvisual_lifecycle`**：53 步中 **38 passed、15 observed、0 failed**。同一 Windows SID、同一候选安装器和合成资料完成首次安装、0.12.0 历史升级、0.12.4 同版覆盖、默认卸载保留、0.12.4 重装保留、包外 cwd 启动和最终清理。项目、聊天、草稿、MCP、供应商和加密配置的实际读取与字节保持均通过；产品注册项、原快捷方式字节和默认 AppData 冷备份恢复到运行前状态。

生命周期证据不代表真实用户资料迁移、跨 Windows 账户解密、交互式安装、所有用户安装、普通卸载快捷方式清理或真实云端账户矩阵。报告明确将视觉验收和跨 Windows 用户解密列为范围外。

## 未覆盖范围

本版没有证明真实云端账户和模型质量、所有视觉模型的输出效果、OCR 漏检、无文字图像敏感内容、图表/手写/复杂扫描版式理解、全面 NER/Presidio、浏览器截图自动进入模型、跨 Windows 账户解密、交互式安装、物理 DPI、真人麦克风、全量读屏、常驻 Host、OAuth、Responses/Gemini、独立搜索和跨启动 live jobs。Office 复杂排版、typed XLSX、正式 DOCX 模板、任意原生文件编辑工具和恶意插件/归档场景也没有由本版扩展验收。

外部审计应同时核对源码标签、安装器、blockmap、应用 EXE、`SHA256SUMS-release.txt`、包内 provenance/source manifest、Windows 页面/旅程 JSON 和 NSIS lifecycle report。安装包未签名，下载后应先核对 SHA-256。
