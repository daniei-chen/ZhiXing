# 04 · 上游关系与同行对照（E + F）

> 审计线程：HOME-6 船员 / 2026-11-28，基线 main `a73cc7d`。只读，未改仓库、未跑测试套件。
>
> **取证口径说明（重要）**：本机 `zhixing/node_modules` 不存在（`ls node_modules` → `No such file or directory`），所以「读上游源码」不是读 node_modules，而是用 `npm pack @deepseek-ai/<pkg>@0.2.2-rc.5` 把官方 npm 发布的 tarball 解到 `~/.capy/work/up-04/<pkg>/package/` 再读 `src/*.ts`。下文所有 `dsh-*` 的 file:line 都指这份解包源码（等价于 node_modules 内容），路径前缀 `~/.capy/work/up-04/`。仓库内证据用仓库相对路径。
>
> 版本/时间数据来自 `npm view @deepseek-ai/dsh versions --json` 与 `time --json`（未认证 registry 读，2026-11-28 实跑）。

---

## B. 代码地图（你这层）

不适用（本线程不涉及运行层）。本线程的地图是「集成层的行覆盖表」，见 E2，不重复。

## C. 运行实况（你这层跑出来的）

不适用（本线程不涉及运行层）。下面只列本线程实际执行过的**只读取证命令**，不含任何应用运行：

| 命令 | 实际结果 |
| --- | --- |
| `npm view @deepseek-ai/dsh versions --json` / `time --json` | 48 个版本，首个 `0.0.1-rc.1` 2026-08-10T19:41Z，末个 `0.2.3-alpha.2` 2026-11-22T09:57Z；`0.2.2-rc.5` 发布于 2026-11-18T13:17Z（104 天 48 版 ≈ 平均 2.2 天/版） |
| `npm pack @deepseek-ai/{dsh,dsh-base,dsh-sdk-minimal,dsh-compaction-basic,dsh-skill-office,dsh-session-title,dsh-web,dsh-web-search-deepseek}@0.2.2-rc.5` | 全部成功（单包 7–47 s，本机首次 47.7 s），解包后逐包读 `src/` |
| `npm pack @deepseek-ai/dsh@0.2.3-alpha.2` | 成功；其 `docs/upgrade-guide/` 比 rc.5 多出 `v0.2.2-rc.5` 与 `v0.2.3-alpha.1` 两节，即 rc.5 之后的上游变更清单 |
| `python` 数 `package-lock.json` | `@deepseek-ai/` 条目 419 条，其中 `0.2.2-rc.5` **329** 条；`0.2.3` 6 条是 `libreoffice-kit*`（独立版本线，与 dsh 无关） |
| `grep -c '"@deepseek-ai/' package.json` | 17（即直接依赖 17 个包，全部钉 `0.2.2-rc.5`，`package.json:68` 起） |
| `curl -sL raw.githubusercontent.com/...` 与 `api.github.com/repos/.../contents` | 同行源码：Cherry Studio / LobeChat / Cline / Continue，见 F 节每条的链接（未认证，`rate_limit` 余量 50 时开始取） |

---

## D. 缺陷与风险清单

按严重度排序。本层没有找到 P0（没有会丢用户数据、泄露凭据、损坏文件的路径）；最重的是「补丁层无回归网」这一类**未来**会出事的结构风险。

`P1 · tests/runtime-patch.test.mjs:18-37 · 补丁层 60+ 行只有 2 条断言 · electron/runtime.mjs:94-152 一次写进约 69 个行 id（13 个 disabled + compaction/sandbox/llm/system-prompt 覆盖 + 约 45 个 insert），测试只钉了 compaction-basic 的四个数与「image-offload 在 insert 里且不在 disabled」；approval、tool-todo、web、web-search、ptc、skill-office、sandbox-policy 全部没有断言。0.22.0 已经出过一次「行写了但没生效」（禁用清单里同 id 优先，见 AGENTS.md 0.22.1 记录），这类缺陷今天只能靠人眼复查 · 为什么是问题：补丁是知行与内核之间唯一的契约，契约没有回归网，任何一次上游 id/键改名都表现为「功能静默消失」，而不是测试红 · 怎么验：`wc -l tests/runtime-patch.test.mjs` → 37 行、`grep -c "^test(" ` → 2`

