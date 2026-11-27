# 03 · 构建 / 打包 / 发布 / 自动更新 / 落盘（C / D）

> 审计线程 HOME-15 · 基线 `main a73cc7d`（detached HEAD，工作树干净）· 只读审计，未改产品代码、未 commit、未 push。
>
> 取证口径：通读 `electron-builder.yml`、`scripts/{pack-runtime.cjs,write-update-config.mjs,generate-installer-path-policy.mjs,assemble-release.mjs,release-common.mjs,verify-packed-sources.mjs}`、`.github/workflows/{ci,packed,release}.yml`、`electron/{main.cjs,updater-cache.mjs,app-log.mjs,workspace-persistence.mjs}`、`harness/privacy-bridge.mjs`、`build/installer.nsh`；用 `Get-AuthenticodeSignature` 实测产物签名；真跑 `npm ci`、`npm run quality`、`npm run build`、`npm run test:sites`、`npm run electron:dist`。
>
> 本机环境：Windows 11 10.0.22631，Node 24.x，npm 11.17.0（带 allow-scripts 门禁），Electron 44.11.5，electron-builder 26.18.0。

---

## 结论摘要

一句话：**发布流水线本身很扎实——18 件资产逐件核对、构建 provenance 锚到 commit 与 lockfile、CI 里每一步都有证据落盘；但「自动更新」这一环没有第二个信任锚点：安装包没有代码签名，`app-update.yml` 也没有 `publisherName`，electron-updater 因此静默跳过 Authenticode 校验，整条链只剩「和安装包同源」的 sha512。**

| # | 事项 | 档位 | 影响 | 本轮 |
| --- | --- | --- | --- | --- |
| 1 | 更新信任链缺签名锚点（`publisherName` 缺失 + 安装包 NotSigned） | **P1** | 仓库/账号一旦失守，更新包可直接替换，无第二道验证 | 未修（需证书） |
| 2 | `asar: false`，4.9 万文件散落盘上 | P2 | 安装慢、体积大、包内 JS 可被就地替换 | 未修 |
| 3 | `ZHIXING_UPDATE_FEED` 环境变量在生产包仍生效 | P2 | 能改环境变量的人可以换掉更新源 | 未修 |
| 4 | 更新缓存 TOCTOU：下载后校验一次，安装前不再复验 | P2 | 缓存目录里替换安装包可绕过下载期校验 | 未修 |
| 5 | `config.json` 明文 | P3 | 含 baseUrl / kernel 等非秘密配置，无凭证 | 未修 |
| 6 | `app.log` 明文，脱敏只按字段名匹配 | P3 | 字符串值里的秘密不会被脱敏 | 未修 |
| 7 | 中断构建留下半成品目录，`rm -rf` 在 Windows 上失败 | P3 | 本机复跑构建会撞 ENOTEMPTY/ENOENT | 未修 |
| 8 | `docs/signing.md` 写「0.13.0 及之前未签名」，0.43.0 其实也未签名 | P3 | 审计者会把未签名区间读成已签名 | 未修 |

**实测覆盖**：目录包构建 2 次成功（冷 26m48s / 热 8m24s），NSIS 安装包 1 次成功（252.9s，`338,741,253` 字节）；`latest.yml` 的 sha512 与安装包实测哈希逐字节一致；`Get-AuthenticodeSignature` 对安装包与 `知行.exe` 均返回 `NotSigned`。**没跑的是** CI 专属门禁（`test:packed` 354 项、启动探针、18 件资产组装、publish job）与本机安装生命周期。

---

## A. 这一层是什么

`zhixing` 的构建/发布分三段，边界很清楚：

1. **构建**：`vite build` 产出 `dist/client`，`scripts/prepare-sites.mjs` 产出 `dist/server`；`electron-builder --dir` 把 `dist/client` + `electron/` + `harness/` + 少量 `src/*.js` 打进 `release/win-unpacked`；`afterPack` 钩子（`scripts/pack-runtime.cjs`）再把生产依赖按 `package-lock.json` 逐包拷进去，写 `build-provenance.json`。
2. **发布**：`packed.yml` 在每次 PR/push 上打一个目录包并跑实包用例（不安装、不发布）；`release.yml` 只在 `main` 上按里程碑触发，先过 `eligible` 门禁（版本号、tag 是否已存在），再在 `windows-latest` 上重打一次、跑全部实包用例、核对 18 件资产、最后由独立的 `publish` job 拿 `contents: write` 发布。
3. **更新**：`electron-updater` 在安装版里读 `resources/app-update.yml`，走 GitHub provider 拉 `latest.yml`，比版本、下载、校验 sha512，`quitAndInstall` 交给 NSIS。

