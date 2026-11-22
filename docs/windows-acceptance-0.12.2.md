# 知行 0.12.2 Windows 验收记录

记录日期：2026-11-22，Asia/Shanghai。版本为 Windows x64 未签名预发布候选。本文先记录源码和隔离 Windows renderer 门禁。最终目录包、安装器、文件哈希和 NSIS 生命周期在构建完成后补入，并以实际证据文件为准。

## 源码与组件门禁

| 层级 | 当前结果 | 证据 |
| --- | --- | --- |
| 完整源码 | **335 项，334 通过，0 失败，0 取消，1 条件跳过** | `.preview/qa-0.12.2/lead/source-full-pre-version-docs.log` |
| 能力清单和真实 Runtime 检查 | **7 项通过** | `.preview/qa-0.12.2/lead/capability-native-ui-second.log` |
| R09/R10/草稿恢复焦点回归 | **154 项，153 通过，0 失败，1 条件跳过** | `.preview/qa-0.12.2/lead/focused-integrated.log` |
| Windows Electron 组件与隔离旅程 | **14/14** | `.preview/qa-0.12.2/lead/components-0.12.2.log` |
| 前端构建 | **通过** | `.preview/qa-0.12.2/lead/build-0.12.2.log` |
| Sites worker | **4/4** | `.preview/qa-0.12.2/lead/sites-0.12.2.log` |

唯一条件跳过是 Windows 不授予文件符号链接权限时的 `owner.json` 符号链接测试。真实 junction、owner-entry junction、恶意元数据和不确定 PID 复现均已执行并通过。没有使用 skip 让完整源码门禁变绿。

## 本轮真实覆盖

- R09 覆盖主锁和 guard 在 mkdir 后、owner 写入前、发布前和发布后崩溃。覆盖活进程保护、死 owner 回收、同进程重入、并发 writer、token 替换、坏 owner、目录链接、junction、Windows 删除中错误和取消。
- R10 覆盖 0、1、119、120、121、1,000 和 10,001 个直接条目。121 项和 1,000 项按页完整返回。超过 10,000 项明确报错。结果保留排序、续页、总数、隐私处理、审批和目录变化检查。
- 草稿覆盖三份连续新草稿的可见列表、逐份回切、附件保留、JSON 文件重载、首次发送失败后的实际 chat 归属、删除项目后的迟到附件和较新编辑保护。真实 Electron renderer 旅程为 4 个检查点，草稿打开 7 次，页面重载 3 次，合成 `runPrepared` 1 次，模型请求 0 次。
- 能力清单覆盖注册目录、模型工具声明、PTC `run_code` 直达、办公工具程序化调用，以及项目、权限、协议、联网、规划和开关条件。设置页对过期或失败的迟到检查结果会清空，不保留旧状态。

## 最终安装包门禁

本节只在新版本目录包和 NSIS 安装器完成后填写。构建源码提交、包内 `build-provenance.json`、业务文件指纹、包内回归、应用 EXE、安装器、SHA-256、签名状态和安装生命周期必须来自同一实际构建链。

| 资产或门禁 | 结果 |
| --- | --- |
| 构建源码提交 | 待构建 |
| 目录包包内回归 | 待构建 |
| Windows renderer 最终包 | 待构建 |
| `ZhiXing-0.12.2-x64.exe` | 待构建 |
| 安装器 SHA-256 | 待构建 |
| NSIS 升级、覆盖、卸载保留、重装 | 待构建 |

## 未覆盖范围

本轮没有真实云端账户矩阵、真实用户 API Key、真实业务资料、交互安装、所有用户安装、跨 Windows 账户解密、普通卸载快捷方式清理、物理 DPI、真人麦克风、完整读屏和大规模压力验收。安装阶段耗时和包体大小也不能由功能门禁推断。

常驻 Host、跨启动 live jobs/MCP、MCP/供应商 OAuth、独立搜索、Responses/Gemini、异构子模型、模型视觉、原图打码、全面 NER、完整原生文件/Office parity、增量加密事件/Blob、typed XLSX 和正式 DOCX 模板仍未全部接入。生产依赖的既有 moderate 影响记录仍按上一版清单和实际包内路径复核，不写成零风险。
