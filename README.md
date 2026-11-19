# 知行 ZhiXing

知行是一款基于 DeepSeek Harness 的 Windows AI 办公助手。你可以在项目工作区里整理文档、核对表格、安排定时任务，并查看每次交办的执行过程。

- **文档与资料**：读取 Word、Excel、PPTX、PDF 和扫描件，支持 Windows 本机 OCR，导出可编辑的办公成果。
- **项目工作区**：在同一个窗口查看项目文件、网页和终端，按需把资料加入交办。
- **任务与连接**：支持定时任务、协作子任务，以及模型服务、MCP 和 Harness 插件连接。
- **本地脱敏**：默认在本机按规则处理发送给模型的文本，已配置的模型凭据由 Windows 加密存储。

## 从源码运行

验证环境为 Windows x64、Node.js 24.19.0 和 npm 11。Git 工作树需要本机 Git 和可设置沙箱权限的仓库目录。

```powershell
npm ci
npm run build
npm run electron
```

在桌面端的供应商设置中配置模型服务。源码回归使用本机合成服务，无需真实模型密钥。

```powershell
npm test
npm run test:browser
npm run test:sites
```

## 当前版本

0.11.0 的首个源码预览供审计使用。完整源码回归通过 50 项，包含 PNG 转 WebP 导入和 Git 工作树创建、恢复。Windows 工作树界面验收尚未走完，图片视觉输入、供应商 OAuth 和完整会话迁移仍在验收范围内。Windows 安装包将在功能验收与逐页复测通过后发布。

- [Harness 能力验收表](docs/harness-capability-map.md)
- [Windows 对照验收记录](design-qa.md)
- [ChatGPT 审计任务说明](docs/audit-request.md)
