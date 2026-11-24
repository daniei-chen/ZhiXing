# 知行全自动迭代目标规范

> 用途：作为每一轮迭代的目标提示词（goal objective）交给 AI 执行。
> 版本：v1 · 基线 0.14.0 · 2026-11-24

---

## 一、目标

把知行做成**可交付的 Windows 桌面产品**：每一轮产出可验证的增量，每一个版本都能被外部 AI 独立审计。

分解为四条主线，缺一不可：

| 主线 | 含义 | 成熟标志 |
| --- | --- | --- |
| 功能真实 | 每个界面元素都连真实内核，没有装饰性按钮 | 能力地图里没有「未接入」项 |
| 证据分层 | 源码 / 合成运行 / Windows 实包 / 真实云端，各层证据独立 | 每层都有可复现记录 |
| 可被审计 | 每版带源码、校验值、验收结论、未覆盖范围 | 外部 AI 能独立复现结论 |
| 用户可交付 | 签名、自动更新、安装生命周期完整 | 双击安装即用，升级不丢数据 |

---

## 二、四条铁律（不可违背）

**1. 不虚报。** 没跑过的测试不写「通过」，没验证的能力不写「已接入」。做不到就写「未覆盖」，并说明为什么。

**2. 证据分层。** 「源码测试通过」≠「打包后可用」≠「Windows 上可用」≠「真实云端可用」。任何结论必须标明它属于哪一层。低层证据不能代替高层。

**3. 每版同步 GitHub。** 每轮结束必须：推送源码、打 tag、发布完整 Windows 安装包（含 SHA256、验收摘要、审计说明、patch）。不发布的版本等于没做。

**4. 不破坏用户环境。** `D:\应用\知行` 是用户的真实工作环境。任何测试安装到别处都会**卸载**它（同 appId），必须：先备份 → 测试 → 用原安装包恢复 → 启动确认。

---

## 三、每轮循环（Round 模板）

每轮 60–90 分钟，按以下顺序执行，**不跳步**：

### 0. 接状态（5 分钟）
```powershell
git log --oneline -3            # 上轮提交
(Get-Item 'D:\应用\知行\知行.exe').VersionInfo.ProductVersion   # 用户装的版本
Get-Process | Where-Object { $_.ProcessName -match '知行' } | Measure-Object   # 是否在跑
```
读上一轮的「下一轮」结论——那是本轮起点。

### 1. 选目标（5 分钟）
从**待办池**（第九节）取一项，或延续上轮明确遗留的问题。一次只做一件，做完再换。

### 2. 实现（20–40 分钟）
最小改动。改之前先读现有代码，不要凭记忆重写。涉及产品决策的记进 `AGENTS.md`。

### 3. 验证（10–20 分钟）
按**证据分层**逐层跑（第五节），跑不动的层明确写「未覆盖」。

### 4. 发版（15 分钟）
走**发版清单**（第四节）17 步，一步不能省。

### 5. 文档（10 分钟）
产出**四件套**（第六节）。

### 6. 恢复环境（5 分钟）
装回用户环境，启动确认 4 个进程，读日志确认版本字段。

### 7. 收尾（5 分钟）
更新能力地图，把「下一轮」写清楚。

---

## 四、发版清单（17 步，按序执行）

