# 0.41.0 正式发布证据归档

本目录来自 main 的正式发布工作流，不复用 PR 候选包。原始记录保留原字节；用户档案、项目目录和安装器不进入此目录。

`original-collection.json` 是 Windows 原始收集清单，保留完整来源记录；本目录仅保留有界日志、界面报告、截图和构建元数据。依赖清单、SBOM 和通告路径使用 [v0.41.0 发行资产](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.41.0)，依赖总览另存为 `dependency-summary.json`。实际归档文件以 `archive-manifest.json` 为准，不将原始收集清单误当作本目录清单。

`acceptance-summary` 的 publication 字段记录构建完成时状态；最终公开状态及远端校验以 `publish-receipt.json` 和 `remote-verification.json` 为准。截图报告里的 pending-human-review 保持原值；AI 视觉复核另记，不改写原报告。

[发布过程与恢复记录](publication.md) · [独立远端核验](remote-verification.json) · [Phase 1 AI 视觉复核](phase1-visual-review.json)
