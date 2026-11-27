# 0.42.0 发布过程与核验

## 最终状态

[v0.42.0](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.42.0) 已于 **2026-11-27 12:55:56（北京时间）**公开，状态为预发行版。Release ID 为 `460182987`；标签、构建 provenance 和安装器对应的源码提交均为 `1639c63c9273181fa8f63d9bdd5ed86178aafe1f`，tree 为 `c88625526d187b2049428de82072672414ff10bb`。

正式 [发布工作流 45940385739](https://github.com/daniei-chen/ZhiXing/actions/runs/45940385739) 针对合并后的 main 提交重新构建。候选 PR 的二进制没有直接发布；最终源码、组件、Sites、包内回归、六组 Windows 专项、依赖审计、10 次启动测量、签名状态读取及 18 资产组装均在该正式运行中完成。发布尝试和实际步骤状态见本文件同目录的原始收据、outcomes 与日志。

## 独立校验

| 对象 | 实际核验 |
| --- | --- |
| 正式 bundle ZIP | artifact `15173502180`；342,717,914 字节；SHA256 `6568ca717f0b3562050ace6b5b63e1f86e462719116bfe5390656806a8fadf90`，与 Actions artifact digest 一致 |
| bundle 内 18 项资产 | 独立下载后逐项读取字节，大小和 SHA256 与外层 manifest 全部一致 |
| 发布后远端 18 项资产 | 名称、大小、uploaded 状态、GitHub API SHA256 与本机 manifest 全部一致；缺失、额外和不匹配均为 0 |
| 正式 Windows 小型证据 ZIP | artifact `15173343061`；1,689,809 字节；SHA256 `d17c1fda82942ebb3b9fd29674b4950a5384070d46b26cf43a32f896c1776450`；原收集清单 64 项逐个匹配 |
| 成功发布 receipt ZIP | artifact `15173104731`；1,843 字节；SHA256 `d6fff3afa59e602ee9236da7e3277eb1c3f593c92544be5c6662291647bf11a2`，与 Actions artifact digest 一致 |

独立远端核验见 [remote-verification.json](remote-verification.json)，本机预期值见 [bundle-manifest.json](bundle-manifest.json)。原构建安装器字节已随 Actions bundle 独立下载并重新计算 SHA256；没有第二次下载公开安装器，远端比较采用 GitHub API 提供的 SHA256。`SHA256SUMS-release.txt` 覆盖其余 17 项，外层 manifest 覆盖全部 18 项，包括校验清单本身。

## 证据边界

`acceptance-summary-0.42.0.json` 的 `pending_separate_publish_job` 记录构建完成时状态，保留原始字节；最终公开状态以成功 receipt 和远端核验为准。构建时文档中的未来时态同样不回写到已发布资产。

首候选的换行引用点击失败、几何复现和驱动修复保留在 [候选调查](../candidate-validation.md)。第一次正式 main 发布运行 `45935856822` 的草稿替换出现真实 `EPERM`，Phase 1 为 2 通过、1 失败、后续 4 项未执行；原始报告、截图和日志见 [首次正式发布失败](../release-attempt-1/README.md)。该运行未形成可发布 bundle，publish 被跳过。修复复用既有有界原子替换逻辑后，由新的源码提交重新完成本次正式构建；没有吞掉读档错误、放宽 Phase 1 阈值或覆盖旧失败。

正式截图中的 `pending-human-review` 保持原值，[AI 视觉复核](workbench-visual-review.json) 单独记录，不声称真人或全页面视觉验收。

安装器和应用均为 `NotSigned`。本轮没有运行用户安装升级/卸载、自动更新生命周期、跨 Windows 账户解密或真实云端办公评测，也没有触碰 `D:\应用\知行`。后续文档归档提交晚于发布提交，不能用它替换二进制的源码身份。
