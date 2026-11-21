# 知行 0.12.1 Windows 实包验收

记录日期：2026-11-21 至 2026-11-22，Asia/Shanghai。版本为 Windows x64 未签名预发布候选。验收区分源码、合成故障、真实 Harness 本机请求、Windows renderer、实际目录包和 NSIS 生命周期；不把目录注册、截图数量或旧包结果写成全能力通过。

**最终状态**：下表列明的源码、最终目录包、Windows 主机/会话/故障旅程及指定 NSIS 生命周期均已完成。真实云端、空配置新装、交互安装等未覆盖范围继续保留为未验；不以本轮通过宣称全部内核或全部隐私场景完成。

## 环境、提交与产物

- Windows 11 x64 build 22631；Node.js 24.19.0；Electron 44.7.0。构建宿主的全局 npm 为 11.17.0；实际随包插件 npm 为 11.21.3，生产依赖结论只针对核对后的包内路径，不代表已更新宿主的全局 npm。
- Harness 与 SDK 固定 `0.2.2-rc.5`，没有把上游 master 或仅安装的扩展视为当前可用能力。
- 审计/上一发行基线：`f2882ad7444f78b15b65b71ff76e010b2c9807fb` / v0.12.0。
- 构建源码提交：`25c6e69165cb019b834861e7bc33e9ddf46938f2`。包内 `build-provenance.json` 记录 sourceCommit、sourceDirty=false、锁文件哈希、Node 版本和构建时间。文档与测试适配提交可能晚于软件构建提交，不冒充重建二进制。
- 标准 `npm run electron:dist` 重建目录，复制 1,170 个生产依赖包，保留 lockfile 的实际嵌套路径；随包 Node、pnpm、npm，不依赖用户安装系统 Node/npm。
- 核对 78 项业务 JS、隐私/状态辅助模块与编译前端文件，文件集合 SHA-256：`b596d745280bde5c0fe5c0af4129ef84346ef1d19e6759897cda359dc93fe758`。另核对 package version/main/dependencies 与构建锁文件。
- 指纹按 Windows 工作树及编译产物字节计算。Git 换行检出设置可能改变源码字节；它用于核对已测目录和安装文件，不是跨平台逐字节可复现构建声明。
- 安装根上限 70 个 UTF-16 代码单元，最长包内相对路径 188；超长路径的人工交互仍未专项覆盖。

## 分层门禁

| 层级 | 实际结果 | 范围 / 本机证据 |
| --- | --- | --- |
| 完整源码 | **242/242，0 fail/cancel/skip** | 原样 `npm test`、默认 concurrency=2；216,905.9687 ms。规则、数据状态、故障注入、Windows 服务及真实 Harness loopback 的混合测试；`lead/source-final.log` |
| 优先审计合同 | **57/57，0 fail/cancel/skip** | `npm run test:audit`；网关/MCP、交付、运行/自动化持久化和草稿合同；`lead/audit-final-rebuild.log` |
| 最终目录模块 | **210/210，0 fail/cancel/skip** | 包内 Electron 作为 Node、包外临时 cwd、移除 NODE_PATH/NODE_OPTIONS；393,360.506 ms；`lead/packed-final-rebuild.log` |
| React/Electron 组件 | **4/4，0 fail/cancel/skip** | `npm run test:components`；真实 Windows renderer，部分 IPC/对话框适配器为合成，不能代替实包主机旅程；`lead/components-final-rebuild.log` |
| 前端 / Sites | 构建通过，**4/4** | 前端构建约4.26秒；主入口694.90 kB，仍有>500 kB chunk提示；`lead/build-directory-final.log`、`lead/sites-final-rebuild.log` |
| Windows 设置/隐私 | **15/15** | 当前实包版本、Unicode/占位符、raw与SECRET组合、本机样例不落盘、真实IPC短Key/原文检查、原生Teams目录与配置失效；`windows-kernel-privacy-final/journey.json` |
| Windows 主机交付 | **7/7** | 三类文件实际读回、系统剪贴板、各模式/范围的自定义秘密及模型/MCP凭据、篡改/过期策略、保存选择期间规则变更。仅保存对话框选定路径被替换；`windows-delivery-final/journey.json` |
| Windows 运行/调度故障 | **8/8** | 真实 RuntimeManager/AutomationService 和 Harness；合成 close/retryClose 拒绝及终态 ENOSPC。实际关窗进入 before-quit 后窗口/隔离保留；恢复清理原 child 退出；仅保存重试 runtime/calculate 各一次且模型请求不增加，实际加密文件读回和 Page.reload。原生警告弹窗仅展示适配器被替换；`windows-runtime-recovery-confirmed/result.json` |
| Windows 审计会话 / 重启 | **8/8** | 不导航恢复、新编辑保护、流式取消/终态、资料追加/去重/超限、孤儿恢复/删除、单聊/归档/项目级联、真实磁盘 marker 和 native history/vault 删除；实际进程退出并以同一 EXE 重启验证；`windows-audit-conversation-final/result.json` |
| 既有完整会话旅程 | **12/12** | 本版重新执行真实 Harness 文件成果/来源、搜索不可用轨迹、分享、侧边聊天、供应商隔离与取消；`windows-conversation-confirmed/journey.json` |
| 窗口 / 缩放矩阵 | **336/336** | 3 个窗口尺寸 × 4 个 Electron zoom × 28 个页面/入口/面板检查点，实际原生窗口；不是 336 项独立业务或物理 DPI 验收；`windows-pages-final/pages.json` |
| 原生浏览器 | **通过** | 最终包内BrowserService导航、前后退、文字读取、隔离、范围、可见性和关闭；`lead/browser-final-rebuild.log` |

