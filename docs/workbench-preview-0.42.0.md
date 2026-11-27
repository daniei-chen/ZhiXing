# 知行 0.42.0 · 工作面板导航与交付文字预览

## 状态与证据口径

本说明记录 0.42.0 候选的实现范围和上游核对依据，开发起点为 `cabb754b08883902b12f876e2d68338a7699d5fb`。它不是发行完成证明，也不预填测试通过数。

2026-11-27 通过当前锁文件恢复并读取四个官方 npm 包：`@deepseek-ai/dsh-client-ui-sidebar-right`、`@deepseek-ai/dsh-client-ui-sidebar-documentpreview`、`@deepseek-ai/dsh-client-ui-deliverables`、`@deepseek-ai/dsh-client-ui-chat`，版本均为 `0.2.2-rc.5`。包来源、锁文件 integrity、源文件 SHA256 和观察位置保存在 [upstream-workbench.json](evidence/0.42.0/upstream-workbench.json)。

这是依赖源码证据。本轮没有重新打开 `D:\应用\DeepSeek harness` 的桌面窗口，没有重新提取其 200 包安装清单。历史 [0.26.0](iteration-0.26.0.md)、[0.27.0](iteration-0.27.0.md)、[0.29.0](iteration-0.29.0.md)、[0.30.0](iteration-0.30.0.md) 的交付卡片、引用、动作与对比验收保留原归属，不能代替本轮实包证据。

## 本轮范围

工作面板保留浏览器、文件、终端、侧边聊天、执行、改动、产出、统计、详情九个真实视图，将原下拉选择器替换为可见标签。标签支持鼠标、左右方向键及 Home/End 选择；窄面板内标签条可滚动，不以隐藏功能替代响应式布局。会话操作、输出内容/来源浮层和工作面板三个顶栏入口保持既有职责，浏览器首页已有快捷入口继续使用原功能。

交付卡片、正文内已解析的交付文件引用，以及产出列表共用右侧预览入口。选中文件后打开「产出」页，显示加载状态、主机读取结果或失败提示；提供返回产出列表、重试预览和放大预览。放大复用既有文档弹窗，是同一提取文字的查看入口，不是 Office 原版面。

预览正文显示前 12,000 个 JavaScript 字符单位，超出时明示截断。保留 `FileCoverage` 的读取范围、警告与统计；没有提取文字时明确说明。正文使用文本节点，不执行文件中的 HTML、脚本或外部资源。

## 官方机制核对

下表文件路径以 `node_modules/@deepseek-ai/` 为前缀，行号属于本次记录的文件指纹。

| 机制                         | 官方源码位置                                                                                                                                                                            | 核实结果与知行边界                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 交付卡片打开右侧文件         | `dsh-client-ui-deliverables/src/client/PresentedFileCard.tsx:40–41`、`dsh-client-ui-deliverables/src/client/Deliverables.tsx:109–112`；`dsh-client-ui-chat/src/client/apply.ts:274–279` | 卡片调用 `openFile`，聊天层构建会话文件地址并调用 `sidebarRight.openResource`。知行沿用已核验的交付引用，将位置改到右侧；没有照搬原生资源地址协议 |
| 行内文件引用复用文件入口     | `dsh-client-ui-deliverables/src/client/index.ts:104–117`                                                                                                                                | 原生引用使用 `owner.openFile`。知行继续只匹配本消息已交付文件，不扩大候选集或放宽路径歧义规则                                                     |
| 右侧标签和面板控件           | `dsh-client-ui-sidebar-right/src/client/shell/SidebarRight.tsx:272–305,353–369`；`dsh-client-ui-sidebar-right/README.zh.md` 的“呈现形态”“状态”“ctx.sidebarRight”                        | 原生通过 `DockLayout` 管理资源标签、停靠、浮窗和会话布局。知行本轮是固定功能标签，仍为部分对标                                                    |
| 文本资源预览                 | `dsh-client-ui-sidebar-documentpreview/src/client/definition.ts:45–53`、`dsh-client-ui-sidebar-documentpreview/src/client/index.ts:94–123`                                              | 原生 `text` 类型认领会话文件地址；正文调用 Remote 读取。知行只提供经现有本机解析器提取的文字，不等同于原生完整查看器                              |
| 加载、失败、重试和旧请求失效 | `dsh-client-ui-sidebar-documentpreview/src/client/TextPreview.tsx:388–445`、`dsh-client-ui-sidebar-documentpreview/src/client/face.ts:114–152,167–200`                                  | 原生有按 tab 的读取状态、generation 与中止信号。知行前端以作用域和请求代次拒绝迟到结果；没有把主机读取 IPC 扩成可取消服务                         |
| 完整文档查看器               | `dsh-client-ui-sidebar-documentpreview/src/client/index.ts:124–131`；`dsh-client-ui-sidebar-documentpreview/README.zh.md` 的“怎么读”“Office 预览”                                       | 原生另有 Markdown、代码、图片、PDF、HTML、Office 和表格渲染器。Word/PPT 经本地转换显示 PDF；这些能力不由本轮文字预览覆盖                          |
| 查看内容与模型隔离           | `dsh-client-ui-sidebar-documentpreview/README.zh.md:133–139`                                                                                                                            | 官方文档明确查看器不注册工具或会话事件，所读内容不进入模型请求。知行预览只占瞬态界面状态，不自动加入交办                                          |

