# 0.42.0 外部审计入口

## 确认构建

以 [v0.42.0 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.42.0) 的实际 tag、`build-provenance.json`、`packed-source-manifest.json` 和 `acceptance-summary-0.42.0.json` 确认版本与源码。发行页未出现时仍为候选，文档不能证明发布完成。安装器为未签名 Windows x64 预发行包。

先核对 `SHA256SUMS-release.txt` 内其他 17 件资产；该清单不做自引用，流水线外部 manifest 记录全部 18 件。EXE 哈希不能代替散装应用的源码指纹。各层实际结果、跳过和观察项分别记录，不能把本地合成模型运行写成真实云端。

## 检查顺序

1. 阅读 [本轮说明](iteration-0.42.0.md)、[Harness 核对与边界](workbench-preview-0.42.0.md) 及上游 JSON。固定功能标签不是完整动态资源 Dock，提取文字不是 Office 原版面。
2. 审查 `src/WorkbenchTabs.jsx`、`workbench-tabs.css` 和 `Workbench.jsx`：九视图均连接既有面板，标签和面板的 ID/ARIA 对应，键盘焦点、选中态及滚动一致；浏览器原生视图仍按可见性和模态状态隐藏。
3. 审查 `src/App.jsx`、`use-delivery-preview.js` 和 `DeliveryPreview.jsx`：读取先查列表、后提交签名 ID；新旧请求、同项目不同聊天、关闭、返回列表、卸载和 StrictMode 均有明确作用域。晚到列表不能继续发起正文读取，晚到正文不能覆盖新文件。
4. 核对原有 `deliverables:list/read` 与 `DeliverableAccess` 授权链未被绕过：无任意路径直接读取，不扩展项目外权限，不把临时预览保存或发送给模型。解析已启动时只拒绝旧结果，不虚称主机任务已取消。
5. 阅读 `tests/delivery-preview-ui.test.mjs` 及夹具、`tests/workbench-tabs-ui.test.mjs`。真实 renderer 使用合成 IPC 验证竞态；其证据不能代替主机 HMAC、真实文件或 Windows 桌面。
6. 检查 `scripts/test-workbench-preview-ui.mjs`：临时 profile 内由真实 Harness 写入并 present 两份文件，断言磁盘和保存内容；检查卡片/行内引用/放大、文件移走与重试、九视图、键盘、聊天切换、草稿及深色窄窗口。主机异常退出或清理失败也应令门禁失败。截图原始真人待审状态不能被自动脚本改为真人已审。
7. 检查 `workbench` 在 PR 打包、正式发行、必需门禁、摘要和证据收集中的完整接线。发布仅允许精确 main 源码，通过全部门禁并逐项核验 18 资产后公开。新 draft 查询缺失可有界重试，身份不同或 API 报错必须立即失败。
8. 检查 `harness/privacy-bridge.mjs` 的 `renameEncryptedTemp` 及 `electron/main.cjs` 的调用范围：仅工作空间与草稿保存复用 Windows 有界替换，不先删除旧目标，不推进未提交 revision。将两条真实 Windows 无删除共享句柄测试、两条保存队列回归与 Phase 1 实包结果分别核对；夹具中的 `EPERM` 不能用于认定首次失败的实际文件占用者。
9. 将本轮原始日志与候选失败一并读取。Linux 基线三项已知失败单列在 `evidence/0.42.0/linux-baseline-failures.json`；不可删去或将其转写为 Windows 失败/通过。

## 发布后核验入口

正式发布的源码提交为 `1639c63c9273181fa8f63d9bdd5ed86178aafe1f`；后续文档提交不能替代该二进制身份。[正式证据归档](evidence/0.42.0/final/) 同时提供原始日志、成功收据、18 项资产的独立远端核验、AI 截图复核及逐文件清单。首次正式发布失败单独保留在 [release-attempt-1](evidence/0.42.0/release-attempt-1/README.md)。已发布资产保留构建时原字节，本段是发布后的仓库文档补记。

## 未覆盖

用户本机安装生命周期、代码签名、真实云端办公评测、跨账户解密、自动更新全链路、恶意本机进程下原子目录沙箱、完整资源 Dock 和全量 Harness 机制均没有本轮验收结论。长文本预览只有明确上限，不是分页虚拟文档。常驻内核、增量数据库和专业 Office 交付仍在后续路线。
