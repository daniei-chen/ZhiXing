# 知行 0.40.0 Windows 验收

## 本版构建

| 项 | 值 |
| --- | --- |
| 版本 | `0.40.0`（产品代码与 0.38.0／0.39.0 相同） |
| 构建源码 | `5a60eb6f4f7c315b8e80db3557b957a6df7d1f78`（`sourceDirty=false`） |
| 包内源码指纹 | `edb7a25d5ae471781d372c5abedb7b134b25afb9c52fa9a675d13d7c64e04390`（100 个文件） |
| 运行时 | Electron `44.11.5` · DeepSeek Harness `0.2.2-rc.5` |
| 安装包 | `ZhiXing-0.40.0-x64.exe` 338,713,579 B · `acb4c16dab0617f7360cb8b9285416660b1677ffa8a39c7f15ad9f0c13b34319` |
| 增量包 | `ZhiXing-0.40.0-x64.exe.blockmap` 314,826 B · `22bd54df5b2acbd1fb63757b81247d4b26d0d4ef0442c5f724ce413689ce779f` |
| 更新描述 | `latest.yml` 342 B · `12e89f57f4e162022d761c47fbdde33b755671b856ec0d3ce92b8e68ac1b79c9` |
| 应用可执行 | `知行.exe` 246,511,104 B · `cf428b2bd5fe57944ebb57ac57128a46734faaa16e81d3b06f263732d493f4af` |
| 签名 | `NotSigned` |

## 测试（全部在本版二进制上跑）

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 源码 | `npm test` | 505：504 通过、1 跳过、0 失败 |
| 组件 | `npm run test:components` | 14/14 |
| 站点 | `npm run test:sites` | 4/4 |
| 打包源码 | `npm run test:packed` | 354：353 通过、1 跳过 |
| 错误文案（真实网络） | `npm run test:errors` | **7/7**（含实包运行时报告 0.40.0；真实 401、真实 ENOTFOUND、ECONNRESET 对照、ECONNREFUSED、TIMEOUT、日志保留真码） |
| 溢出恢复（真实内核） | `npm run test:overflow-recovery` | **4/4** |
| 原生文件导出 | `test-native-files-export-ui.mjs` | 通过 |
| 包内源码核对 | `verify-packed-sources.mjs` | 100 个文件一致 |
| 依赖审计 | `audit-production-dependencies.mjs` | 1,178／1,162 包，0 high、0 critical、32 moderate |
| 启动耗时 | `probe-startup.mjs` ×10 | 693／960／1,165 ms（中位），FCP `null` |
| 安装生命周期 | `qa-install-lifecycle.ps1` | 本版未重跑（0.38.0 安装包上 50 步：35 通过、15 观察、0 失败） |
| 切换压缩 | `test:model-switch` | 本版未重跑（0.37.0 为 5/5） |
| 模型窗口失败文案 | `test:model-window` | 本版未重跑（0.37.0 为 4/4） |

## 证据范围

- 本版**只验证、不改产品**：包内源码指纹与 0.38.0／0.39.0 相同，说明逐特性门禁测的就是前几版已经发给用户的同一份代码。
- 错误文案与溢出恢复两条门禁都在打包 EXE 上跑，属于「Windows 实包」层；401 用例依赖真实访问 `api.deepseek.com`，本机网络波动会让它失败而不是跳过。
- `ENOTFOUND` 的成因是「主机名标签超过 63 个字符」，与「域名不存在」共用错误码但不同成因；普通 `.invalid` 在本机被代理接住，按实际 `ECONNRESET` 断言。
- 未重跑的门禁（`test:chat`／`test:updater`／`test:temp`／`test:compaction`／`test:compact-command`／`test:review`／`test:changes`／`test:actions`／`test:inline-refs`／`test:deliverables`／`test:execution-search`／`test:feedback`／`test:tool-redaction`／`test:restore-gap`／`test:ui-status`／`test:workspace-tools`／`test:tools-ui`）仍是各自最后一次运行时的版本结论。
- 图像卸载（`IMAGE_OFFLOAD_REQUIRED`）仍未覆盖；长会话「内核退出没在 10 秒内确认」仍未复现；真实云端、签名未覆盖。

[本轮迭代](iteration-0.40.0.md) · [审计说明](audit-request-0.40.0.md) · [机制对照](harness-parity.md)
