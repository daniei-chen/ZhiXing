# Prototype Instructions

## 用户确定的产品方向

- 产品名：知行。品牌主张：知你所需，行你所托。2026-11-19 最新指示：仿 Codex 界面，左上角只切换「办公／政务」工作模式；工作区目录在新建项目或项目设置中选择，不放在模式菜单里。保留既有项目资料并迁移旧空间目录到项目。
- 色彩以 GPT 桌面端参考图为准。用户明确否定自行设计的绿色、鼠尾草色、米色主题：主区白色、侧栏浅冷灰、边框浅灰、文字近黑、主按钮黑色；深色为中性灰阶。不得因墨竹图标自行扩展绿色配色，也不得对办公和政务分别染色。
- 正式应用图标为用户提供的「雪中三叶墨竹」PNG，原图保存在 `public/brand/zhixing-bamboo.png`。Windows EXE、安装包、应用窗口和界面品牌位用同一素材，保留原图透明通道；深色界面在图标下提供浅底。
- 2026-11-20 用户要求认真重写并排版 GitHub README，沿用此前水墨风及知行的墨竹品牌。README 的品牌表达使用墨竹、黑白与留白，应用继续沿用已确定的中性灰白主题。
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
- 语音识别使用 DeepSeek Harness `dsh-experimental-voice-input-bundle` 配套 SenseVoice 本机 INT8 Provider；首次模型准备由用户主动启动，展示来源、进度、失败与取消。录音转为 16 kHz 单声道 PCM16 WAV，仅经本机 Provider 识别，不写入模型 Session。
- 对话顶栏保留会话操作、当前对话产出和工作面板三个入口。分享、复制为文件、保存、导出由会话菜单承载；浏览器、文件、终端、执行、产出、统计及详情都在工作面板内切换。
- 顶栏第二入口使用「输出内容／来源」小浮层，基于实际产出、附件、网页工具及子任务记录显示。工作面板内部使用标签页切换，首页保留网址搜索和终端、新标签页、文件、侧边聊天四个入口。2026-11-20 用户明确移除右上角常驻「工作空间已保存」，成功状态隐藏，读取或保存失败仍提供持续提示与重试。
- 输入框底部合并模型、供应商与推理档位为一个入口。默认打开智境样式滑杆，从浮层中的模型名进入模型列表，选中后返回输入区。不同供应商的同名模型必须独立显示和路由，只显示当前模型实际支持的档位。
- 供应商设置支持预设填 Key 拉取真实目录和自定义 API。密钥按供应商在 Windows 主进程加密存储，切换服务时新开聊天，不把之前的消息交给新服务。Chat Completions 和 Messages 均经本机脱敏网关。保存推理参数和密钥变更后，旧预览与受影响的调度授权需重新核对。
- 高级调度规则复用 Harness 的 Cron、RRULE 和固定间隔计算。规则、目标、资料或已审阅的聊天上下文变更时重新审阅。已有聊天仅使用预览中列出的最多六条有效消息，自动化内部会话与该手动聊天分开；任务输出送回指定聊天。同一条任务聊天会在当前已审阅范围内复用自己的内核会话。
- Harness 插件由官方插件管理器在知行独立档案中安装、启停和更新。安装或更新后停用，启用前明确说明本机代码权限。已信任插件只用于选择「完全访问」且关联工作区的主动交办；定时任务不继承。MCP 连接与 Harness 插件分开呈现。
- 桌面继续以 Codex 的项目、聊天、输入区和工作面板交互为参考，使用知行自己的视觉细节和办公文案。Harness 功能逐项以真实内核行为验收，进度与限制记录在 docs/harness-capability-map.md。
- 2026-11-21 用户要求 0.12.0 修完回归、完成 Windows 实包验收后提交推送。内核、脱敏、界面和安装生命周期分层记录；不能把工具目录、规则测试或旧版本安装证据描述为全能力接入/全部敏感信息识别/新版安装生命周期通过。界面继续学习 ChatGPT 的清晰设置、反馈与任务可见性，保留已确定的墨竹品牌和中性色。
- 2026-11-21 用户追加：完成新版后同步 GitHub，并发布完整 Windows 安装包供外部 AI 审计；同时提供对应源码版本、校验值、真实验收结果及未覆盖范围。
- 0.12.1 凭证策略：可用模型 Key 至少 8 个无空格的可打印 ASCII 字符；旧的过短 Key 提示重配。非脱敏模式始终拦截规则识别的凭证，不得因为 SECRET=mask 放行原文。本机测试按当前模式运行，但不读取已保存 Key；实际发送由主进程另行检查。隐私语义更新必须提高引擎版本并让旧自动化授权失效。
- 2026-11-21 独立审计收口：先复现 R01–R06，保留动态键/schema 的语义并对敏感动态键安全拒绝；导出和分享由主进程生成并校验当前策略快照。业务终态、结果保存、进程退出分别记录，退出未确认继续隔离，保存重试不得重复运行模型或工具。删除须级联草稿且失败可恢复；普通脱敏不增加逐次确认。保持当前框架、存储、灰白品牌与三个顶栏入口，分层公布源码、合成运行、Windows 和真实云端证据。