`P1 · electron/runtime.mjs:33 · 13 个 disabled 全靠字符串 id 撞 sdk-minimal 的行 id · profile 换皮（例如 0.2.2-rc.1 把终端的 optional-terminal-bash/optional-terminal-pwsh 换成 optional-terminal-panel，见 `~/.capy/work/up-04/a2/package/docs/upgrade-guide/README.md` 的 v0.2.2-rc.1 节）就会让某一行变成哑弹：既不报错，也不再生效。我已经核对当前 13 个 id 在 `dsh-sdk-minimal@0.2.2-rc.5/package/cordis.patch.yml` 里全部存在（逐个 grep 命中 1 次），所以**今天没问题**；问题是没有任何测试盯这件事 · 怎么验：`grep -o "id: [a-z0-9-]*" ~/.capy/work/up-04/sdkmin/package/cordis.patch.yml` 与 `electron/runtime.mjs:33` 对照

`P1 · electron/runtime.mjs:200（`patches:[patch]`）· 我们对上游的「改」全在配置层，没有源码补丁，所以不存在「rc.5 的 bug 被我们补掉」这回事 · 上游 `dsh/src/args.ts:26-27` 写明 patch 是「applied after the profile's own layer」，`dsh-base` 的 `cordis.patch.yml:1-9` 写明「A patch replaces the targeted row's whole `config`」，两条都证实 patch 只是行覆盖。结论：知行**没有**修过上游任何模块；`harness/*.mjs` 的 1650 行是我们自己的 11 个 cordis 插件（`grep -l "export const name" harness/*.mjs | wc -l` → 11），不是 patch。 · 为什么是问题：文档/汇报里若把「patch 层」理解成「补丁了上游 bug」，会误判升级风险（升级时要重验的是 69 行配置 + 11 个插件 API，不是几个 diff）· 怎么验：上面两个上游文件的行号

`P1 · 供应链单点：我们钉的 rc.5 已是 RC 线最后一个版本，且 RC 线不再推进 · `npm view` 显示 rc.5 = 2026-11-18，之后只有 `0.2.3-alpha.1`（11-22T03:45Z）与 `alpha.2`（11-22T09:57Z），此后 6 天无新版本。仓库里没有 vendor 副本（`ls patches` 不存在，`node_modules` 不入库，只有 `package-lock.json` 与 `SHA256SUMS*.txt`） · 为什么是问题：「继续钉 RC」这个策略的前提是 RC 还在维护；现在升级只能走 alpha，而 alpha 带的破坏面（见 E3）正好在我们最依赖的 office / PTC / 凭据三处 · 怎么验：`npm view @deepseek-ai/dsh time --json` 尾部三行

`P1 · electron/runtime.mjs:200-210 与 `~/.capy/work/up-04/a2/package/docs/upgrade-guide/README.md`（v0.2.3-alpha.1 节）· 升到 0.2.3 线有硬闸门：Node.js **≥24.22.3**（24.x 线）或 ≥26.13.1 · 我们给内核的 `node.exe` 是 `scripts/pack-runtime.cjs:90` 的 `fs.copyFile(process.execPath, ...)`，即 **Electron 44 的二进制**（`ELECTRON_RUN_AS_NODE=1`），它的 Node 版本我这次没读到（`node_modules/electron` 不存在，无法看 `dist/version`） · 为什么是问题：这一条是升级路线的第一道门，验不过就不用谈 alpha；而它是常量、可离线验 · 怎么验：装依赖后 `node -p "require('electron/package.json').version"` 加 `npx electron -e "console.log(process.versions.node)"`，与 24.22.3 比

`P2 · electron/runtime.mjs:107 · `native-office-skills` 仍给 `dsh-skill-office` 传 `node` 与 `cli` 两个配置键 · rc.5 的该包只接受 `assetRoot`（`~/.capy/work/up-04/so/package/src/index.ts:40-41` 的 `Config = z.object({ assetRoot: ... })`），而这两个键是 v0.2.2-alpha.3 明确删掉的（`a2/package/docs/upgrade-guide/README.md` 的 office-kit/office-operation-tools 两条：Office 操作改用 skill-activated tools） · 为什么是问题：今天是死配置（无害但误导），追 alpha 时 Office 技能的接入方式要按新机制重写，而我们的 `harness/office-tools.mjs` 仍按旧 CLI 形态组织 · 怎么验：读上面两个文件

`P2 · electron/runtime.mjs:94（`{id:'approval',config:{policy:'ask'}}`）+ src/permissions.js:8-14 · 「完全访问」档（sandbox `danger-full-access`）下我们把内核审批策略硬写成 `ask`，而上游 `dsh-base` 是环境驱动：`cordis.patch.yml:259-262` 写 `policy: (DSH_PERMISSION_MODE ?? 'workspace-write') === 'danger-full-access' ? 'never' : 'ask'`。知行自己在 `src/permissions.js:14` 也把 full 档命名成 `workspace-full-with-confirmations`（approval:'ask'），但产品文案写的是「不逐项询问」 · 为什么是问题：这是「界面承诺 vs 内核策略」的口径分叉；内核在 full 档仍会发 `approval/request`，而客户端只接受 `allowed-once`／`rejected`（`electron/runtime-approvals.mjs:163`），我没在 runtime-approvals.mjs 里找到 full 档自动答复的分支 → 用户在完全访问下是否会被弹审批，取决于我没追完的调用方，属未核对，但风险方向明确 · 怎么验：full 档下发一条写文件指令，看是否出现 ApprovalPanel

