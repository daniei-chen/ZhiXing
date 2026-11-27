# 0.42.0 正式发布证据归档

本目录来自 main 的正式发布工作流，未复用 PR 候选包。Windows 原始记录保留原字节；用户档案、项目目录和安装器不进入此目录。

`original-collection.json` 是 Windows 收集清单；这里保留有界日志、界面报告、截图和构建元数据。完整依赖清单、SBOM、通告路径、安装器和补丁在 [v0.42.0 发行资产](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.42.0)，依赖总览另存 `dependency-summary.json`。实际归档文件以 `archive-manifest.json` 为准，不能把原收集清单误作本目录文件清单。

`acceptance-summary` 的 publication 字段是构建完成时状态，最终公开状态以成功发布收据和独立远端核验为准。截图报告中的 pending-human-review 保留原值，AI 视觉复核另记；静态截图不替代交互断言。

[发布与核验](publication.md) · [独立远端核验](remote-verification.json) · [资产与日志交叉审计](independent-audit.json) · [工作面板 AI 视觉复核](workbench-visual-review.json) · [逐文件归档清单](archive-manifest.json)
