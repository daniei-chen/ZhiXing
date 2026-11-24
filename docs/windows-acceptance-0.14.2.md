# 知行 0.14.2 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。本版没有产品行为变化，记录的是 Electron `44.11.5` 上的安装生命周期复跑结果，并随包新增冷字节备份脚本。 [迭代记录](iteration-0.14.2.md) · [签名说明](signing.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.14.2)

## 本版构建

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `8f14485855d879fabee6d7c845c1fd4f0951eb9a`，`sourceDirty=false` |
| 源码指纹 | `248d3815d590280929a4eef09d9103187cd9f8c6297fcba3c33507b61cf3533e`，90 个匹配文件（与 0.14.1 相同） |
| 锁文件 SHA-256 | `a790ce2be4fcbf84782ee7e8db70e92dce499752906050bc83c748f93391c92b` |
| Electron | `44.11.5` |
| 源码回归 | 369 项，368 通过，0 失败，0 取消，1 条件跳过 |
| 组件回归 | 14 项，14 通过，0 失败 |
| 站点回归 | 4 项，4 通过，0 失败 |
| 目录包回归 | 323 项，322 通过，0 失败，0 取消，1 条件跳过 |
| Windows 原生文件／审批／导出专项 | 5/5 |
| Windows 实包错误文案专项 | 4/4 场景 + 4 条主进程日志配对，退出码 0 |
| 启动测量 | 10 次中位数：`initialise` 782 ms、窗口显示 878 ms、可交互 1,043 ms |
| `知行.exe` | 246,511,104 bytes，SHA-256 `7a67daf873966f326a214c29e4157d66ca66cddd20b259ff34bab1ffedc2f69e` |
| `ZhiXing-0.14.2-x64.exe` | 338,681,360 bytes，SHA-256 `cc1f76eb8e320eb0403e33b0923da9e2d4233324dd49335c50ceb7b24e5ba878` |
| `ZhiXing-0.14.2-x64.exe.blockmap` | 314,722 bytes，SHA-256 `054030f80f61d72f0ef463f38893a3f174c240eaf71c62cfad2a9c0aa7c5de25` |
| `latest.yml` | 342 bytes，SHA-256 `fe83cd701105902e3f3f6352a638b49c73d2b46f81ff72b5ac12366606768c28` |
| 安装器／应用签名 | `NotSigned`（证书未申请） |

## 安装生命周期（候选：0.14.1 安装器）

`pwsh -File scripts/qa-install-lifecycle.ps1 -Mode Run`，同一 Windows 账户、合成 fixture、冷字节备份，退出码 0，44 个步骤，`00:46:12` → `01:07:03`。

| 检查 | 结果 |
| --- | --- |
| 首次安装 | 通过 |
| 同版本覆盖安装 | 通过 |
| 卸载默认保留数据 | 通过 |
| 重装保留数据 | 通过 |
| 外部工作目录启动（三次安装各一次） | 通过 |
| 项目／会话／草稿哈希 | 通过 |
| 加密配置密文保留且可读 | 通过 |
| 装进去的源码 = 测过的源码 | 通过（逐文件比对 `packed-source-manifest.json` 与 `build-provenance.json`） |
| 真实档案 112 个文件字节未变 | 通过（每个安装/卸载步骤后复核） |
| 历史版本升级 | **未跑**（未提供 `-BaselineInstaller`） |
| 界面视觉验收、跨账户解密 | 超出脚本范围 |

证据：`.preview/qa-0.14.1/install-evidence-20261125-004612-9cc7b664/report.json`。

## 0.14.2 安装器与用户环境

| 检查 | 结果 |
| --- | --- |
| 静默安装到 `D:\应用\知行` | 退出码 0，293 秒 |
| 安装后版本 | `0.14.2`（`resources/app/package.json`） |
| 注册表与快捷方式 | 已注册；两条快捷方式按备份逐字节还原，SHA-256 与备份一致 |
| 启动 | 4 个进程 |
| 启动日志 | `app.start {"version":"0.14.2","previousVersion":"0.14.1","updated":true,"electron":"44.11.5"}` |

## 依赖审计结论

生产清单 1,178 个包，0 high、0 critical、32 moderate、2 条 unique 通告（随包 npm CLI 的 `glob`／`minimatch`，仅插件安装时使用）。与 0.14.1 完全一致。

## 证据范围

产品代码、依赖与 0.14.1 相同，本版新增证据全部在「Windows 实包 + 安装生命周期」层。

未覆盖：

- 生命周期整套流程只在 **0.14.1 安装器**上跑过；`0.14.2` 安装器只验证了「真实安装 + 启动」。
- 历史版本升级（`-BaselineInstaller`）未跑，自 0.13.2 起一直如此。
- 生命周期脚本不做视觉验收，也不验证跨 Windows 账户解密。
- 真实云端模型回答、代码签名仍未覆盖。