`P2 · src/session-title.js:15 · `TITLE_MAX_BYTES = 120`，上游两个 profile 都是 80（`dsh-sdk-minimal/package/cordis.patch.yml:106-111` 与 `dsh-base/package/cordis.patch.yml:61-66` 都是 `maxTitleBytes: 80`，fallbackMaxBytes 40） · 清洗正则与上游 `dsh-session-title/src/normalize.ts:4-12` 逐字一致（这是 0.44.0 的成果，抽查为「一致」），只有字节上限放宽了 50% · 为什么是问题：不算缺陷，但「按上游口径」这句话在字节上限这一项上不成立；等上游 LLM 标题（`session-title-llm`）接进来后会出现两套标题长度 · 怎么验：三个文件的 `maxTitleBytes` / `TITLE_MAX_BYTES`

`P2 · electron/main.cjs:237-250 · 自动更新只有「状态广播」，没有版本/通道校验与失败分类 · 对照 Cherry Studio：`src/main/services/AppUpdaterService.ts:42` 有 `classifyUpdateFailure`，`:261` 把「feed 版本 ≠ 已装版本」当作「被撤回」而不是「已最新」，`:306-323` 显式设 `allowDowngrade=false`、`disableDifferentialDownload=false`、按通道加请求头。我们这边 `updater.allowPrerelease=true`、错误直接 `publishUpdate({status:'error',message:String(error)})` → 用户看到的是 electron-updater 的原始英文串 · 为什么是问题：更新是唯一会把二进制换掉的路径，错误分类和降级保护都在这一层；现在等于把判断权交给上游默认值 · 怎么验：读两个文件对应行

---

## E. 上游关系

### E1 上游是谁，发布节奏真不真

- 直接依赖 17 个 `@deepseek-ai/*`：16 个 dsh 机制包钉在 `0.2.2-rc.5`，第 17 个是 `@deepseek-ai/cordis@4.1.0`（框架层，独立版本线，`package.json:67`）；（`package.json:68` 起，`grep -c '"@deepseek-ai/' package.json` → 17）；锁文件里 `@deepseek-ai/` 条目 419 条、其中 329 条是 `0.2.2-rc.5`。
- `npm view @deepseek-ai/dsh versions/time` 实跑：共 48 个版本，`0.0.1-rc.1` = 2026-08-10T19:41Z，`0.2.3-alpha.2` = 2026-11-22T09:57Z。**可核对的发布史只有 104 天**（registry 最早可见版本就在 8-10），所以「最近半年」这个窗口里我们能证明的只有 8-10 起。
- 节奏：rc 段基本 1–7 天一个（0.2.1-rc.1 10-17T03:17 → rc.2 10-17T08:36 → rc.3 10-23 → rc.4 10-26 → 0.2.2-alpha.2 10-27），一个 minor 从 alpha 到 rc 约 1–2 周。
- 我们钉的 `0.2.2-rc.5` 发布于 **2026-11-18T13:17Z**；之后只有 `0.2.3-alpha.1`（11-22T03:45Z）与 `alpha.2`（11-22T09:57Z）。到今天（11-28）**10 天没有新版本、6 天没有 alpha**。也就是说：RC 线没有 rc.6，我们钉的是这条线的终点。

### E2 我们和上游差多少（实测口径）