三者之间只有一条硬契约：**`app-update.yml` 必须和安装包一起发出去**。`write-update-config.mjs` 就是为目录构建补这个文件——因为 `electron-builder --dir` 默认不写它。

---

## B. 代码地图

### B1 构建配置（`electron-builder.yml`，63 行）

| 行 | 配置 | 后果 |
| --- | --- | --- |
| 4 | `asar: false` | 不打包 asar，4.9 万文件散在 `resources/app` 下；安装/杀毒扫描慢；包内 JS 可被就地替换 |
| 30 | `npmRebuild: false` | 不重编原生模块，依赖 `npm ci` 装好的二进制 |
| 31 | `afterPack: ./scripts/pack-runtime.cjs` | 生产依赖由脚本手工拷，不走 electron-builder 的依赖收集 |
| 40 | `target: nsis` | 只出 NSIS 安装包 |
| 43–48 | `publish: github / daniei-chen / ZhiXing / releaseType: prerelease` | 更新源固定为 GitHub releases |
| 52–53 | `oneClick: false`、`allowToChangeInstallationDirectory: true` | 用户可选安装目录，默认装到用户目录 |

`files` 白名单（7–27 行）只放 `dist/client`、`electron/`、`harness/`、`src/privacy-*.js`、`src/project-core.js`、`src/permissions.js`、`src/store.js`、`src/conversation-state.js`、`src/error-copy.js`、`src/session-commands.js`、`src/provider-options.js`、`src/scheduler.js`、`src/automation-core.js`、`src/office-workflows.js`、`src/kernel-config.js`、`package.json`，并排除 `node_modules`。**渲染层源码只放进去少数几个文件**——这是个好设计：`src/App.jsx` 这类界面代码不进包，包内只有 `dist/client` 的产物。

### B2 打包钩子（`scripts/pack-runtime.cjs`）

1. `UNUSED_PACKAGE_PATHS`（7–12 行）删掉非 win32 的 prebuilds 与 `@types`；
2. 按 `package-lock.json` 的 `node_modules/<pkg>` 逐条拷（59–76 行），**不扁平化**，保留嵌套 peers；
3. `PRUNABLE_FILE`（16 行）删掉 `.map`/`.ts`/`.tsx` 源文件；
4. 把 `process.execPath` 拷成 `runtime/node.exe`（90 行）——因为内核会剥掉 `ELECTRON_RUN_AS_NODE`；
5. 写 `build-provenance.json`（97–100 行）：`sourceCommit`、`sourceDirty`、`builtAt`、`nodeVersion`、`lockSha256`。

`sourceDirty` 的判定范围（95 行）是 `src electron harness scripts package.json package-lock.json .npmrc electron-builder.yml build/installer.nsh vite.config.mjs index.html worker .openai public resources`——**不含 `docs/`**。所以审计文档改动不会污染 provenance，这一点是对的。

### B3 发布流水线（`.github/workflows/release.yml`，354 行）

`eligible` job（17–24 行）先跑 `scripts/release-plan.mjs` 判版本与 tag；`windows` job（52–317 行）在 `windows-latest` 上：

1. `npm ci`（`install`，65–71 行）；
2. `node node_modules/electron/install.js`（`electron`，73–77 行）——**显式补 Electron 二进制**，因为 npm 的 allow-scripts 门禁会拦掉 postinstall；
3. `npm run quality`（`quality`，79–83 行）；
4. `npm run build` + `electron-builder --dir`（`package`，85–97 行）；
5. `npx electron-builder --prepackaged ... --dir` 出 NSIS（`nsis`，99–105 行）；
6. `scripts/verify-packed-sources.mjs` 核对包内源码与 checkout 逐字节一致（`verify`，107–111 行）；
7. 实包用例：`packed`/`errors`/`native`/`tools`/`phase0a`/`phase1`/`workbench`/`approvals`；
8. `Get-AuthenticodeSignature` 记录签名状态（`signature`，265–273 行）；
9. `scripts/assemble-release.mjs` 汇总 18 件资产（`assemble`，310–318 行）。

`publish` job（318–354 行）单独拿 `contents: write`，`scripts/publish-release.mjs` 逐件核对远端资产再发布。

### B4 更新链路（`electron/main.cjs` + `electron-updater`）

