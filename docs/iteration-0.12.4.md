# 知行 0.12.4 · 模型视觉、原图遮罩与脱敏边界

本轮从 0.12.3 继续，内核固定为 DeepSeek Harness `0.2.2-rc.5`。目标是把图片资料从“本机 OCR 文字”扩展为可验证的模型视觉输入，并先在本机主进程完成敏感区域遮罩。

## 本轮修改

- Windows OCR worker 返回行级和词级 bounding box，同时保留原有 OCR 文本接口和取消语义。
- 新增 `electron/visual-attachments.mjs`：主进程读取图片，使用现有隐私规则检查 OCR 文本，在命中的词框上生成 PNG 遮罩副本。副本保存于应用私有目录，返回 UUID、哈希、策略和覆盖范围；原图字节不进入 renderer 工作区。
- 运行时挂载官方 `@deepseek-ai/dsh-attachment-local`，并将已批准的遮罩副本通过 SDK 编码图片块送入 Harness。模型目录保留并传递 `inputModalities`，未声明 `image` 的模型发送前拒绝。
- 网关对 DeepSeek Messages、Anthropic Messages 和 OpenAI Chat Completions 的图片块进行 base64、MIME、SHA-256 和本次交办批准集合检查。任何未由主进程准备的图片字节都会被拒绝。
- `office-tools` 继续拒绝通用文件附件；图片附件走官方视觉 attachment 路径，不把 OCR 文本冒充视觉输入。
- 能力 manifest 新增视觉项，区分真实模型模态、本次视觉副本准备状态和阻断原因。

## 证据

`tests/runtime-vision.test.mjs` 是本轮核心回环：在 Windows 上运行真实 Harness 和本机 Messages 收件服务，断言模型请求包含 `image` 内容块和遮罩副本 base64，原始图片 base64 不出站，且一次交办只产生一次模型请求并正常收尾。

源码门禁为 `npm test` **338 项，337 通过，0 失败，0 取消，1 条件跳过**；组件 **14/14**，Sites **4/4**。唯一条件跳过仍是 Windows 不授予文件符号链接权限时的 owner symlink 测试；真实 junction、恶意元数据和 owner-file symlink 检查仍执行。0.12.4 目录包回归为 **305 项，304 通过，0 失败，0 取消，1 条件跳过**，Windows 页面矩阵为 **336/336**，安装生命周期为 **53 步，38 passed，15 observed，0 failed**。这些数字均来自同一生产包，详见 Windows 验收记录。

## 脱敏边界

脱敏模式会自动处理文本、OCR 结果和图片中 OCR 命中规则的区域，不增加逐次确认。非脱敏模式可以保留普通信息，但凭证仍强制阻断。当前遮罩只覆盖 OCR 识别且现有规则命中的词框；OCR 漏检、无文字图像中的敏感内容、图表语义和通用 NER 仍可能未覆盖。遮罩副本不是完整的视觉隐私保证，重要资料仍需人工检查。

## 未覆盖范围

本轮仍未证明真实云端账户矩阵、所有真实视觉模型的质量、复杂扫描版式、图表/手写/无文字敏感内容的召回、全面 NER/Presidio、浏览器截图自动进入模型、跨 Windows 账户解密、交互式安装、物理 DPI、真人麦克风、全量读屏、常驻 Host、OAuth、Responses/Gemini、独立搜索和跨启动 live jobs。

生产包构建、provenance、SHA-256、Windows 实包旅程和 NSIS 生命周期已在 [0.12.4 Windows 验收记录](windows-acceptance-0.12.4.md) 以同包证据收口。真实云端视觉质量、OCR 漏检、无文字敏感内容、图表/手写理解和全面 NER 仍未验收。