先说清一件容易误读的事：`electron/runtime.mjs:200` 的 `patches:[patch]` **不是源码补丁**。上游 `dsh/src/args.ts:26-27` 的原话是「Extra patch-list overlays applied after the profile's own layer」，`dsh-base/package/cordis.patch.yml:1-9` 进一步写明「A patch replaces the targeted row's whole `config`」。所以我们和上游的差异只有两类：

1. **约 69 行的 profile 行覆盖**（`electron/runtime.mjs:94-152`）：13 个 `disabled`、5 个整行 config 覆盖（compaction-basic / sandbox-policy / llm-deepseek / system-prompt / agent-loop），其余是 `insert` 的新行。
2. **11 个自有 cordis 插件**（`harness/*.mjs`，共 1650 行；`grep -l "export const name" harness/*.mjs | wc -l` → 11）：office-tools、native-project-fs、native-project-tools、office-skills、office-document-tools、approval-bridge、execution-controls、secure-web、project-worktree、privacy-bridge 等。

**没有第三类**：没有任何一行上游 `.ts` 被我们改过，仓库里也没有 `patches/` 目录或 patch-package 机制（`ls patches` → 不存在；`grep -rn "writeFile.*node_modules" scripts electron harness` → 0 命中）。所以「我们改了上游哪些模块、为什么改」的正确答案是：**一个模块都没改**；我们绕开的是 rc.5 的**构造函数缺口**，代码里写明在 `electron/runtime.mjs:203-208`：「The pinned rc.5 SDK accepts its generic process descriptor through these constructor seams… Re-entering the Electron binary can close stdio without delivering exit before the SDK's Windows termination bound」——做法是给 `HarnessClient` 传自定义 `command/args/cwd/environment`，让内核跑在 bundled node 上，而不是回头改 SDK。

另有一个结构性事实值得写进结论：`dsh-sdk-minimal@0.2.2-rc.5/package/cordis.patch.yml:1-4` 明说「Unlike the ordinary SDK profile, this bundle does not layer over dsh-base: this insert is the complete Cordis tree」。我们用的是 `--profile sdk-minimal`，所以**真正对标的底座是 sdk-minimal，不是桌面版的 dsh-base**；`docs/harness-parity.md` 里大量以 dsh-base（桌面版 200 包）为基准的对照，是「目标形态」对照，不是「同一个底座」对照。两边默认值目前一致（压缩、修剪器、session-title 都同值），但这不是同一个文件。

抽查 7 个「已对标」机制（都真读了 rc.5 的 `src/*.ts` 或 profile yml）：

| 机制 | 上游出处（rc.5 解包） | 知行侧 | 判定 |
| --- | --- | --- | --- |
| 压缩阈值/保留/headroom | `dsh-compaction-basic/src/config.ts:20,23`（0.8 / 0.16）、`:75-76`（headroom 65536、maxTokens 跟随）、`:191-197`（`threshold=floor(min(window*ratio, messageBudget-headroom))`、`retain=floor(messageBudget*retainRatio)`） | `electron/compaction-policy.mjs:11-13,26-31` 同公式同默认；`tests/runtime-patch.test.mjs:22-25` 钉住 `{headroomTokens:65536,maxTokens:65536,thresholdRatio:0.8,retainRatio:0.16}` | **一致**（小窗口把 headroom 收缩到 budget/2 是知行自有处理，已在注释与 `clamped` 标记里声明） |
| 工具结果剪枝 | `dsh-base/cordis.patch.yml:435-440`：`thresholdChars 8192 / headChars 4096 / tailChars 1024` | `electron/runtime.mjs:144` 逐字同值 | **一致** |
| 图像卸载挂载 | `dsh-base/cordis.patch.yml:444-445`（无 config）；`dsh-sdk-minimal/…:67-68` 也有一行 | `electron/runtime.mjs:145` 又 insert 一行同 id | **一致但冗余**：sdk-minimal 已挂，我们在 insert 里再加一行，靠「同 id 最后写入生效」。0.22.0 的坑（disabled 同 id 优先）就出在这个重叠上 |
| 手动 `/compact` | `dsh-base` 挂 `command-compact`（`:358-361`），**sdk-minimal 不挂** | 我们自己 insert（`electron/runtime.mjs:125`，UI 侧 `src/session-commands.js:4`） | **一致**（我们补齐了 sdk-minimal 缺的那一行，属对齐桌面版行为） |
| 会话标题清洗 | `dsh-session-title/src/normalize.ts:4-12` 五条正则 + `:41-55` 按 UTF-8 字节截断不切码点 | `src/session-title.js:9-13` 正则**逐字相同**，`truncateTitleBytes` 同算法 | **一致**（唯一偏差：上限 120 vs 上游 80，见 D 节） |
| `dsh-skill-office` 配置 | `dsh-skill-office/src/index.ts:40-41` 只接受 `assetRoot`（`node`/`cli` 已在 v0.2.2-alpha.3 删除，见 `a2/package/docs/upgrade-guide/README.md` 的 office-operation-tools 条） | `electron/runtime.mjs:107` 仍传 `{assetRoot, node, cli}` | **不一致**（多余键静默失效） |
| 网页搜索 provider 配置 | `dsh-web/src/index.ts:82,111-112` 仍接受 `searchProvider`；`dsh-web-search-deepseek/src/index.ts:54-78` 仍接受 `apiKeyEnv`(role credential-ref)/`baseURL`/`model` | `electron/runtime.mjs:149` 用 `{searchProvider, …}` + `{apiKeyEnv, baseURL, model}` | **一致**（rc.5 仍收这些键；但 v0.2.2-rc.1 的 web-search-billing 已把「凭据来源」改成有序链，追版时要重验） |
| 审批策略来源 | `dsh-base/cordis.patch.yml:259-262` 由 `DSH_PERMISSION_MODE` 决定（danger-full-access → `never`） | `electron/runtime.mjs:94` 硬写 `policy:'ask'` | **有意偏差**（`src/permissions.js:14` 的 `workspace-full-with-confirmations` 就是这个意思），但和界面文案「不逐项询问」冲突，见 D 节 |