- `ensureUpdater()`（235–249 行）：`import('electron-updater')`，`autoDownload=false`、`autoInstallOnAppQuit=false`、`allowPrerelease=true`；
- `update:check`（572–577 行）→ `updater.checkForUpdates()`；
- `update:download`（578–582 行）→ `updater.downloadUpdate()`；
- `update:install`（583–590 行）→ `quitAndInstall(true, true)`（静默 + 重启）；
- 启动 45 秒后自动检查一次（824 行）；
- `app-update.yml` 由 `scripts/write-update-config.mjs` 写进 `release/win-unpacked/resources/`（19–27 行），内容只有 `provider/owner/repo/releaseType/updaterCacheDirName`，**没有 `publisherName`**。

### B5 落盘（`electron/main.cjs` + `harness/privacy-bridge.mjs`）

`safeStorage`（Electron 的 OS 密钥环）加密写：`workspace.bin`、`drafts.bin`、`providers.bin`、`mcp.bin`、`feedback.bin`、`automations.bin`、`vaults/<id>.bin`、`visual/<id>.bin`。明文写：`config.json`（`app:configure-kernel`，491 行）、`app.log`（`AppLog`，795–796 行）、`last-version.txt`（799–803 行）、`updater` 缓存。

`privacy-bridge.mjs` 另有一套 AES-256-GCM（`writeBridge`，21–28 行），用于内核与主机之间的脱敏映射，密钥不落盘。

---

## C. 实测

### C1 环境准备（干净树）

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 安装依赖 | `npm ci` | 1327 包，约 6 分钟（360 s）。**npm 11.17.0 的 allow-scripts 门禁拦掉 7 个 postinstall**，其中真正影响构建的是 `electron`（不装二进制）与 `@deepseek-ai/dsh-subprocess-local`（不生成 spawn helper） |
| 补 Electron | `node node_modules/electron/install.js` | 7.9 s，产出 `node_modules/electron/dist/electron.exe`（246,495,744 B） |
| 补 spawn helper | `node node_modules/@deepseek-ai/dsh-subprocess-local/scripts/ensure-spawn-helper.mjs` | 立即完成 |
| 质量门禁 | `npm run quality` | **0 error / 0 warning**；范围 `adopted-and-changed-scope`（ESLint 116/340 JS、Stylelint 9/9 CSS、Prettier 95/593） |
| 站点测试 | `npm run test:sites` | 4/4 通过 |

**关于 7 个被拦的包**：我逐个查了，只有 Electron 与 spawn helper 是真缺件。`koffi` 的原生二进制走 `@koromix/koffi-*` optionalDependencies（`node_modules/@koromix/koffi-win32-x64/koffi.node` 已在），`node-pty` 的 `prebuilds/win32-x64/*.node` 随包发布，`esbuild` 的平台二进制同理。**结论：`npm ci` 之后补两条命令就够，不需要 `npm rebuild`。**

### C2 构建（`npm run electron:dist`）

| 轮次 | 结果 | 耗时 |
| --- | --- | --- |
| 第 1 次（干净树） | 成功 | **26 分 48 秒**（00:43:18 → 01:10:09） |
| 第 2 次（设备掉线中断后重跑） | 失败：`ENOTEMPTY`（旧 `release/win-unpacked` 残留） | — |
| 第 3 次（先清空 `release/`） | 成功 | **8 分 24 秒**（01:37:32 → 01:45:50） |

失败原因值得记一笔：**electron-builder 在 Windows 上不会自己清空 `appOutDir`，残留目录会让 `afterPack` 拷依赖时撞 `ENOTEMPTY`/`ENOENT`**。而 `rm -rf release` 在 Git Bash 下也可能因文件句柄未释放而失败（我第一次就撞上了）。CI 每次都是干净 runner，所以碰不到；**本机复跑构建必须先确认 `release/` 真的空了**。

两次成功构建的产物尺寸完全一致（`知行.exe` 都是 246,511,104 B，`resources/app` 都是 48,897 个文件，`win-unpacked` 都是 1.3 GB）。**尺寸一致不等于字节一致**——`builtAt` 每次都不同，PE 时间戳也不同，所以「同 commit 两次构建哈希相同」本轮没有验证，也不该假设。第 1 次 26 分 48 秒、第 3 次 8 分 24 秒的差距主要是文件系统缓存，不是配置差异。

### C3 产物（第 3 次成功构建，与第 1 次逐项一致）

