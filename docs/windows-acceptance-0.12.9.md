# 知行 0.12.9 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。本轮主题为安装包体积。 [迭代记录](iteration-0.12.9.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.12.9)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `2c5e007b82fff6baa76e6ddb2a0c451c97d9bec2`，`sourceDirty=false`，Node `v24.19.0` |
| 源码指纹 | `e44ea16a79b9f4516b2d24a93a4dcb3f7a916300502519a0d3113a5c27b0dcf5`，88 个匹配文件 |
| 锁文件 SHA-256 | `31ee8318aab991c3a4414c238d247b3b942b1129840e0981f9789ca432226e97` |
| 源码回归 | 355 项，354 通过，0 失败，0 取消，1 条件跳过 |
| 组件与 Sites | 14/14、4/4；生产构建通过 |
| 目录包回归 | 323 项，322 通过，0 失败，0 取消，1 条件跳过 |
| Windows 桌面专项 | 5/5；真实目录包、真实 Harness、本机合成 Chat Completions |
| 品牌核对 | 应用与安装器各 9 种图标尺寸，原始墨竹素材未变 |
| 裁剪 | 67,865 个文件、636 MB；应用目录 1,454 → 818 MB |
| `知行.exe` | 246,317,568 bytes，SHA-256 `85745f21df5633ab3b18dd3cb7e60c8f8ab78427d75136f28721bd31ef904230` |
| `知行-0.12.9-x64.exe` | 338,494,606 bytes，SHA-256 `e0e9cd53789267fee3f4f8da3e28f8b73489eae87ebd45736c327555323d277a` |
| `知行-0.12.9-x64.exe.blockmap` | 315,038 bytes，SHA-256 `027a14b4aaa25498f958fc5831a6752df78ca19efa7ece538a3a1feca1406b6f` |
| 安装器签名 | `NotSigned` |

安装器由该次验收的目录包以 `--prepackaged` 构建。源码与目录包回归各因 Windows 未授予文件符号链接权限跳过一项 `owner.json` 测试。

## 本轮实测

- **裁剪范围。** 打包在复制 1,170 个锁定生产包之后删除 TypeScript 源码（`.ts`、`.tsx`、`.mts`、`.cts`）、source map、`@types`、`@deepseek-ai/libreoffice-kit-wasm` 与其它平台的 `node-pty` 预编译。Windows 运行时文件全部保留：win32-x64 OfficeKit 转换器、sharp 的 libvips、ripgrep、conpty、随包 Node、字体与许可证。
- **裁剪后的真实包。** 目录包回归 322/323 与桌面专项 5/5 均在裁剪后的包上完成，覆盖 Office 转换（实际生成有效 PDF）、原生写入审批拒绝、多文件补丁部分完成、重启后的补丁终态、Markdown 导出字节与保存快照失效。
- **体积。** 应用目录 1,454 → 818 MB；安装器 562.8 → 322.8 MB（-42.6%）；块映射 489.7 → 315.0 KB。
- **生产清单。** 随包 1,154 个包；另 16 个锁定包按设计裁剪，在 `production-inventory.json` 的 `pruned` 字段单列，不混入漏洞统计。审计仍为 0 high、0 critical、34 moderate，3 条公告命中安装路径。

## 证据范围

裁剪不改变内核、审批、脱敏、沙箱、图片与存储行为，因此 0.12.8 的会话工作目录与权限预设证据在本轮源码未变的前提下仍然有效；本轮仍完整复跑了源码与目录包回归。

安装、升级、卸载与重装生命周期在本轮未复跑：改动位于打包与体积，未改 NSIS 配置、数据格式与加密存储，`0.12.6` 的同账户合成资料生命周期证据不被本轮继承，也不据此宣称通过。真实云服务、交互式安装、跨账户解密和真实用户档案未覆盖。安装目录不再包含依赖的 `.ts` 源码与 source map，无法直接阅读依赖原始源码或还原压缩前堆栈行号。跨启动文件观察、原生 Auto reviewer、常驻 Host、OAuth、原生 ZIP 与完整子会话归档仍有缺口。