### E3 上游做了什么我们没跟上

可核对窗口只有 104 天；每条都能在 `a2/package/docs/upgrade-guide/` 找到原文（该目录是 rc.5 之后新增的两节，等于「rc.5 → 0.2.3-alpha.1」的变更清单）。

**rc.5 → 0.2.3-alpha.1（11-18 → 11-22，17 项，最该看的一节）**
- `sessionQuery.inspectSession` 被移除（`v0.2.2-rc.5/session-query-inspect-session-removed`）——读冷会话的插件不再编译。
- Node PTC 默认改为 persistent-in-memory + scoped REPL（`ptc-default-scoped-repl`）。我们开了 PTC（`electron/runtime.mjs:152`，full 档 + 工作区），这条会直接改我们 PTC 的执行语义。
- 内置 Office 技能从 `office`+`office-docx`+`office-pptx`+`office-xlsx` 收成一个 `office`，`tool-office` 的 `activationSkills` 默认从四个变一个（`office-single-skill`）。我们的 Office 技能体系（`harness/office-skills.mjs` + `native-office-skills`）建立在旧的「按格式分技能」心智上。
- SDK prompt 未指定时区时改报运行时进程时区（`sdk-prompt-time-zone`）；我们另挂 `time-context` 插件（`electron/runtime.mjs:147`），两者可能重复注入时间。
- system-prompt 消费方须累计 section 更新并识别来源通知（`system-prompt-integrations`）。

**v0.2.2-rc.1（11-4，22 项）里与我们相关的**
- 内置配置默认关闭 subagent/Team 的 `interrupt_agent`（`subagent-interrupt-default`）；我们把 `interrupt_agent` 列进了工具白名单（`harness/office-tools.mjs:17`）。
- DeepSeek Search/Fetch 改为按计费选凭据、认证字段换成有序凭据来源（`web-search-billing`）。
- `Session.append` 被替换时须同时实现单事件与数组重载（`session-append-overloads`）。
- 实验终端 bundle 改在 Web 侧栏打开，行 id 从 `optional-terminal-bash/pwsh` 换成 `optional-terminal-panel`（`terminal-bundle-sidebar-backend`）——这类改名正是我们 13 个 `disabled` id 的天敌。
- `BundleInfo.updatable` → `BundleInfo.update`（`plugin-update-method`），我们装了 `dsh-plugin-manager`/`dsh-plugin-market`。

**v0.2.2-alpha.3（11-3）**
- `dsh-office-kit` 取代 `dsh-office-to-pdf`（`office-kit-package`）；Office 操作从技能改成 skill-activated tools，并删除 `skill-office` 的 `node`/`cli` 配置键（`office-operation-tools`）。
- 子代理按名字寻址、`list_agents` 行格式变化、subagent 目录载荷升到 v3（`subagent-names`）。