| 项 | 实测值 |
| --- | --- |
| `release/win-unpacked` 体积 | **1.3 GB** |
| `resources/app` 文件数 | **48,897** |
| `release/win-unpacked/知行.exe` | **246,511,104 B**（235 MB） |
| Authenticode 状态 | **NotSigned**（`Get-AuthenticodeSignature` 实测） |
| `resources/app-update.yml` | 存在，5 行，无 `publisherName` |
| `builder-debug.yml` | 存在，1804 B |

`app-update.yml` 实测内容：

```yaml
provider: github
owner: daniei-chen
repo: ZhiXing
releaseType: prerelease
updaterCacheDirName: zhixing-updater
```

### C4 更新信任链（代码级）

`electron-updater` 的 `NsisUpdater.verifySignature()`（`out/NsisUpdater.js:84`）：

```js
async verifySignature(destination) {
  const publisherName = (await this.configOnDisk.value).publisherName;
  if (!publisherName) { return; }        // ← 没有 publisherName 就直接返回
  ...
}
```

`configOnDisk` 来自 `AppUpdater` 构造时读的 `app-update.yml`（`out/AppUpdater.js:192`）。`publisherName` 缺失 → `verifySignature` 返回 `undefined` → `verifyUpdateCodeSignature` 整段被跳过。**没有告警、没有日志、没有降级提示。**

`windowsExecutableCodeSignatureVerifier.js` 在 `publisherName` 存在时用 `Get-AuthenticodeSignature` 比对 `SignerCertificate.Subject`。**也就是说：只有配置了 `publisherName`，electron-updater 才会去验签名。**

### C5 完整性链（sha512 vs 签名）

electron-updater 在 Windows 上真正强制的是 **sha512**：`out/AppUpdater.js` 的 `validateUpdate` 会把 `latest.yml` 里的 `sha512` 和下载文件的哈希比对；`out/DownloadedUpdateHelper.js` 缓存校验也用它。**`latest.yml` 与安装包同源（同一个 GitHub release），所以这是一个「同源校验」——它能防传输损坏，不能防发布方被替换。**

`release.yml` 的 `assemble-release.mjs` 会做**构建期**的 sha512 校验（`validateUpdateFeed`，定义在 61–84 行，调用在 245–251 行），把 `latest.yml` 里的 `sha512` 与安装包实测哈希比对，并核对 18 件资产。**但这是发布前的一次性检查，不是运行时的信任锚点。**

#### C5a 本机复现这条门禁（NSIS 安装包实跑）

用与 `release.yml` 相同的两步在干净的 `release/win-unpacked` 上打安装包：

```
npx electron-builder --win nsis --x64 --prepackaged release/win-unpacked --publish never
```

结果（252.9 秒，`EXIT=0`）：

| 产物 | 字节 | 说明 |
| --- | --- | --- |
| `release/ZhiXing-0.43.0-x64.exe` | 338,741,253 | NSIS 安装包 |
| `release/ZhiXing-0.43.0-x64.exe.blockmap` | 314,817 | 差分更新索引 |
| `release/latest.yml` | 342 | 更新 feed |

`latest.yml` 全文：

```yaml
version: 0.43.0
files:
  - url: ZhiXing-0.43.0-x64.exe
    sha512: BB6vNbjSMVf6zq7JdR+AOmrsusoQw6iK92Ec2jB9HtYuqy814z27Tt49fvJxvjcObFxt0MhmeuVZpuhrHuJZ4Q==
    size: 338741253
path: ZhiXing-0.43.0-x64.exe
sha512: BB6vNbjSMVf6zq7JdR+AOmrsusoQw6iK92Ec2jB9HtYuqy814z27Tt49fvJxvjcObFxt0MhmeuVZpuhrHuJZ4Q==
releaseDate: '2026-11-27T17:51:23.869Z'
```

独立复算安装包 sha512（`openssl dgst -sha512 -binary | openssl base64 -A`）得到**完全相同的字符串**，字节数 `338,741,253` 与 `size` 一致。`validateUpdateFeed` 断言的正是这几件事：`version` 唯一、`path` 唯一且等于安装包文件名、`sha512` 恰好两行（文件级 + 全局）且都等于实测值、`url` 唯一、`size` 等于实测字节数。**这几条本机全部通过**，说明该门禁本身是真的在算哈希，不是形式检查。

签名状态（`Get-AuthenticodeSignature`，同一轮产物）：