- 0.14.1 错误文案要求端到端可信：主进程不得把网络失败压成一句笼统的话，必须保留系统错误码（ECONNREFUSED／ENOTFOUND／ECONNRESET／TIMEOUT）或 HTTP 状态；界面统一由 src/error-copy.js 映射成可行动文案并整体替换，原始技术文本只进诊断日志。新增或修改文案必须同时更新 tests/error-copy.test.mjs 与 scripts/test-error-copy-ui.mjs，并在 Windows 实包上跑 npm run test:errors，不允许只靠映射单测宣称已完成。
- 发版第 9 步之后并列增加 Windows 实包错误文案验收（npm run test:errors），与原生文件导出验收同级；两套脚本都用临时 profile 启动打包 EXE，不改用户安装目录。
- 安装生命周期复跑的固定顺序（0.14.2 起）：先用 `scripts/backup-host-bytes.ps1` 取冷备份（此时必须已正常关闭应用），再用**保留快捷方式**的方式卸载用户安装（`Uninstall 知行.exe /S /currentuser --keep-shortcuts`），最后跑 `scripts/qa-install-lifecycle.ps1 -Mode Run`。若卸载器连快捷方式一起删掉，脚本会在前置检查报 `Shortcut inventory differs from its byte backup`——因为备份清单里记着两条快捷方式，而当前一条都没有。快捷方式可以按备份逐字节还原，不需要重做备份。
- 生命周期脚本要求的 FixtureManifest 里 `sourceAppVersion` 必须等于**首个安装包**的版本；没有 BaselineInstaller 时即候选版本。合成 fixture 可以先由旧版创建，但要用候选版重新读一遍、重新保存后再写清单，否则版本字段是假的。
- 0.14.3 聊天发送失败也必须说清下一步：内核把失败压成 `turn/end` 的 `reason.error`（含 `status`／`code`）时，主进程要用 `electron/run-failure.mjs` 把它带进用户句子的括号里，界面再由 `src/error-copy.js` 整句替换。只有 HTTP 状态或 `TRANSPORT`／`TIMEOUT` 这类已映射代码才带；`CONTENT_REFUSED` 等无法给出行动建议的代码保持原句，不编造原因。发送路径的实包验收是 `npm run test:chat`（本地假服务：模型目录成功，对话分别 401 与断连）。
- 0.14.4 自动更新的下载缓存必须有界：electron-updater 装完不清理 `%LOCALAPPDATA%\<updaterCacheDirName>\pending`，本机实测残留一个 323 MB 的旧安装包。主进程启动时调用 `electron/updater-cache.mjs`：删掉版本不高于当前运行版本的（已经装过）、以及超过 7 天的陈旧下载；还有待装的新版本时，它的 blockmap 与 update-info.json 必须一起留着。缓存目录名只从打包生成的 `app-update.yml`（updaterCacheDirName）读取，不按应用名猜；读不到就跳过，不报错。清理失败只记 `updater.cache-prune-failed`，不能影响启动。实包验收是 `npm run test:updater`（重定向 LOCALAPPDATA，预放旧版本与新版本各一个）。
- 0.14.5 安装生命周期的两条硬规则：① 跑 `qa-install-lifecycle.ps1` 之前必须删除桌面与开始菜单两条产品快捷方式（先按字节备份到 `.preview/qa-X.Y.Z/user-shortcuts/`），因为安装器用 `--no-desktop-shortcut`、不会重写桌面 `.lnk`，它还指向旧安装目录时 `Assert-Installed` 会报 `Unexpected product shortcut target`；冷备份也要在删除之后取，否则前置检查的快捷方式数量校验不通过。② 装回用户环境必须带 `/D=D:\应用\知行`，卸载清空注册项后 NSIS 默认装到 `%LOCALAPPDATA%\Programs\office-agent`；装错位置要卸载再带 `/D=` 重装，并逐字节还原两条快捷方式（0.14.5 实测：错位安装 342 秒，正确安装 354 秒）。
- 0.14.6 安装器临时目录也必须收口：NSIS 卸载器把自己复制到 `%TEMP%\~nsu.tmp` 再运行，正常退出会删掉，但本机 0.14.5 卸载后留下一份 200 KB 的 `Un_A.exe`（04:53 写入，05:24 仍在）。启动时调用 `electron/temp-hygiene.mjs`，只清能证明是知行留下的那一份：目录名必须是 `~nsu.tmp`、可执行文件字节里要含 UTF-16 的「知行」或 UTF-8 的 `zhixing`、目录至少 10 分钟没被写过。别家应用的 NSIS 卸载器也用同名目录，不能凭名字删；不满足任一条就只记日志不动文件。实包验收是 `npm run test:temp`（重定向 TEMP/TMP，预放自己的旧副本与别家同名目录各一个）。
- 0.14.7 原生 ZIP：工作面板「文件」页的「打包为 ZIP」把当前目录打成 ZIP，走主进程 `electron/zip-writer.mjs`（zlib deflateRaw + 自写中央目录，不引入新依赖），保存用原生对话框。归档路径必须相对、不许 `..`、不许盘符，条目数与总字节有上限（2000 个 / 256 MB）；私密清单复用 `workspace-files.mjs` 的 `isPrivateRelative`（`.env`、`*.pem`、`*.key`、`vaults`、`node_modules` 等不进包）。取消保存不写文件、不提示成功。实包验收是 `npm run test:zip`（真实点击按钮 + 接管原生对话框 + 用 yauzl 读回核对）。
- 0.14.8 子会话归档：执行面板的子任务行有「归档」按钮，把这个子会话的对话（界面上已显示、已脱敏的文本）排成 Markdown，用原生保存对话框落盘。排版在 `src/subagent-archive.js`（纯函数，`tests/subagent-archive.test.mjs` 钉住标题、元信息、截断标注与空消息占位）；写盘在主进程 `subagent:archive`，拒绝空内容与超过 2 MB 的文本，文件名过滤 Windows 非法字符并强制 `.md`，默认目录是当前项目工作区。取消保存不写文件、不提示成功。实包验收是 `npm run test:archive`。归档只覆盖子会话对话本身，不含工具调用的完整参数与产物文件。