**更小的但会咬人的**
- rc.3（11-13）：DeepSeek 流式拒答错误码 `MALFORMED_RESPONSE` → `CONTENT_REFUSED`（我们 `src/error-copy.js` 已按新码处理，说明这一条跟上了）。
- rc.4（11-17）：交付组合不再固定 search provider（`web-search-deepseek-model-default`），我们仍然显式钉 `searchProvider:'deepseek-official'`（`electron/runtime.mjs:149`）——行为上更确定，但属于「钉住旧默认」。
- 0.2.3-alpha.1（11-22）：Node ≥24.22.3 / ≥26.13.1（`node-24-22-3`），这是升级的硬闸门（见 D 节）。

### E4 回灌策略：三选一 + 推荐

| 方案 | 成本 | 风险 |
| --- | --- | --- |
| A 继续钉 rc.5 | 0（今天） | RC 线已停更（10 天无 rc.6），后续修复只能自己在配置层绕；office/PTC/凭据三处机制变更永远拿不到；一旦上游对 rc 段做 unpublish/收回，我们没有任何本地副本可重建（`node_modules` 不入库、无 vendor 目录） |
| B 追 alpha（0.2.3 线） | 1 轮 Node 闸门验证 + office/PTC/凭据三处适配 + 全部实包门禁重跑（现有 13 项审批门禁 + 20 项发行门禁）；保守 3–5 人日 | alpha 无兼容承诺，11-22 之后又静默 6 天，可能随时来第三版；我们 69 行覆盖里至少 3 行（office skills / web-search 凭据 / 子代理寻址）要重写 |
| C vendor 上游源码 | 200 包 / 2 万+ 文件进仓库，升级从 `npm ci` 变成手工 merge，体积与许可审查都要重做 | 最高。只有「上游彻底停更或改许可」时才值得 |

**推荐 A + 定期审计，等上游出 0.2.3 的 rc 再一次性走 B。** 理由：我们的差异 90% 在配置层，而配置层的失效方式是「静默」（不报错、功能消失），用脚本每两周核一次「13 个 disabled id 是否还存在、69 行里被引用的配置键是否还在 schema 里」比跟版便宜得多（一次约 1 小时）；真正需要跟版的是 office/PTC 这种机制性变更，而它们只有在出 rc 时才值得吃。前置动作两个：① 先验 Node 闸门（决定 B 是否可行）；② 上游 `unpublish` 风险用「一次性把 17 个 tarball 存进内部制品库」对冲，成本半天。

---

## F. 同行对照

四个：Cherry Studio、LobeChat（桌面端必选）、Cline、Continue。所有链接都是 `github.com/<owner>/<repo>/blob/main/<path>`；本次实际用 `raw.githubusercontent.com/.../HEAD/<path>` 取到（HTTP 200，字节数见各条），仓库默认分支名未逐个核对。

### F1 Cherry Studio（Electron 桌面）

- **它做了我们没做的：多目标、按目标独立调度的自动备份。** `src/main/services/AutoBackupService.ts`（18,026 B）里四类目标各自一套键与间隔（`:42-45` local/webdav/s3/nutstore 的 `*.auto_sync` / `*.sync_interval`），调度状态按目标持久化（`:34-35` `auto-backup:` 前缀、`backup.auto_sync.last_attempt_times`），失败分类 `:27 classifyBackupFailure`，服务停止时 `:124` 用 AbortController 取消。我们只有「保存屏障 + 加密落盘」，没有异地/定时备份——用户误删工作区就是永久丢失。
- **它做得比我们好的：更新器的版本与通道纪律。** `src/main/services/AppUpdaterService.ts`：`:42 classifyUpdateFailure` 把失败分成可行动类别；`:261` 把「feed 版本 ≠ 已装版本」当作「被撤回」而不是「已最新」；`:306-323` 显式 `allowDowngrade=false`、`disableDifferentialDownload=false`、按通道加请求头；`:165` NSIS 指定 `installDirectory`。我们 `electron/main.cjs:237-250` 只有事件到 UI 的转发，错误原文直接给用户。
- **适不适合我们：备份值得做，更新器三项校验立刻可做。** 本地目录备份能复用现有加密桥与定时任务，1–2 天；webdav/s3 各 3–5 天且要先解决凭据存放与脱敏。更新器的 feed 版本校验 + `allowDowngrade=false` 是半天的事。**不要照抄它的一点**：`electron-builder.yml:126` 把 `verifyUpdateCodeSignature` 设为 `false`（`:121-126` 同时有自写 `win-sign.js`、`signExts: [.node]`）——我们本来就未签名，没有 publisherName 可校，但也不该主动关校验。