上述证据路径均相对 `.preview/qa-0.12.1-audit/`，原始加密档案不公开上传。测试只用隔离 `--user-data-dir`、专用项目、合成资料及本机服务，未读取原用户业务资料或真实云端Key。调试端口只在专用QA启动命令中打开，正常产品不主动开放。

保留的失败记录：初轮 229 项为 228 pass / 1 fail（旧精确对象断言尚未包含 finalization，补全原字段和三轴检查后 233/233）；随后 234 项为 233 pass / 1 fail（Windows context.bin rename EPERM）。新增同密文字节提交重试与 8 项故障测试后，最终 242/242。实包还发现空清理计划多试一次，修复后重新构建。QA 的动态导入、官方 reminder 路由、供应商种子绑定及对象键顺序误报分别修正，并追加更严格断言；没有删除有效断言、增加 skip 或放大 timeout 求绿。旧凭证候选 177/145 和 S1 目录包的通过结果均未替代本页最终构建。

最终目录的首轮故障旅程还停于忙碌提示匹配：产品显示“该会话正在运行”，夹具只匹配“正在执行”；追加准确文案后，仍严格检查没有新增 Harness 或模型请求。重启检查完成后的旧会话旅程首次在连接阶段失败，重新托管启动同一 EXE/合成档案后 12 项通过。原失败记录和截图均保留，没有把未进入的检查点算作通过。

## 真正接入与未接入

R01–R08和R11的具体调用链、依赖路径及限制见 [审计修复说明](audit-remediation-0.12.1.md)；内核逐项范围见 [能力地图](harness-capability-map.md)。本轮修的是边界与恢复，没有替换框架、存储或真实供应商选择。

已经有真实实现和本机证据的包括 SDK Agent loop、子任务、Agent Teams、可选PTC、规划/目标/压缩/token meter、两类兼容协议、DeepSeek路由搜索、网页/浏览器、MCP工具/资源、插件管理、SenseVoice本机语音、OfficeKit及文字提取。它们各有条件和覆盖范围；全部工具目录存在不等于当前配置全部可执行。

仍未全部接入：常驻Host、跨启动live jobs/MCP、MCP/供应商OAuth、独立搜索连接、Responses/Gemini、异构子模型、模型视觉、原图打码、全面NER、完整原生文件和模型端Office三工具、增量加密事件/Blob。基础XLSX金额/日期/公式类型及正式DOCX模板仍不足。

本轮没有真实云端账户矩阵；loopback成功不等于所有供应商质量、额度、限流和长期兼容性已通过。PTC仍默认关闭；本轮之前的间歇规划启动失败没有被宣称已定位全部根因。

## 生产依赖与清单

最终目录的1,170条实际安装路径与锁文件版本一致，组件清单指纹为 `e3a0c91de2c24a85cca9f7e2f6bba5125bcc9bafaa5e0d5bb937c7bbd6b4f265`。发行材料附安装路径清单、CycloneDX组件SBOM、去重公告和生产audit快照。

