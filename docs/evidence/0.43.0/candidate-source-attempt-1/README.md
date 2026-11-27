# 0.43.0 首候选的 Windows 源码验收失败

[源码 run 45954359999](https://github.com/daniei-chen/ZhiXing/actions/runs/45954359999) 的 PR head 为 `feaadaeb575671fa326b9eedd6ac631c7e68f1ce`；实际检出 PR merge `0a69d5c84046b04186ff6fa177e714d8d2e6ec0e`，两者 tree 均为 `b1e06ca5ae74e154be278286f69d0b33774b28b8`。

整体结论为失败：源码 691/691、Sites 4/4 通过，组件和隔离 renderer 为 44/45。质量检查 0 错误、0 警告，仅表示增量范围。没有取消或跳过测试。

唯一失败位于 `tests/conversation-recovery-ui.test.mjs` 的删除重试旅程：旧探针断言 `afterLate.question === null`。当前问题由 `questions.find(...)` 派生，无匹配时为 `undefined`，经序列化省略字段。首轮原件保持失败；后续夹具已把观察范围扩到完整问题队列，不能仅取消断言或把此失败称为环境故障。

本目录保存 Actions artifact 15178860365 的原始 14 个小文件，下载 ZIP 的 SHA256 与 GitHub digest 一致：`1c754c78dffe53246abcc04573bfaa12cec6e343d7a00973ff03d08ca70849e8`。另外保留 API 解码后的完整 job 日志与提交身份核验。该次失败不是后续修复提交的验收；它也不证明 Windows 实包、用户安装或真实云端行为。

## 本地夹具修复与反例

[local-fixture-fix/verification.json](local-fixture-fix/verification.json) 保留修复者的验证原件，[fixture-update.patch](local-fixture-fix/fixture-update.patch) 是相对首候选的精确测试改动。本轮没有为此修改产品代码；仅在测试观察接口将缺失的当前问题规范为 null，并补充完整队列、归属和删除顺序断言。

增强断言包括：工作区写入失败、原生 forget 失败或尚未确认时，两条根会话问题仍保留；确认删除后只删除目标问题；迟到的已删除会话请求不能复活；其他会话问题不占用当前输入区，切到其所属会话后仍能显示对应内联问题。

| 证据 | 实际结果 | 不能证明的内容 |
| --- | --- | --- |
| `source-queue-probe.log`、`queue-probe.mjs` | 执行真实 App 回调的本地 hook 探针通过，队列 2 → 1，其他根会话仍可选择 | 子组件 DOM、窗口、布局与 Windows IPC 未实跑 |
| `negative-control.log` | 在独立 scratch 编译中省略 App 问题队列清理后，以 exit 1 和残留 `target-question` 的深比较断言失败 | 这是有意变异的反例，不是产品源码修复或 Windows 新失败 |
| `generated-syntax.log`、`generated-main.cjs`、`lint.log` | 实际展开的夹具语法与定点静态检查完成 | 静态检查不能代替真实 Electron 旅程 |

[capture.json](local-fixture-fix/capture.json) 记录归档时相关文件指纹及历史执行路径。探针含当时 checkout 的绝对 import 路径，归档原件没有改写路径；复现须明确映射 checkout 后再执行，不能把它当作任意目录可直接启动的完整 Windows 测试。

**该修复后的 Windows 新一轮在本证据检查点尚未执行。** 原有 Windows 平台要求、120 秒时限、实际保存文件字节、其他会话保留与缓存清理断言继续保留。`archive-manifest.json` 已重新生成，覆盖本目录除自身外的全部原件与修复证据；`-text` 保证 checkout 不改变原始换行，原始 JSON／日志不经格式化。
