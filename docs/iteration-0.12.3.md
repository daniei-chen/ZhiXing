# 知行 0.12.3 · 图片资料 Agent 接线与规划状态收口

本轮从已发布的 `v0.12.2` 继续，内核仍固定 DeepSeek Harness `0.2.2-rc.5`。本轮先复现并修复两个真实回归，再把 Windows 本机 OCR 从资料入口接到 Agent 的 `office_read_file`，形成可审阅的补丁版安装包。0.12.2 的锁恢复、目录分页、多份草稿恢复和能力状态清单仍按 [0.12.2 Windows 验收记录](windows-acceptance-0.12.2.md) 作为历史包证据。

## 本轮修改

- **Agent 图片读取**。`office_read_file` 现在支持 PNG、JPEG、BMP 和 TIFF。文件仍由主机读取，Windows 本机 OCR 只返回识别文字和 `ocr-text` 覆盖范围；原始图片字节不会进入模型请求。OCR 结果经现有任务脱敏映射和凭证阻断后才作为工具结果交给模型。
- **规划状态收口**。`/plan` 和 `/plan off` 结束后按命令目标等待上下文投影，避免命令文本已经返回而 `context.planning` 仍显示旧状态。该修复保留无模型请求的原生命令语义。
- **OCR 取消**。资料读取的 `AbortSignal` 传给 PowerShell OCR 子进程；取消会终止本机识别，而不是只在启动前后检查。
- **回归入口**。新增真实 Windows OCR 到 Harness、模型回环和本机还原的测试，并将其加入源码和包内测试入口。

## 已验证结果

源码和 Windows 组件的最终数字、安装器校验值及证据路径见 [0.12.3 Windows 验收记录](windows-acceptance-0.12.3.md)。当前已完成的门禁为：

| 门禁 | 结果 |
| --- | --- |
| `npm test` | 337 项，336 通过，0 失败，0 取消，1 条件跳过 |
| `npm run test:components` | 14/14 |
| `npm run test:sites` | 4/4 |
| `npm run build` | 通过 |
| `npm run test:packed` | 305 项，304 通过，0 失败，0 取消，1 条件跳过 |
| OCR/文档/上下文聚焦回归 | 20/20；包含真实 Windows OCR、图片工具出站脱敏和规划状态投影 |

唯一条件跳过是 Windows 不授予文件符号链接权限时的 `owner.json` 符号链接测试；真实 junction、owner-entry junction、恶意元数据和不确定 PID 检查仍执行并通过。组件日志中故意注入的 `SYNTHETIC_*_FAILED` 是失败恢复路径的输入，随后相应断言通过。

## DeepSeek Harness 与脱敏边界

本轮确认的是本机接线和边界行为：DeepSeek 原生及兼容路由继续保留用户指定的 provider、model 和 reasoning；图片资料通过 Agent 办公工具进入本机 OCR，再沿同一任务隐私映射发送。真实回环检查了原始电话号码和图片 Base64 均不在模型线缆中，模型最终可在本机还原受保护 OCR 文字。

这不代表模型视觉已经接入。模型没有收到原始图片，扫描页版面、图表理解和原图打码仍未覆盖；也不代表规则可以识别所有敏感信息。普通脱敏继续自动处理，不增加逐次发送确认；凭证在 raw/非脱敏模式仍单独阻断。

## 未覆盖范围

常驻 Host、跨启动 live jobs/MCP、MCP 或供应商 OAuth、独立搜索连接、Responses/Gemini、异构子模型路由、模型视觉、原图遮罩、全面 NER、任意编码识别、增量加密事件/Blob、完整原生文件与 Office parity、typed XLSX、正式 DOCX 模板、Git 实际插件安装、交互式安装、跨账户解密、真人麦克风、物理 DPI、完整读屏和大规模压力仍待专项验证。Windows OCR 只证明本机文字提取和脱敏文本出站，不能扩大为原图隐私处理或视觉能力。

本版 Windows 安装生命周期使用同一 Windows 账户、隔离 profile 和合成资料。它不能证明真实用户资料迁移、跨账户解密、交互式安装或真实云端账户矩阵。生产包对应的目录包回归、页面旅程、安装生命周期、包内 provenance 和哈希以同一包的专项验收记录为准。

## 版本与构建身份

生产包由提交 `621a26112afe720399c583ef537f1e8e96b5a8f5` 构建，`sourceDirty=false`，79 个业务文件匹配，source fingerprint 为 `68b95aad07df7bb8805b68091e2dd4bd54d9d94bf6de2ef1d0337011c2e288f8`，Node 为 `v24.19.0`，lock SHA-256 为 `944c4dc6d91dc8169a762801ca5d1bfc067cbcaf16d19678557e86109322e1a4`。安装器 SHA-256 为 `3954C5785DF26EF110DC0B156BA4B4397670153E2E90BE98245B87F9451F0B26`，应用 EXE SHA-256 为 `54D1B7C25FF13566782268593292718B4061E0AA1E01A456F3A6B6C7D83E15A1`。文档收口提交可能晚于二进制构建提交，文档和 QA 适配不会被冒充为包内生产代码。
