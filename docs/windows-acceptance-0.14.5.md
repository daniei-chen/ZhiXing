# 知行 0.14.5 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.14.5`（无产品代码改动，为复跑安装生命周期而发布） |
| 构建源码 | `1563f9b10c29715e24070dbe47bde04fd8f446bb`（`sourceDirty=false`） |
| 包内源码 | 93 个文件，指纹 `852f986a0a255293c5379ecee9f919b24bf9b58784cd8d38909e9dec71475654`（与 0.14.4 相同） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | `ZhiXing-0.14.5-x64.exe`，338,687,473 bytes，SHA-256 `49663298defe6f4fc286939f3804324c652d1d5e489255743990b4d67d1137c9` |
| 应用本体 | `知行.exe`，246,511,104 bytes，SHA-256 `6995ac5f6ef5fd9d310a48372143c2749a146523e096812095ae47ad6218ba97` |
| blockmap | 314,920 bytes，SHA-256 `6881b2daf23103dc96ed3b3cd7b598a75c33fd78047884669884ea217e80ae2d` |
| `latest.yml` | 342 bytes，SHA-256 `127a06dbbf96027402ed8c164a8545f2db649a0f4b5a74316252e31403088717` |
| 签名 | `NotSigned` |

## 安装生命周期（本版核心证据）

`scripts/qa-install-lifecycle.ps1 -Mode Run`，候选安装包即本版安装包，测试安装根 `.preview\i QA\知行-738d`：

| 阶段 | 退出码 | 耗时 | 关键断言 |
| --- | --- | --- | --- |
| 首次安装 | 0 | 342.42 s | 注册项、开始菜单快捷方式、93 个源码文件、`build-provenance` 一致；默认档案字节未变 |
| 首次安装探针 | 0 | 1.2 s | preload 读到合成夹具；正常保存、正常退出 |
| 同版本覆盖安装 | 0 | 496.05 s | 同一注册项、同一源码身份、默认档案字节未变 |
| 卸载（保留数据） | 0 | 20 s | 注册项移除；快捷方式按备份字节还原；档案字节未变 |
| 重装 | 0 | 340.27 s | 注册项与源码身份再次一致；探针再次通过 |
| 最终清理 | 0 | — | 测试安装注销，主机字节与快捷方式恢复，0 残留 |

汇总：**44 步：31 passed、12 observed、0 failed、1 not_run（`historical-upgrade`）**。

## 测试与实包验收

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 379：378 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 331：330 通过、1 跳过、0 失败 |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 5/5 |
| 供应商错误文案 | `test-error-copy-ui.mjs` | 4 场景 + 4 组日志配对 |
| 聊天发送失败 | `test-chat-send-errors.mjs` | 2 场景 + 2 组日志配对 |
| 更新缓存清理 | `test-updater-cache.mjs` | 3/3 |
| 包内源码核对 | `verify-packed-sources.mjs` | 93 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 仓库根 1,178、实装树 1,162；0 high、0 critical、32 moderate、2 条公告 |
| 启动耗时 | `probe-startup.mjs` ×10 | 初始化 788 ms · 窗口 883 ms · 可交互 1,048 ms（中位） |

## 安装回真实用户环境

| 步骤 | 结果 |
| --- | --- |
| 测试前准备 | 两条 `.lnk` 字节备份到 `.preview\qa-0.14.5\user-shortcuts\`；删除后取「零快捷方式」冷备份（114 个文件） |
| 首次装回（错误） | `/S /currentuser` 未带 `/D=`，装到了 `%LOCALAPPDATA%\Programs\office-agent`（342 s，退出码 0）；已卸载并记录 |
| 正确装回 | `/S /currentuser /D=D:\应用\知行`，退出码 0，354 s |
| 版本 | `知行.exe` = `0.14.5`，SHA-256 `6995ac5f…8ba97`，与发布资产一致 |
| 启动 | 4 个进程；`app.start`：`version 0.14.5`、`previousVersion 0.14.4`、`updated true`；`last-version.txt` = `0.14.5` |
| 快捷方式 | 安装器创建的两条被替换回测试前原始字节：桌面 `DE73CA687CCD…`、开始菜单 `EA472C05EC01…`，目标均为 `D:\应用\知行\知行.exe` |
| 用户档案 | 114 个文件；升级前后各复制一份档案、同一份代码打开对比：项目 2→2、会话 0→0、草稿 1→1 |

## 证据范围

- 生命周期只在单机单账户、合成档案上运行；`historical-upgrade` 未覆盖。
- 探针不是视觉验收，不点击界面控件。
- 首次失败的运行（桌面快捷方式目标不符）留下的空注册项与快捷方式已按备份修复，未计入通过证据。
- 安装器未签名；真实云端未覆盖；跨账户解密不在范围。
- 本版未改产品代码，产品行为结论仍来自 0.14.4。

[本轮迭代](iteration-0.14.5.md) · [能力地图](harness-capability-map.md)