npm 11.21.3内部实际版本：tar7.5.22、undici6.29.1、brace-expansion5.0.12、ip-address10.7.5。生产audit为 **high0 / critical0 / moderate34**；去重后的公告在已安装路径对应3项。不是34个独立、已证明可利用的产品漏洞，也不是零风险。

清单读取实际包内manifest，audit基于核对后的lock投影；没有扫描所有bundle代码、Electron/Chromium/Node原生二进制或任意第三方插件。插件保持无系统Node/npm的独立操作及脚本审阅；恶意归档、磁盘硬配额及所有注册源/原生编译环境仍未全面验证。

## NSIS候选与品牌

从上述已测目录使用 `--prepackaged` 组装完整NSIS，而非另编译一份未测前端。应用EXE和安装器均通过9种尺寸的墨竹图标资源检查，原始PNG哈希未变；Authenticode均为 `NotSigned`。

| 资产 | bytes | SHA-256 |
| --- | ---: | --- |
| `ZhiXing-0.12.1-x64.exe` | 562,797,728 | `D61B8B13A47CA0B96D2F82D3501E65F3836EC62EEFC6E5E7C1DF5458E2FB0BE9` |
| `ZhiXing-0.12.1-x64.exe.blockmap` | 489,667 | `08C04401AC7C3FA81A63F6BBAEA7207C1740F90EA447323937F5AF2A72C0DF6C` |
| `win-unpacked/知行.exe` | 246,317,568 | `0955F75D44428146F86EC445C9CA1FD0209E4C07637F7C7E1DFDDFDCE8A3C6DC` |

本版实际 NSIS 生命周期结果：**passed_configured_nonvisual_lifecycle**，共 53 条记录（38 passed、15 observed）。真实 0.12.0 安装器先安装，再升级到本候选、同版覆盖、卸载保留、重装读取及最终清理；三次候选安装后的 78 项业务字节与已测指纹完全一致。报告 SHA-256：`143B64A24203383B4607A0BE2FBB07CBA7B63810B36AE5AE997AFFDD4EB9A73C`。同 Windows SID 的合成档案含 3 项目、1 聊天、4 份文字草稿及加密供应商/MCP 配置，逻辑读取和每个关闭阶段的字节保留分别核验；历史夹具没有带解析附件的草稿，不声称该分支通过。卸载使用 --keep-shortcuts，原快捷方式手动字节恢复，未测普通快捷方式自动清理。原始报告路径仅在本机证据索引中，公开摘要不包含 SID 或真实档案清单。

| 实际进程阶段 | 秒 |
| --- | ---: |
| 0.12.0 旧版安装 | 640.72 |
| 0.12.0 → 0.12.1 升级 | 864.86 |
| 0.12.1 同版覆盖 | 924.10 |
| 卸载并保留资料 | 47.47 |
| 0.12.1 重装 | 657.30 |
| 测试安装最终清理 | 45.03 |

耗时是本机单次进程观察，含该阶段自带的卸载或解包工作，不是统一硬件性能保证。本轮安装和覆盖较慢；包体、展开文件数量及安装耗时仍需优化，不能以通过功能验收代表性能已达标。

## 继续保留的范围

- 真实默认AppData不作逻辑迁移；字节备份/恢复匹配不证明整个过程从未触碰。不会读取原用户的模型/MCP明文凭据。
- 静默当前用户和自定义user-data-dir的结果不能替代空配置NSIS新装、交互/所有用户安装、跨账户解密、真实业务迁移、普通卸载快捷方式清理或人工超长路径提示。
- 全局资料库、磁盘原件和明确保留的独立任务历史，不属于聊天草稿的物理安全擦除。
- 退出确认针对SDK根进程handle，不代表恶意/不合作插件和MCP后代进程全树回收。
- 持续不可写时未保存结果仍依赖当前进程内存；正常退出受阻，但强杀/断电前未落盘正文不能保证恢复。
- R09空owner锁、R10目录完整分页、多份新草稿入口和统一能力状态manifest尚未实现。
- 工作区12MiB上限、全量加密写回、真人麦克风、物理DPI、全量读屏和大规模性能/协作压力仍待后续独立验收。