### F2 LobeChat（Electron 桌面）

- **它做了我们没做的：把「瞬态网络错误」与「真 bug」分开的主进程守卫。** `apps/desktop/src/main/process-error-handlers.ts`（3,206 B）：`:18-28` 列 9 个 Chromium net 错误码（`ERR_NETWORK_CHANGED`、`ERR_NETWORK_IO_SUSPENDED`、`ERR_CONNECTION_RESET`…，引 electron#24948），`:55` 起在 `uncaughtException`/`unhandledRejection` 里只吞这一类，其余 `throw` 保留崩溃可见性，注释要求「必须在其余 boot 之前安装」。我们的等价物是 `electron/main.cjs:806-809`：`uncaughtException`/`unhandledRejection` **只记日志不重抛**，等于真 bug 也让进程半死不活地继续跑。
- **它做得比我们好的：更新源可切换。** `apps/desktop/electron-builder.mjs:113-136`：有 `UPDATE_SERVER_URL` 走 generic，没有就回退 GitHub provider；NSIS 段 `:463-478`。我们只有 `ZHIXING_UPDATE_FEED` 一条 generic 通道（`main.cjs:243`），换分发方式要改代码。
- **适不适合我们：崩溃守卫半天，优先级高于看起来更「像功能」的项。** 它直接决定「主进程弹 JavaScript error」这类支持成本。通道切换不急。
- **桌面专项交叉点**：Lobe 的本地数据走 SQLite（`apps/desktop/drizzle.local.config.ts`、`controllers/LocalDatabaseCtr.ts`，2,395 B 控制器），查询/迁移比我们强；但静态保护我们更强（见 F5）。

### F3 Cline（VS Code 扩展，现为 monorepo：`apps/vscode` + `sdk/packages/core`）

- **它做了我们没做的：可回滚的每轮工作树检查点，且恢复本身是事务。** `sdk/packages/core/src/session/checkpoint-restore.ts:44-48` 注释点明关键坑：「`git stash create` 不含 untracked，但恢复要跑 `git clean -fd`」，所以恢复前先 `git stash push --include-untracked`，把对象挪到私有 ref `refs/cline/restore-transactions/<id>`（`:66-68`），暴露 `commit()`/`rollback()`（`:122`/`:133`）；`:462-475` 再说明 stash 的父提交如何还原。`checkpoint-diff.ts:164,193,240` 提供「某检查点 ↔ 当前工作区」的对比计划与 diff。
- **它做得比我们好的：破坏性操作前先造可回滚快照，并把快照的盲区（untracked、.gitignore）写进实现而不是文档。** 我们 `docs/harness-parity.md` 自己写着「仍然没有 git 工作树快照」，改动对比只有工具写入的前后文本（0.30.0）。
- **适不适合我们：不照搬 shadow-git，但取它最便宜的一条。** 全量检查点要处理大仓库、`.gitignore`、Windows 路径与 git 可用性，三天内不现实；「覆盖写/批量替换前，把本次涉及的文件先快照到加密工作区，并提供一键回到本次运行前」约 1 天，能覆盖我们最真实的丢数据场景。

### F4 Continue（VS Code 扩展）

- **它做了我们没做的：把 token 计数误差当一等公民。** `core/llm/countTokens.ts`（17,599 B）：`:59-78` `encodingForModel`（js-tiktoken，未知模型回退 gpt-4 / llama2 并**故意高估**）、`:370-377` `getTokenCountingBufferSafety = min(1000, 2% × contextLength)`、`:282-313` `pruneLinesFromTop` 按行扣 token 且保留行边界（`:311` 是 from-bottom 版本）。
- **它做得比我们好的：留缓冲，而不是卡在阈值边缘。** 我们的阈值完全交给内核 `compaction-basic`：headroom 65536，小窗口收缩到 `budget/2`（`electron/compaction-policy.mjs:26-28`），`thresholdTokens = budget - headroom` 时几乎贴着上限压。Continue 的做法是显式减一个 2% 缓冲，并把它算进预算公式。
- **适不适合我们：不要自建 tokenizer（内核 `token-meter` 才是真值，自建会与内核口径分叉），但可以引入缓冲项并让它可见。** 把 `compactionPolicy` 的 threshold 再减一个显式 buffer（例如 1024 或 2%），并在 `compactionSummary()` 文案里写出来——半天，可测（`tests/compaction-policy.test.mjs`）。