```
installer: NotSigned   release\ZhiXing-0.43.0-x64.exe
app:       NotSigned   release\win-unpacked\知行.exe
signer:    <none>
```

构建日志对应三行 `no code signing certificate configured, signing is skipped`（`elevate.exe`、`__uninstaller.exe`、安装包本体各一次）——安装包、卸载器和提权辅助程序**三者都未签名**。

顺带确认一个中间产物的收口：NSIS 打包时生成的 `office-agent-0.43.0-x64.nsis.7z`（压到 84,193,449 字节）在安装包写完后被 electron-builder 自己删掉了，最终 `release/` 只剩上表四件 + `win-unpacked/`。它不在 `assetNames()` 的 18 件里，**不会被误发**。

---

## D. 缺陷与风险（按档位）

### D1 · P1：更新信任链缺签名锚点

**事实链**：

1. 安装包 `NotSigned`（C3 实测）；
2. `app-update.yml` 无 `publisherName`（C3 实测）；
3. `NsisUpdater.verifySignature()` 在无 `publisherName` 时直接返回（C4 代码）；
4. 运行时只剩 sha512，而 sha512 来自与安装包同源的 `latest.yml`（C5）。

**后果**：任何能替换 GitHub release 资产的人（账号被盗、CI 被投毒、仓库权限被滥用）都能让全部安装版自动更新到任意代码，**没有任何第二道验证**。这不是「理论风险」——`release.yml` 全文**没有任何 `secrets.` 引用**（一份签名凭据都没接上），`packed.yml` 与 `release.yml` 都设了 `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`（`release.yml:63`、`packed.yml:28`），本机也同样没有证书，所以 CI 与本机**都不可能产出已签名的包**。这里要把话说准：`CSC_IDENTITY_AUTO_DISCOVERY` 本身是 macOS 钥匙串自动发现的开关，在 Windows 上不签名的真正原因是「没有任何证书凭据」（`CSC_LINK`／`CSC_KEY_PASSWORD` 未设），不是这个变量把签名关掉了——写成「流水线主动关掉签名」会歪曲事实，真实状态是「流水线没有任何可签名的凭据」。

**为什么定 P1 而不是 P0**：利用前提是「发布方失守」或「TLS 被破」，不是普通用户能触发的路径；而且 `autoDownload=false` + 安装需点击，降低了自动执行的概率。**但它是整条链上唯一的信任根，所以不能当 P3 处理。**

**流水线自己也知道这件事，而且披露做得比多数项目干净**：

1. `assemble-release.mjs:209–216` 把 `signature-status.json` 读进来，要求 `installer` / `executable` 的 Authenticode 状态在白名单 `['NotSigned','Valid']` 里，并断言 `version` 与 `sourceCommit` 匹配——**NotSigned 是被显式接受的**，不会让发布失败，但也不允许写成别的状态；
2. `assemble-release.mjs:130` 的固定边界文案第一条就是「安装器未签名时须按实际 Authenticode 状态标注，**不能把文件哈希当作发布者签名**」——这句和本报告的 P1 是同一个判断；
3. 每轮发布**现生成** `signing.md` 资产（`assemble-release.mjs:293–298`），内容是本轮实测的两行 Authenticode 状态 + 「文件哈希核对只证明字节一致」；
4. `release-notes-<ver>.md` 尾部自动追加 `Authenticode：\`NotSigned\`` 与 SHA256（`assemble-release.mjs:289`）；`packed.yml:219` 连 PR 候选产物的 artifact 名都叫 `windows-unsigned-candidate-…`。

**所以「不签名」是既定状态而不是遗漏，而且用户能查到。** 但这只降低误解，不降低后果：披露不阻止替换，也不让 `verifySignature` 真的跑一次——诚实标注和信任锚点是两件事，不能因为前者做得好像后者也做了。

**修法（按成本排序）**：

- **买证书签名**（最彻底）：拿到 Authenticode 证书后，`electron-builder` 签名时会把证书主题写成 `app-update.yml` 的 `publisherName`（这是 `signing.md` 自己也预期的路径），`verifySignature` 随之生效。这是唯一能让「第二道验证」真正存在的方案。注意 `docs/signing.md` 已经点出迁移风险：`verifyUpdateCodeSignature` 默认为真，**未签名 → 已签名的第一次升级需要人工验证一次**，别把它当纯增量改动。
- **不改证书的前提下加一层**：把 `latest.yml` 的 sha512 同时写进 `build-provenance.json` 并在运行时比对——**没有意义**，因为两者同源。
- **真正有用的替代**：在 `update:install` 前用 `Get-AuthenticodeSignature` 对**已下载的安装包**做一次校验，并把结果写进 `app.log`；即使没有证书，也能让「包被换过」留下证据。**这是不需要证书就能做的最小改进。**