对标结论为**部分**。与用户当前 Harness 桌面窗口的视觉一致性仍为**未核对**。

关键源码 SHA256 如下；其余源文件与 README 的字节数、完整指纹见上游 JSON。

| 文件（同上前缀）                                                   | SHA256                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `dsh-client-ui-deliverables/src/client/PresentedFileCard.tsx`      | `7e9440610e6d62d6eb0f564850cb2eaceef9ec75b4c40a92424d2c97f6136815` |
| `dsh-client-ui-deliverables/src/client/Deliverables.tsx`           | `3d7d7512f7da17a8918f4cd40d856828770472319102aaadb79ba83a20dd8e6c` |
| `dsh-client-ui-chat/src/client/apply.ts`                           | `3f2824757df3fd343f3032a8d98b5f28e53b31e94ced7c56c9d3ac895ed0e424` |
| `dsh-client-ui-sidebar-right/src/client/shell/SidebarRight.tsx`    | `3b55707af33c14d575d74b35335ad64a5607de425063548f28db3af11ab15a56` |
| `dsh-client-ui-sidebar-documentpreview/src/client/definition.ts`   | `6cf2dd02bb5edda4d1e4389d47ca8d1c3cd85bc81b44465ac9bfe7a06bf53e3e` |
| `dsh-client-ui-sidebar-documentpreview/src/client/TextPreview.tsx` | `7ca521c3dcee0b00a843fb9c9f0aabe684f7635acf09d56fe473b2c7763a1384` |

## 授权链和文件边界

本轮继续使用 `listDeliverables(workContext)` → `readDeliverable({ ...workContext, id })`。渲染层传入路径只用于在主机返回的列表中选择交付项；单独提供路径不能授予读取权限。

`electron/main.cjs` 的 `deliverables:list` 和 `deliverables:read` 在读取前等待同一个工作空间提交队列。`electron/deliverable-access.mjs` 核对主机保存的会话、工作空间和项目归属，从加密的原生交付历史取得记录，并签发/核验 HMAC 引用。读取保留私密路径排除、普通文件与链接检查、10 MiB 文件上限、打开句柄前后和读取期间的文件身份检查；读取和解析后还会重新核对所属作用域。

这条链与项目文件页的 `workspace:office-layout` 不同。本轮没有用已核验的文件路径绕过交付引用、没有扩展 OfficeKit 授权、没有把外部目录文件隐式纳入项目工作区。上述 Node 路径复验也不是原子目录句柄沙箱，不宣称抵御任意恶意本机进程竞态。

## 生命周期、持久化和隐私

`use-delivery-preview.js` 将工作空间、项目、项目目录、聊天及视图代次作为作用域身份。每次打开或重试使用新的请求代次；列表返回后、正文返回后都核对当前身份。较旧请求不能覆盖较新文件，也不能在换会话后把正文带到另一个聊天。

返回列表、关闭工作面板和组件卸载会使旧结果失效。改变作用域会清除预览。切换同一工作面板的其他标签保留当前预览状态，切回产出页继续查看；这不是重新发起模型任务。失败保留当前目标，重试重新经过列表和主机交付校验。

预览内容不进入 `messages`、资料空间、草稿、工作空间持久快照或模型请求。放大只复用当前读取结果。已有浏览器视图仍按选中标签、面板可见性和模态状态隐藏或恢复，避免原生网页覆盖预览及放大弹窗。

这里的“失效”指丢弃前端迟到结果，不代表正在进行的主机解析已取消；既有 `deliverables:read` IPC 没有取消参数，读取可能继续到原本的完成或超时边界。不能把前端代次控制写成完整取消链。

## 未覆盖与剩余差距

- 固定九视图标签不是原生按资源动态创建、关闭、恢复的 tab 系统；停靠分栏、浮窗、独立资源地址、每会话布局持久化及完整快捷键未移植。
- 右侧交付入口不显示图片、PDF 或 Office 原版面，不提供交互式表格、文档编辑、分页加载、内容版本观察、自动刷新或源码行定位。图片可能沿用既有本机 OCR 提取文字，这仍不是图片原图预览。
- `FileCoverage` 的提取范围继续有效；有文字不表示扫描区域、嵌入对象、图片、修订与隐藏内容已全部识别，表格公式缓存不代表本轮重新计算。
- “改动”页继续使用既有工具前后文本片段，不新增 Git 工作树快照、整轮文件差异、回滚、并排对比或 review 内的打开/定位。
- 本次上游核对不包含实际 Harness 桌面运行、当前窗口视觉对照或真实云端办公任务；也不涉及用户安装目录、安装生命周期、代码签名或全量 200 包能力验收。
- 本文与上游 JSON 只记录源码观察；源码测试、组件、浏览器视觉、Windows 当前目录包、真实云端和发布资产各层的结果必须另以实际运行记录给出。没有记录结果的层不能据本文写成通过。