```powershell
cd D:\AI\codex\codex4\office-agent
$env:PATH="D:\应用\node;" + $env:PATH
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

| # | 动作 | 命令 / 要点 |
| --- | --- | --- |
| 1 | 升版本 | `npm version X.Y.Z --no-git-tag-version` |
| 2 | 提交代码 | 语义化 message，说明**为什么**而不只是改了什么 |
| 3 | 构建目录包 | `npm run electron:dist` |
| 4 | 打安装包 | `npx electron-builder --win nsis --x64 --prepackaged release/win-unpacked --publish never` |
| 5 | 源码回归 | `npm test` → 期望 `fail 0` |
| 6 | 组件回归 | `npm run test:components` |
| 7 | 站点回归 | `npm run test:sites` |
| 8 | 目录包回归 | `npm run test:packed -- ".\release\win-unpacked\知行.exe"` |
| 9 | Windows 桌面专项 | `node scripts/test-native-files-export-ui.mjs "release\win-unpacked\知行.exe"` |
| 10 | 包内源码核对 | `node scripts/verify-packed-sources.mjs "release\win-unpacked\resources\app" ".preview\qa-X.Y.Z\packed-source-manifest.json"` |
| 11 | 依赖审计 | 先建 `.preview\qa-X.Y.Z\dependencies`，再跑 `audit-production-dependencies.mjs` |
| 12 | 启动测量 | `node scripts\probe-startup.mjs "release\win-unpacked\知行.exe" 10` |
| 13 | 取哈希 | 安装器 / blockmap / latest.yml / 知行.exe 各取 size + SHA256 |
| 14 | 组装资产 | 18 个文件进 `.preview\qa-X.Y.Z\release-assets`（见下） |
| 15 | 推送打 tag | `git push origin HEAD:main` + `git push origin vX.Y.Z` |
| 16 | 发布 Release | `gh release create --prerelease --verify-tag` + 逐文件 `--clobber` 上传 |
| 17 | 校验发布 | 用 `gh api .../releases/<id>/assets` 取 digest，与 `SHA256SUMS-release.txt` 比对，期望 `mismatched=0` |

**资产 18 件**：安装器、blockmap、latest.yml、build-provenance.json、app-update.yml、packed-source-manifest.json、production-inventory.json、production-sbom.cdx.json、advisories-by-path.json、harness-capability-map.md、iteration-X.Y.Z.md、windows-acceptance-X.Y.Z.md、audit-request-X.Y.Z.md、signing.md、release-notes-X.Y.Z.md、ZhiXing-vA-to-vB.patch、acceptance-summary-X.Y.Z.json、SHA256SUMS-release.txt

---

## 五、证据分层（每层都要有记录）

| 层 | 怎么取得 | 能证明什么 | 不能证明什么 |
| --- | --- | --- | --- |
| **源码** | `npm test` / `test:components` / `test:sites` | 逻辑正确 | 打包、运行时行为 |
| **合成运行** | `test:packed` | 打包后模块可加载 | Windows 窗口、真实文件 |
| **Windows 实包** | `test-native-files-export-ui` + 安装/升级实测 | 桌面环境真能用 | 真实云端、多账户 |
| **真实云端** | 真实 Key + 真实服务 | 端到端可用 | —（尚未覆盖） |

**报告格式**：始终写「哪一层的证据」，例如「目录包回归 322/323」而不是「测试通过」。

---

## 六、文档四件套

| 文件 | 写什么 |
| --- | --- |
| `docs/iteration-X.Y.Z.md` | 这版解决什么问题、怎么改的、结果、**边界** |
| `docs/windows-acceptance-X.Y.Z.md` | 验收表格：源码提交、指纹、各层测试数、启动数据、哈希、签名状态、证据范围 |
| `docs/audit-request-X.Y.Z.md` | 给外部审计的检查顺序 + 已知限制 |
| `release-notes-X.Y.Z.md` | 面向用户的变更 + 下载 + 校验值 |
| `docs/harness-capability-map.md` | **累计**能力地图：已接入/未验证/未接入 + 实测表格 |

**边界段落是硬性要求**：必须明确写「本轮没验证什么」。

---

## 七、环境与已知坑

| 坑 | 表现 | 处理 |
| --- | --- | --- |
| `ELECTRON_RUN_AS_NODE` | Electron 启动即退出 | 每条启动命令前 `Remove-Item Env:ELECTRON_RUN_AS_NODE` |
| PATH 损坏 | `D:\应用\node` 解析成 `\应用\node\` | 每次前置 `$env:PATH="D:\应用\node;"+$env:PATH` |
| appId 相同 | 装到任何目录都会卸载 `D:\应用\知行` | 测试前 `backup-install.ps1 -Mode Backup`，测完装回 |
| 中文路径 + PowerShell | `Get-Item '<中文>'` 静默失败 | 用 Node `fs` 读，或路径匹配代替名称匹配 |
| 中文进程名 + execFileSync | 编码错乱匹配不到 | 按 `.Path` 匹配，不按 `ProcessName` |
| `npm install` 拦 postinstall | electron 二进制缺失，打包报 `electronDist does not exist` | `node node_modules\electron\install.js` |
| GitHub API 抖动 | `EOF` / digest 核对全 MISMATCH | 重试 3 次；核实是网络不是资产丢失 |
| 打包源文件被改 | 构建后改源码 → `sourceDirty` 不准 | 构建前提交；工具脚本改动不影响 provenance |
| 版本号格式 | exe 报 `X.Y.Z.0`，feed 报 `X.Y.Z` | 比较前 `.replace(/\.0$/,'')` |

---

## 八、当前基线（0.14.0）

- 版本 `0.14.0`，Electron `44.11.5`，Harness `0.2.2-rc.5`
- 用户环境 `D:\应用\知行`，4 进程正常
- 回归：源码 363/364、组件 14/14、站点 4/4、目录包 322/323、桌面 5/5
- 启动中位数：836 / 932 / 1,102 ms
- 依赖：1162 包，0 high / 0 critical / 32 moderate（2 条 unique，均不可达）
- 自动更新：**四环全链路已验证**（检测／下载／静默安装／自动重启），探针 `ok: true` 稳定复现
- 签名：`NotSigned`

---

## 九、待办池（按优先级）

**P0 — 欠账，优先还**
1. 错误文案端到端实测：假 Key 触发真实 401、不存在域名触发 DNS 失败，确认界面显示新文案（连续两版遗留）
2. 安装生命周期复跑（Electron 升级后未重验）

**P1 — 交付门槛**
3. 代码签名证书（需用户购买，非技术阻塞）
4. 真实云端接入（需 API Key）
5. 安装器残留进程问题（功能无损，体验瑕疵）

**P2 — 能力扩展**
6. 跨账户数据解密验证
7. 原生 Auto 审阅器、常驻 Host、OAuth、原生 ZIP、子会话/附件归档
8. 交互式安装 UI

**P3 — 工程卫生**
9. 3 个未合入的 hardening worktree
10. `.preview` 下历史目录清理
11. `%LOCALAPPDATA%\zhixing-updater` 323 MB 缓存清理策略

---

## 十、直接复制的目标提示词

```
目标：全自动迭代知行（Windows 桌面 AI 办公助手）到产品成熟。

每轮 60–90 分钟，按 Round 模板走：接状态 → 选目标 → 实现 → 分层验证 → 发版 → 文档 → 恢复用户环境。

铁律：
1. 不虚报——没跑过的测试不写通过，没验证的能力不写已接入，做不到就写未覆盖并说明原因。
2. 证据分层——源码 / 合成运行 / Windows 实包 / 真实云端，结论必须标明属于哪层，低层不能代替高层。
3. 每版同步 GitHub——推送源码、打 tag、发布完整安装包（SHA256 + 验收摘要 + 审计说明 + patch），不发布的等于没做。
4. 不破坏用户环境——D:\应用\知行 是用户真实环境，任何测试安装都会卸载它（同 appId），必须备份→测试→恢复→启动确认。

每版必须交付：装配 17 步全走完、18 个资产、文档四件套、能力地图更新、边界段落写清本轮没验证什么。

当前基线 0.14.0。待办池 P0：错误文案端到端实测（真实 401 / DNS 失败）、安装生命周期复跑。
```