### D2 · P2：`asar: false`

4.9 万文件散在 `resources/app` 下，带来三个后果：

1. **安装/启动慢**：Windows 对 4.9 万个小文件做杀毒扫描，首次安装明显慢；
2. **包内 JS 可被就地替换**：`electron/`、`harness/` 都是明文 `.cjs`/`.mjs`，改一个字节就能改行为，**没有 asar 的完整性保护**；
3. **更新体积大**：每次更新都要替换大量文件。

`electron-builder` 自己在构建日志里警告过：`asar usage is disabled — this is strongly not recommended`。

**修法**：`asar: true` + `asarUnpack` 放 `runtime/node.exe`、`node_modules` 里的原生模块。**但要注意**：`harness` 会 `require` 包内文件，asar 的虚拟路径需要验证；这是一次真实的改动，不是改一行配置。

### D3 · P2：`ZHIXING_UPDATE_FEED` 生产环境仍生效

`main.cjs:243`：`if (process.env.ZHIXING_UPDATE_FEED) updater.setFeed('generic', ...)`——**没有 `app.isPackaged` 判断**。能改环境变量的人（同用户下的其他进程、被污染的快捷方式）可以把更新源指向任意 HTTP 服务器。配合 D1（无签名校验），这就是一条完整的替换链。

**修法**：只在 `!app.isPackaged` 或显式 `ZHIXING_ALLOW_DEV_FEED=1` 时生效。

### D4 · P2：更新缓存 TOCTOU

`update:download` 下载到 `%LOCALAPPDATA%/zhixing-updater`，`update:install` 直接 `quitAndInstall`。**下载后到安装前没有任何复验**。如果攻击者能在该目录替换安装包（同用户权限即可），就能绕过下载期的 sha512 校验。

**修法**：`update:install` 前重算一次 sha512，与 `latest.yml` 的值比对；不一致就拒绝安装并记日志。

### D5 · P3：`config.json` 明文

`app:configure-kernel`（491 行）把 `configuration` 明文写进 `config.json`。里面是 `model`、`reasoning`、`contextWindow`、`maxTokens`、`baseUrl`、`kernel`——**没有 API key**（key 在 `providers.bin`，加密）。所以泄露的是「用户用什么模型、连哪个 baseUrl」，不是凭证。

**修法**：跟 `workspace.bin` 一样走 `safeStorage`。成本很低，但收益也低——**按 P3 处理，不急着修**。

### D6 · P3：`app.log` 明文，脱敏只按字段名

`app-log.mjs` 的 `redact()` 用 `SECRET_KEY = /(key|token|secret|password|cookie|authorization)/i` 匹配**字段名**，不匹配**字段值**。所以 `{message: 'failed with key sk-...'}` 这种字符串值不会被脱敏。

**修法**：对字符串值也做一次凭证模式匹配（`sk-`、`ghp_`、`Bearer ` 等）。

### D7 · P3：中断构建的残留目录

`electron-builder` 在 Windows 上不清空 `appOutDir`；`rm -rf` 也可能因句柄未释放失败。本机复跑构建会撞 `ENOTEMPTY`/`ENOENT`（C2 第 2 次）。

**修法**：`electron:dist` 前置一个 `scripts/clean-release.mjs`，用 `fs.rm({recursive:true, force:true, maxRetries:5})` 清空并确认。

### D8 · P3：`docs/signing.md` 的版本口径过期，读者会以为「0.13.0 之后已签名」

`docs/signing.md` 开头写的是「`0.13.0` 及之前的所有发行包都是 **NotSigned**」。实测 `0.43.0` 的安装包与 `知行.exe` 仍然是 `NotSigned`（C3、C5a），中间三十个版本也都没有证书。这句话放在 0.43.0 的语境里会被读成「0.14.0 起已签名」，**方向正好相反**：它把最需要警惕的那段版本区间标成了更安全的一侧。

文档后半段「未完成」里其实写清了「证书尚未申请，没有任何一次构建在签名状态下验证过」，所以不是自相矛盾的撒谎，是版本作用域没跟着发版走。**风险低但气人**：一个打算核查 0.43.0 是否签名的审计者，先读到的是「0.13.0 及之前未签名」。

