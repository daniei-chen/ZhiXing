# 知行 0.12.4 Windows 验收记录

记录日期：2026-11-22，Asia/Shanghai。版本为 Windows x64 未签名预发布候选，内核固定 DeepSeek Harness `0.2.2-rc.5`。本文严格区分源码确认、合成运行、Windows 实包、真实云端验证和待验范围。

## 当前已确认

| 层级 | 结果 | 证据 |
| --- | --- | --- |
| 源码全量 | **338 项，337 通过，0 失败，0 取消，1 条件跳过** | `.preview/qa-0.12.4/lead/source-full.log`（构建后归档） |
| 视觉回环 | **通过** | `tests/runtime-vision.test.mjs`；真实 Windows OCR、遮罩副本、Harness SDK 图片块、本机 Messages 收件 |
| 图片出站边界 | **通过** | 原图 base64 不在上游请求；遮罩副本 base64 在请求；`image` block 存在；执行一次 |
| 模型模态门槛 | **通过** | 未声明 `image` 的模型在发送前返回 `VISION_MODEL_UNSUPPORTED`，不静默换模型 |
| 原图隔离 | **源码确认** | renderer/工作区只保存视觉 UUID、哈希、策略和覆盖范围；副本由主进程重读并校验 |

## 待构建字段

以下字段在生产代码提交后、使用干净构建提交构建和验收，填写实际值；在填写前不得宣称安装包完成：

| 项目 | 结果 |
| --- | --- |
| 生产构建提交 | 待填 |
| 包内 provenance / source fingerprint / lock SHA | 待填 |
| `release/知行-0.12.4-x64.exe` 字节与 SHA-256 | 待填 |
| blockmap 与应用 EXE SHA-256 | 待填 |
| `npm run test:components` / `npm run test:sites` | 待填 |
| `npm run test:packed` | 待填 |
| Windows 页面矩阵与业务旅程 | 待填 |
| NSIS 安装、升级、覆盖、卸载保留、重装 | 待填 |
| 品牌资源校验 | 待填 |

## 已接入与未覆盖

已接入的视觉垂直切片包括：Windows OCR 词框、主进程规则命中、PNG 遮罩副本、官方 attachment-local、本机 SDK 图片块、DeepSeek 原生视觉路由、兼容 Messages/Chat 网关图片边界和能力 manifest 条件。源码回环证明的是本机合成收件服务中的真实字节和执行次数。

仍未覆盖：真实云端账户和模型质量、无文字图像敏感内容、OCR 漏检、图表/手写/复杂版式、全面 NER、浏览器截图自动进入模型、跨 Windows 账户解密、交互式安装、物理 DPI、真人麦克风、全量读屏、常驻 Host、OAuth、Responses/Gemini、独立搜索和跨启动 live jobs。

普通脱敏继续自动处理，不增加逐次发送确认；raw/非脱敏模式仍阻断凭证。遮罩只覆盖 OCR 识别且命中现有规则的区域，不能写成全面图片隐私处理。