### F5 桌面端专项：自动更新签名 / 崩溃恢复 / 本地数据加密

| 主题 | Cherry Studio | LobeChat | 知行现状（对照） |
| --- | --- | --- | --- |
| 自动更新签名 | 自写签名脚本 + sha256 + 原生扩展也签（`electron-builder.yml:121-126`），但**关掉** `verifyUpdateCodeSignature`；NSIS 固定 `guid` 保安装身份（`:129-131`） | win 段只配 `executableName`（`electron-builder.mjs:538-539`），签名由构建环境决定；NSIS 全量配置 `:463-478` | 未签名（多轮发布记录）；`electron/main.cjs:590` `quitAndInstall(true,true)`；没有固定 NSIS guid 的记录 → 升级安装身份靠 productName |
| 崩溃恢复 | 定时多目标自动备份（`AutoBackupService.ts`）+ 退出确认（`RuntimeQuitConfirmationService.ts`，1,126 B） | 主进程守卫：只吞瞬态网络错误、其余重抛（`process-error-handlers.ts:18-28,55`） | renderer 侧有 error boundary + 全局恢复 + 交接账本（`docs/approval-recovery-0.43.0.md`）；主进程侧 `main.cjs:806-809` 只记日志不重抛，也没有瞬态错误白名单 |
| 本地数据加密 | tree 搜索 `safeStorage`/`encrypt`/`keytar` 只命中一个 SSE 测试夹具（0 个实现文件）→ 未核对 | 本地 SQLite（`drizzle.local.config.ts` + `LocalDatabaseCtr.ts`），是否加密未核对 | `electron/main.cjs:35-40`：`safeStorage.isEncryptionAvailable()` 不可用就拒绝写盘，`encryptString` 后原子替换；Windows 上即 DPAPI。`workspace.bin`/`drafts.bin`/`feedback.bin` 同一路径 |

结论：**本地数据加密这一项我们是三者里最保守的**（全量加密 + 不可用即拒写），不需要向同行学；要学的是 Cherry 的备份与更新纪律、Lobe 的主进程守卫、Cline 的可回滚快照、Continue 的预算缓冲。

---

## 未核对

1. **Electron 44.11.5 内置的 Node 版本**：决定 0.2.3 线（要求 ≥24.22.3）能不能上。`node_modules/electron` 不存在，`scripts/pack-runtime.cjs:90` 复制的就是它，未读版本号。
2. **完全访问档下审批是否真的弹给用户**：内核策略 `ask`（`electron/runtime.mjs:94`）与客户端只接受 `allowed-once|rejected`（`electron/runtime-approvals.mjs:163`）已核实，但没追到「谁在 full 档回答这个请求」。
3. **`dsh-agent-loop` 的 `agents` 默认值**：我们用 `{maxParallelToolCalls}` 整行替换，sdk-minimal 原本是 `{agents: []}`。`config-catalog.md:118-135` 只说「startup 创建或恢复的 agent」，没写默认是否等价于省略——按注释推断无害，未验。
4. **`dsh-compaction-basic` 的 `maxTokens` 语义**：我们传 `maxTokens = effective headroom`，但 `resolveCompactSpec`（`src/config.ts:140-215`）里用的是入参 `reservedCompletionTokens`，`config.maxTokens` 只出现在校验与返回结构里。没有追到它在下游是否影响摘要请求的输出上限。
5. **Cherry Studio / LobeChat 是否加密本地库**：两个 tree 里都没搜到 `safeStorage` 实现文件（Cherry 仅一个 SSE 夹具命中），可能用别的封装或依赖注入，未核对。
6. **Cline 现行 checkpoint 实现是 `sdk/packages/core` 还是 `apps/vscode`**：两处都有 checkpoint 相关文件（`apps/vscode/src/core/controller/checkpoints/*`、`sdk/packages/core/src/session/checkpoint-*.ts`），我只读了后者，前者是否为门面未核对。
7. **0.1.x 之前的上游变更**：npm 上 `@deepseek-ai/dsh` 最早可见 `0.0.1-rc.1`（2026-08-10），「最近半年」里 8-10 之前的部分没有任何可核对来源。
8. **同行链接的分支名**：全部按 `HEAD` 取的原文，链接写成 `blob/main/`，若某仓库默认分支不是 `main`，链接会 404（内容本身是 200 取到的）。
