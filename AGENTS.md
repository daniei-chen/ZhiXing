# Prototype Instructions

## 用户确定的产品方向

- 产品名：知行。品牌主张：知你所需，行你所托。2026-11-19 最新指示：仿 Codex 界面，左上角只切换「办公／政务」工作模式；工作区目录在新建项目或项目设置中选择，不放在模式菜单里。保留既有项目资料并迁移旧空间目录到项目。
- 色彩以 GPT 桌面端参考图为准。用户明确否定自行设计的绿色、鼠尾草色、米色主题：主区白色、侧栏浅冷灰、边框浅灰、文字近黑、主按钮黑色；深色为中性灰阶。不得因墨竹图标自行扩展绿色配色，也不得对办公和政务分别染色。
- 正式应用图标为用户提供的「雪中三叶墨竹」PNG，原图保存在 `public/brand/zhixing-bamboo.png`。Windows EXE、安装包、应用窗口和界面品牌位用同一素材，保留原图透明通道；深色界面在图标下提供浅底。
- 用实际 ChatGPT 桌面端核对交互。设置、导航、项目、会话、搜索、资料和定时任务按知行的需求适配，用独立视觉和文案，避免用看似可用的按钮冒充功能。
- 工作模式仅办公／政务，旧空间作为内部数据分区保留。可见工作区目录仅在项目创建和设置中管理；不恢复模式菜单中的空间 CRUD。项目、会话和资料保留原归属与迁移。
- 设置提供「脱敏模式」与「非脱敏模式」，默认脱敏。非脱敏模式明确开启后原文直接发送，不误标为离线；常见凭证仍单独拦截。改变设置不能改变已审阅的请求，也不能暗中放宽已授权的定时任务。
- 核心必须接入真实 DeepSeek Harness，最终交付 Electron Windows 桌面包；不能将固定示例回复、未调度的自动化或未接入按钮称为真实能力。
- 保护链路覆盖模型请求、工具结果和输出还原。映射按任务隔离；对外版本单独检查接收范围；未解析附件不能声称已脱敏。
- 浏览器不保存 API 密钥。桌面凭据只进入主进程加密存储；不可读取其他应用的凭据。
- 交互参考使用用户提供的截图及实际桌面窗口。参考截图保存在本机验收资料中。
- 已核对交互记录见 docs/interaction-audit.md；未核对页面明确记录，不宣称全量像素一致。
- 输入区按用户追加的长中文截图核对：统一底部定位，标准宽约 738px；内容随实际换行向上展开，到约 11 行后才内部滚动，操作栏和发送按钮固定。按空态、短文本、长文本、删回短文本核对浏览器和 Windows 实包，不能只验收静态首页。
- 自动化在 Electron 主进程调度，使用独立加密记录和执行历史；不得恢复渲染页面计时器。创建默认暂停，AI 任务启用/立即运行需主机生成的实际输入预览。绑定任务内容、资料副本、项目说明、模型、服务地址、凭据版本和发送模式，发生变化后重新审阅。关闭应用不执行，重开每项只补最近一次到期计划；不要宣称系统后台服务。
- 输入框左下「请求批准／帮我批准／完全访问」为执行权限菜单，不是脱敏选择。参考已现场核对，菜单向上展开，各档带说明、当前勾选和了解更多；隐私模式独立设置。按实际工具能力表述批准范围；终端、网页和 MCP 已接入时必须包含对应说明。文件读取、写入、覆盖必须落到主机策略与审批请求，不能仅改标签。
- 脱敏模式在本机自动处理后直接发送，不逐次弹出脱敏成果确认。按需查看请求详情；设置提供分类控制、自定义词、排除词和本地测试。非脱敏模式明确开启后也直接发送；凭证阻断与真实文件权限审批仍独立。自动化启用时授权计划和资料范围，普通逐次运行不因脱敏额外确认。

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

- 0.3 接入：原生 spawn/fork 子任务与控制、MCP 工具和资源、/plan 审批、/goal、/compact、token meter。Harness 日志 AES 加密，密钥仅在 Windows 加密映射中；raw/redact 分开恢复历史。模型只走本机隐私网关；MCP 外部参数不自动还原。网页读取采用公共 IP 校验与连接地址固定。

- 用户再次强调全功能与页面齐备：必须包含右侧内置浏览器、交互终端、项目文件预览、执行轨迹，不能把联网工具等同于浏览器页面；逐项建立 Harness 核心／界面／扩展能力验收表。右侧面板沿用 Codex 中性标签与布局，网页和终端不自动进入模型上下文。

- 图标必须核对实际启动链：开发启动器、原始 electron.exe、窗口身份、开始菜单/任务栏快捷方式、打包 EXE 和安装包。曾发现开始菜单 Electron.lnk 指向本项目的默认 Electron 且图标路径为空；不能只替换界面 Logo 或另一个新包后就宣称问题完成。脚本 repair-shortcuts.ps1 只修复指向本项目的入口并保留备份，不清空全局图标缓存。
- 0.5 资料读取使用独立 Node 进程、内存和超时上限。本机提取 DOCX/XLSX/PPTX/文字 PDF，只发送提取文字；图片、扫描区域、嵌入对象和原始文件未上传，不应标为已完整识别。附件预览与模型上下文都必须保留读取范围、修订/隐藏区域及公式未重算的说明；不能因扩展格式而恢复逐次脱敏确认。

- 输入区使用知行自己的品牌与中性色。思考强度以用户的「智境」官网演示条为准，浮层显示当前档位和模型，圆形滑块可拖动或按方向键，填充随档位变化，最高档使用蓝紫渐变和细微亮点。颜色仅用于强度控件。知行保留内核实际支持的「关闭／低／高／最高」四档，映射到 off/low/high/max。「添加」面板沿输入框向上展开，列出文件、项目文件夹、资料、网页、目标、规划与实际 MCP 连接。
- 语音为 Windows 本机听写，点击麦克风才启动；取消、切换聊天、退出均停止。识别后确认插入输入框，发送时遵循同一隐私链路；不得默认发送音频或在后台录音。
- 输入框底部合并模型、供应商与推理档位为一个入口。默认打开智境样式滑杆，从浮层中的模型名进入模型列表，选中后返回输入区。不同供应商的同名模型必须独立显示和路由，只显示当前模型实际支持的档位。
- 供应商设置支持预设填 Key 拉取真实目录和自定义 API。密钥按供应商在 Windows 主进程加密存储，切换服务时新开聊天，不把之前的消息交给新服务。Chat Completions 和 Messages 均经本机脱敏网关。保存推理参数和密钥变更后，旧预览与受影响的调度授权需重新核对。
- 高级调度规则复用 Harness 的 Cron、RRULE 和固定间隔计算。规则、目标、资料或已审阅的聊天上下文变更时重新审阅。已有聊天仅使用预览中列出的最多六条有效消息，自动化内部会话与该手动聊天分开；任务输出送回指定聊天。同一条任务聊天会在当前已审阅范围内复用自己的内核会话。
- Harness 插件由官方插件管理器在知行独立档案中安装、启停和更新。安装或更新后停用，启用前明确说明本机代码权限。已信任插件只用于选择「完全访问」且关联工作区的主动交办；定时任务不继承。MCP 连接与 Harness 插件分开呈现。
- 桌面继续以 Codex 的项目、聊天、输入区和工作面板交互为参考，使用知行自己的视觉细节和办公文案。Harness 功能逐项以真实内核行为验收，进度与限制记录在 docs/harness-capability-map.md。