**缓解事实**：真正给下载者看的是每轮现生成的 `signing.md` 资产和 `release-notes` 里的 Authenticode 行（见 D1），那两个永远是最新实测值；过期的是仓库里那份面向开发者的说明。

**修法**：把首句改成「截至 `0.43.0` 的所有发行包都是 NotSigned」并且以后跟着版本走，或者干脆去掉版本号写成「目前所有发行包都是 NotSigned」——后者不会过期。

---

## E. 五个核心问题的直接回答

### E1 自动更新的信任链完整吗？

**不完整。** 缺的是「发布者身份」这一环：安装包没有代码签名，`app-update.yml` 没有 `publisherName`，electron-updater 因此跳过 Authenticode 校验。剩下的 sha512 是**同源校验**——能防传输损坏，不能防发布方被替换。

这条判断在本机重跑过一遍：NSIS 安装包打出来后，`latest.yml` 的两处 sha512 与安装包实测哈希一致、字节数一致（C5a），所以「哈希这条链是真的在算」；同时安装包与 `知行.exe` 双双 `NotSigned`，`app-update.yml` 也确实没有 `publisherName`。**两道检查里只有一道真的存在。** 详见 D1。

### E2 18 件资产怎么数、怎么核对？

`release-common.mjs` 的 `assetNames()`（72–95 行）定义 18 件，逐条是：`ZhiXing-<ver>-x64.exe`、`ZhiXing-<ver>-x64.exe.blockmap`、`latest.yml`、`build-provenance.json`、`app-update.yml`、`packed-source-manifest.json`、`production-inventory.json`、`production-sbom.cdx.json`、`advisories-by-path.json`、`harness-capability-map.md`、`iteration-<ver>.md`、`windows-acceptance-<ver>.md`、`audit-request-<ver>.md`、`signing.md`、`release-notes-<ver>.md`、`ZhiXing-<tag>-to-v<ver>.patch`、`acceptance-summary-<ver>.json`、`SHA256SUMS-release.txt`。

`assemble-release.mjs` 做三件事：① 逐件 `digestFile` 写 `SHA256SUMS-release.txt`；② `validateUpdateFeed` 把 `latest.yml` 的 `sha512` 与安装包实测哈希比对；③ `verifyBundle` 核对 `manifest.json` 与磁盘资产一致。**发布前的核对是充分的**——问题不在「数得对不对」，在「数完之后运行时还信不信」。

第 ② 条我在本机按它的四条断言手工复算了一遍（C5a）：`version`／`path`／两处 `sha512`／`size` 全部与产物一致，`EXIT=0`。所以这门禁不是走过场。另外，`office-agent-0.43.0-x64.nsis.7z` 这类中间产物会被 electron-builder 自己删掉，也不在 18 件名单里，**不会被误当资产发出去**。

### E3 落盘加密到什么程度？

**加密的**：`workspace.bin`、`drafts.bin`、`providers.bin`、`mcp.bin`、`feedback.bin`、`automations.bin`、`vaults/*.bin`、`visual/*.bin`——全部走 `safeStorage`（Windows 上即 DPAPI，绑当前用户）。

**明文的**：`config.json`（无凭证）、`app.log`（脱敏后）、`last-version.txt`、`updater` 缓存（安装包本体）。

**结论**：**凭证与用户内容都加密了，明文里没有秘密**。D5/D6 是「不够干净」，不是「泄露」。

### E4 构建可复现吗？

**可追溯，不完全可复现。** `build-provenance.json` 锚到 `sourceCommit` + `lockSha256` + `sourceDirty`，`verify-packed-sources.mjs` 逐字节核对包内源码与 checkout 一致——**这部分是强的**。但：

- `builtAt` 每次不同，`PE` 时间戳每次不同，**同一 commit 两次构建的 exe 哈希不同**；
- `asar: false` 让文件顺序/元数据影响产物；
- 没有 `SOURCE_DATE_EPOCH` 一类的确定性构建配置。

**结论**：**「同源可验证」做到了，「同 commit 同哈希」没做到**。对桌面应用这是常见取舍，但审计报告里要写清楚，不能宣称「可复现构建」。

### E5 崩溃恢复靠什么？

三层：

1. **工作空间**：`workspace-save-queue.mjs` 串行化保存，`workspace-persistence.mjs` 用 `draftEpoch` 做 overlay 合并，原子替换（`renameEncryptedTemp`）——**崩溃后最多丢最后一次未落盘的改动，不会写坏文件**；
2. **更新**：`last-version.txt` 记录上次运行的版本，启动时能判断「这次是不是更新后第一次启动」；
3. **安装器**：NSIS 自身的回滚。

