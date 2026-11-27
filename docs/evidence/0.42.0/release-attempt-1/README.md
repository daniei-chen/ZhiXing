# 0.42.0 首次正式发布验收：草稿替换失败

**本次正式验收失败，未发布。** 2026-11-27 的 Windows 实包 Phase 1 专项在替换加密草稿文件时收到真实 `EPERM`。后续资产装配与最终门禁均拒绝通过，发布 job 被跳过。先前 PR 候选的通过结果不能替代这次 main 构建的结果；本目录固定保留失败原件，不随后续修正改写。

## 身份与下载核验

| 项目            | 实际值                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工作流          | [Windows milestone prerelease / 45935856822](https://github.com/daniei-chen/ZhiXing/actions/runs/45935856822)，attempt 1，`push` main                               |
| Windows job     | [140298875476](https://github.com/daniei-chen/ZhiXing/actions/runs/45935856822/job/140298875476)，`failure`                                                         |
| 版本            | `0.42.0`                                                                                                                                                            |
| 实际源码提交    | `33b36f5d6799001f13a5c946e6331732c8df2709`，`sourceDirty: false`                                                                                                    |
| 源码树          | `ecd04c431cd4673e007dc5dac954ee95d9470929`                                                                                                                          |
| 构建运行时      | Windows `10.0.26100` x64，Node `24.19.0`                                                                                                                            |
| 应用运行时      | Electron `44.11.5`，Chrome `152.0.7977.169`，内嵌 Node `24.22.3`                                                                                                    |
| 包内核对        | 102 个文件匹配；指纹 `27449e4beb3da21ac6f5a1b0434851c088314fe1fe7d47bc9b99d75266990c66`                                                                             |
| 小证据 artifact | [15171194643](https://github.com/daniei-chen/ZhiXing/actions/runs/45935856822/artifacts/15171194643)，`release-evidence-33b36f5d6799001f13a5c946e6331732c8df2709-1` |
| ZIP 字节数      | `1,435,312`                                                                                                                                                         |
| ZIP SHA256      | `63edd4f3ca21b1543462fc53aeb6245d451b90a105aa8d9bd5d688e9f6293260`                                                                                                  |

ZIP 已独立下载并计算 SHA256，与 GitHub artifact API 的 digest 相符；解压前拒绝绝对路径、父目录穿越及符号链接。下载后的 [collection.json](collection.json) 所列 **62 个文件全部大小及 SHA256 匹配**。这是对 artifact 内容的校验，不是只复述上传日志的 digest。

## 实际失败与边界

[主进程日志](phase1/app-log-tail.txt) 记录 `data:save-drafts` 在同一临时档案内将 `drafts.bin.<uuid>.tmp` 重命名为 `drafts.bin` 时收到 `EPERM: operation not permitted, rename`。随后 `data:load` 经过保存屏障，明确拒绝返回并提示“工作空间保存失败，仍有更改尚未写入”。[失败截图](phase1/failure.png) 实际显示该保存错误和重试入口。

[专项结果](phase1/result.json) 中，第 3 项 `100 continuous characters write bounded drafts without rewriting workspace.bin` 在脚本 `test-phase1-ui.mjs:567` 的最终 `data:load` 核对阶段失败。前置输入过程已经执行，但该项整体仍记失败，不能把它拆成通过来抵消保存异常。

- 已通过 2 项：独立临时 profile 启动；真实拖放附件的本机解析及项目归属。
- 失败 1 项：100 字连续输入期间的草稿独立持久化。
- 后续 4 项未执行：刷新恢复草稿及附件、慢速流式正文与整库写入隔离、最终回复持久化及刷新、关闭前草稿屏障与正常重启。

**具体文件占用者未知。** 现有记录只证明这次原子替换收到 `EPERM`；没有证据将杀毒软件、测试读取采样或其他进程认定为根因。没有通过吞掉 `data:load` 错误、放宽断言或跳过用例使本次验收通过。

失败后的正常退出再次保存成功，日志有 `ZX_PHASE1_QUIT_ACK {"saved":true}`，结果记录 launch 1 的退出码为 `0`、`signal: null`，`processesExited` 和 `temporaryRemoved` 均为 `true`。**退出时重存成功不抵消先前失败，也不证明压力保存路径通过。** 原始结果仍为 `failed`，未被更改为成功。

## 同一次正式构建的其余结果

下表来自同一个 artifact 的日志与专项结果，未引用 PR 候选或普通 main 检查来补足正式验收。完整来源文件名、字节数与哈希保留在 [collection.json](collection.json)，各步骤终态见 [outcomes.json](outcomes.json)。

| 层／门禁                    | 实际结果                                                      |
| --------------------------- | ------------------------------------------------------------- |
| 增量代码质量                | 通过                                                          |
| Windows 源码测试            | 607 / 607                                                     |
| 组件与隔离 Windows renderer | 36 / 36                                                       |
| Sites 源码测试              | 4 / 4                                                         |
| 包内模块与真实 Harness      | 406 / 406                                                     |
| 实包错误文案                | 7 通过，另有 5 条 `observed`；不将观察记录算成通过            |
| 实包原生文件与审批          | 5 / 5                                                         |
| 实包工具时间线              | 3 / 3                                                         |
| 实包 Phase 0A               | 9 / 9                                                         |
| 实包 Phase 1                | **2 通过、1 失败、后续 4 项未执行**                           |
| 实包工作面板与交付预览      | 10 / 10                                                       |
| 目录包、NSIS 与包内来源核对 | 通过；未执行安装器                                            |
| 依赖审计                    | 1,162 包；32 moderate，0 high，0 critical                     |
| 启动测量                    | 10 次；debug port / CDP / 可交互中位数为 675 / 954 / 1,192 ms |
| 18 项资产装配与最终门禁     | 因 `phase1` 失败而拒绝；未传递 release bundle                 |
| 发布 job                    | `skipped`，本次没有公开预发行版                               |

四组 Node 测试均为 0 失败、取消和跳过；这一事实不能抵消实包 Phase 1 的失败。`test:packed` 的计数包含其既定 package-aware、mixed-source 和 source-only 边界，不代表 406 项全部独立覆盖包内产品模块。真实 Harness 与 UI 专项使用本机合成模型服务，不代表真实云端办公任务。

## 原字节归档

本目录只复制以下 **5 份核心原件**；`collection.json` 仍是整个 62 文件 artifact 的原始清单，未为本子集删改条目。其他日志、截图和依赖报告在该 artifact 中，不宣称全部已经存入此目录。这里的 `.gitattributes` 禁用原件的换行转换和空白检查；没有重排 JSON、裁切图片或修改原有 `visualReview`。

| 本目录文件                                         | 原 artifact 路径                                    | 字节数 | SHA256                                                             |
| -------------------------------------------------- | --------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| [phase1/result.json](phase1/result.json)           | `journeys/phase1/phase1-ui-4VvAz3/result.json`      |  5,208 | `94589944d458d58d9ab1ef8dc97e891ba79c5f9d48114f31d68b062840fc62ac` |
| [phase1/app-log-tail.txt](phase1/app-log-tail.txt) | `journeys/phase1/phase1-ui-4VvAz3/app-log-tail.txt` |  1,192 | `80ff16caf8c4cc6440270c9e33fa31424b015616d17904f8efba96bd21913c58` |
| [phase1/failure.png](phase1/failure.png)           | `journeys/phase1/phase1-ui-4VvAz3/failure.png`      | 64,273 | `baaf600525ddd2f1808ef08256de48d1ff70dfffbdacc3edee9f6e087f4efebb` |
| [outcomes.json](outcomes.json)                     | `outcomes.json`                                     |  1,769 | `f1d943c0ee5bf872e4498cca6f8f2968f8602abcc572028a0412f8c20fd99d20` |
| [collection.json](collection.json)                 | `collection.json`                                   | 11,104 | `a8e65783bc06e5cc53949f1578a7933d436d5ccad84e7a94807a07624c10e8ca` |

后续修正及新 Windows 验收另行记录，不能改写本次失败。现有隐私桥的有界 `rename` 重试提供可复用边界：只重试已准备好的加密临时文件替换，不重复运行数据生产者，不先删旧目标；本目录不预先宣称新修正已经通过 Windows。

本轮没有运行用户安装升级／卸载、自动更新生命周期、跨账户解密或真实云端任务；安装器与 EXE 均未签名，没有触碰 `D:\应用\知行`。
