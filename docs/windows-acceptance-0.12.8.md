# 知行 0.12.8 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。 [迭代记录](iteration-0.12.8.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.12.8)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `4e3dbe9b8c7ba6208a16426fa9ec7562b386fe56`，`sourceDirty=false`，Node `v24.19.0` |
| 源码指纹 | `e44ea16a79b9f4516b2d24a93a4dcb3f7a916300502519a0d3113a5c27b0dcf5`，88 个匹配文件 |
| 锁文件 SHA-256 | `79be20a2d65c8a6df8aa9fb3f27bf403cbd5635f30d2a2b5d43e5d42f7ce48ba` |
| 源码回归 | 355 项，354 通过，0 失败，0 取消，1 条件跳过 |
| 组件与 Sites | 14/14、4/4；生产构建通过 |
| 目录包回归 | 323 项，322 通过，0 失败，0 取消，1 条件跳过 |
| Windows 桌面专项 | 5/5；真实目录包、真实 Harness、本机合成 Chat Completions |
| 品牌核对 | 应用与安装器各 9 种图标尺寸，原始墨竹素材未变 |
| `知行.exe` | 246,317,568 bytes，SHA-256 `e19e7888b8e784d7c0a79707347089a69e88605a03dc69f7bb90d9b60cf7ac36` |
| `知行-0.12.8-x64.exe` | 562,833,580 bytes，SHA-256 `21326fcfc4fafc93f523b4f73b8500aed94c2c4eff81a422beedb4ce4e6a7df6` |
| `知行-0.12.8-x64.exe.blockmap` | 489,719 bytes，SHA-256 `34f3c52ca9d9832d33bea6937b66d8b240ec912d33ba2c20bd4f7303a57d564d` |
| 安装器签名 | `NotSigned` |

安装器由该次验收的目录包以 `--prepackaged` 构建。源码与目录包回归各因 Windows 未授予文件符号链接权限跳过一项 `owner.json` 测试。

## 本轮能力实测

- **会话工作目录。** 在真实 Harness 中，合成项目切到 `section` 后：`read` 读到子目录中的同名文件而不是根目录版本；`write` 落在子目录并触发且仅触发一次审批，项目根的 `result.txt` 不存在；`grep` 只在子目录命中。`working_directory ../..` 被拒绝，其后的会话文本不受影响。重开会话后目录保持，`working-directory/change` 事件记录实际目录。能力清单新增「Harness 会话工作目录」，工具目录包含 `working_directory`，随内核开关启停。
- **目录边界。** 切换目标必须是项目内已存在的真实目录；项目外路径、符号链接与含凭证的路径在切换前拒绝。原生文件、Office 文档与导出工具的既有行为不变：完整回归与目录包回归均为 0 失败。

## 桌面业务实测

真实目录包、合成供应商与本机 Chat Completions 收件，共 5 项通过：

- Windows 当前执行权限触发原生 `write` 审批，拒绝后没有写入文件。
- 实际批准的多文件补丁停在第 1/3 步，已写的 `committed.txt` 保留，`large.txt` 与 `skipped.txt` 未改变。
- Office 转换的真实桌面审批可批准，PDF 有效且源 DOCX 保持原字节。
- 重启后保留补丁终态；Markdown 按所选历史和已审阅快照保存准确字节，零新增出站。
- 保存对话框打开期间移动会话，旧快照不再允许写盘。

## 生产依赖与证据范围

审核覆盖 1,170 个实际随包安装路径，npm CLI `11.21.3`。锁投影审计为 0 high、0 critical、34 moderate 影响记录，其中 3 条公告直接命中安装路径。Electron、Node、原生库内部和用户自行安装的插件另验。

安装、升级、卸载与重装生命周期在本轮未复跑：本轮改动位于应用内代码，未改 NSIS 配置、数据格式与加密存储，`0.12.6` 的同账户合成资料生命周期证据不被本轮继承，也不据此宣称通过。真实云服务、交互式安装、跨账户解密和真实用户档案迁移未覆盖。工作目录的执行轨迹标签由事件映射实现，本轮的桌面专项未单独点击验证该标签，证据来自源码回归与目录包回归。原生 ZIP、完整子会话与附件字节归档、跨启动文件观察、原生 Auto reviewer、常驻 Host 与 OAuth 仍有缺口。图片遮罩限于 OCR 识别到且命中规则的文字；全面 NER、OCR 漏检、手写、二维码、人脸和图表语义未覆盖。