**缺的**：`RuntimeHandoffs` 是纯内存账本，主进程崩溃时未交接的结果会丢（这是 01 线程的结论，这里只确认更新/落盘层不背这个锅）。

---

## F. 建议（按优先级）

| 优先级 | 动作 | 成本 | 收益 |
| --- | --- | --- | --- |
| P1 | 买 Authenticode 证书，让 `publisherName` 自动进 `app-update.yml` | 中（钱 + 流程） | 补上唯一的信任锚点 |
| P1' | 无证书时的最小改进：`update:install` 前对已下载安装包做一次 `Get-AuthenticodeSignature` 并记日志 | 低 | 包被换过时留证据 |
| P2 | `ZHIXING_UPDATE_FEED` 加 `app.isPackaged` 判断 | 极低 | 关掉一条替换链 |
| P2 | `update:install` 前复算 sha512 | 低 | 关掉 TOCTOU |
| P2 | `asar: true` + `asarUnpack` | 中（要验证 harness 路径） | 体积/启动/完整性 |
| P3 | `config.json` 走 `safeStorage` | 低 | 一致性 |
| P3 | `app.log` 对字符串值也脱敏 | 低 | 防凭证进日志 |
| P3 | `electron:dist` 前置清空 `release/` | 低 | 本机可复跑 |
| P3 | 把 `docs/signing.md` 的「0.13.0 及之前」改成不绑版本的表述 | 极低 | 别让审计者读反 |

---

## 补记：本轮构建的 provenance 实测

```json
{
  "schemaVersion": 1,
  "version": "0.43.0",
  "sourceCommit": "a73cc7d78a8df099cdb074800d03625f16e3a4e4",
  "sourceDirty": false,
  "builtAt": "2026-11-27T17:45:48.270Z",
  "nodeVersion": "v24.19.0",
  "lockSha256": "1d60a0705596bae8b7d88db6f765107cde52a07587fec3c0fe21bf711c5797a0"
}
```

`sourceDirty: false` 证明工作树干净、包内源码与 checkout 一致；`lockSha256` 锚到 `package-lock.json`。这正是 `assemble-release.mjs` 在发布前断言的那几项，**本机也能复现**——这是这一层最扎实的地方。

构建日志里的关键行（两次构建一致）：

```
• copied locked production packages without flattening: 1178
• pruned sources, maps and foreign binaries: 68051 files, 636 MB
• no code signing certificate configured, signing is skipped
Windows installer root limit: 70 UTF-16 code units; longest packaged relative path: 188
```

`1178` 个生产包、剪掉 `68051` 个文件 / `636 MB`——**打包脚本确实在按 `package-lock.json` 逐包拷，而不是把整个 `node_modules` 倒进去**，这是对的。

### 补记之二：安装包这一步也在本机跑通了

`electron:dist` 只出目录包（`win-unpacked`），**不出安装包**；安装包是 `release.yml` 里单独一步 `electron-builder --win nsis --prepackaged`。我把这一步也跑了，用同一份 `win-unpacked`，`--publish never`：

```
• building target=nsis file=release\ZhiXing-0.43.0-x64.exe archs=x64 oneClick=false perMachine=false
• no code signing certificate configured, signing is skipped  (elevate.exe)
• no code signing certificate configured, signing is skipped  (ZhiXing-0.43.0-x64.__uninstaller.exe)
• no code signing certificate configured, signing is skipped  (ZhiXing-0.43.0-x64.exe)
• building block map  blockMapFile=release\ZhiXing-0.43.0-x64.exe.blockmap
EXIT=0  (252.9 秒)
```

所以这一层的结论有安装包做底，不只是「目录包能打出来」：安装包 `338,741,253` 字节、blockmap `314,817` 字节、`latest.yml` 的 sha512 与实测一致、安装包与 EXE 均 `NotSigned`（详见 C5a）。

**没有在本机跑的那部分，明确列在这里**：`release.yml` 的其余门禁（`test:packed` 的 354 项、10 次启动探针、依赖清单与 SBOM、18 件资产组装、`publish` job）都依赖 CI 的完整环境与历史证据目录，本机没有复跑，因此本报告对它们的判断来自代码与流水线定义，不是实测。安装生命周期（安装/升级/卸载）本轮也没有在本机执行——那会动用户真实安装目录。
