# 0.41.0 发布过程与核验

## 最终状态

[v0.41.0](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.41.0) 已于 **2026-11-27 01:29:06（北京时间）**公开，状态为预发行版。Release ID 为 `459715301`；标签和安装器的源码提交均为 `7ef24667ab8d546b94234a21706dffa2c8bae9d6`，tree 为 `0f6a6c76a69f3962f591ac2922120f3d5bf0bbd7`。

正式 [发布工作流 45864550645](https://github.com/daniei-chen/ZhiXing/actions/runs/45864550645) 的 Windows 构建、源码检查、随包检查、桌面专项、安装器装配和资产组装在第一次尝试完成。第二次尝试只重跑发布作业，最终工作流状态为 `success`。

## 首次发布失败与恢复

首次 publish 作业 `140073176424` 已创建精确标签和草稿，但紧接着的读取没有找到草稿，报 `The newly created draft was not found by its real release ID`，因而没有继续发布。后续只读 API 能看到同一草稿 `459715301`，其标签和目标提交正确。证据只能确认创建后即时读取未见草稿，不能推断具体缓存或服务端一致性机制。

重跑失败作业后，新 publish 作业 `140075445262` 继续使用原 bundle artifact `15141142284` 和同一草稿，上传、逐项验证并公开全部资产。源码、tag、已验收二进制和 bundle 没有改变。原始失败记录为 [publish-receipt-attempt1.json](publish-receipt-attempt1.json)，成功记录为 [publish-receipt.json](publish-receipt.json)。

## 独立校验

| 对象 | 实际核验 |
| --- | --- |
| 正式 bundle ZIP | 343,238,282 字节；SHA256 `feeb44c6ffc823f2bd9ac2d158279249723531a8a520e32a870f0418bfc8011d`，与 Actions artifact digest 一致 |
| bundle 内 18 项资产 | 本机逐项读取字节，大小和 SHA256 与外层 manifest 全部一致 |
| 发布后远端 18 项资产 | 名称、大小、状态、GitHub API SHA256 与本机 manifest 全部一致；缺失 0、额外 0、重复 0、不匹配 0 |
| 正式 Windows 小型证据 ZIP | 1,407,476 字节；SHA256 `e8d610e01449c11b9048ecd7d1e26ba0d2097611acef25f6c670adfeadaa98ad`；原收集清单 57 项逐个匹配 |
| 成功发布 receipt ZIP | artifact `15140214609`；1,838 字节；SHA256 `ae6e91ba525252fa3c43310467c2d9b0a046e81af9209eceff985864c7db1825` |

独立远端核验见 [remote-verification.json](remote-verification.json)，本机资产预期值见 [bundle-manifest.json](bundle-manifest.json)。没有第二次下载公开安装器；远端比较使用 GitHub API 提供的 SHA256，原构建安装器字节已经独立下载核验。`SHA256SUMS-release.txt` 校验其余 17 项资产，外层 manifest 则覆盖全部 18 项，包括校验清单本身。

## 证据边界

`acceptance-summary-0.41.0.json` 中的 `pending_separate_publish_job` 是构建时状态，保留原始字节；最终发布状态以成功 receipt 和远端核验记录为准。构建时文档中的未来时态同样不回写到已发布资产。

原始截图报告的 `pending-human-review` 保持原值，AI 视觉复核另记。安装器与应用仍为 `NotSigned`；没有执行用户安装生命周期、跨 Windows 账户解密、真实云端办公评测或 SmartScreen 验收。文档归档提交可以后于发布提交，不能用它替换二进制的源码身份。
