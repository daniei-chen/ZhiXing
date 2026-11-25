# 知行 0.14.12 外部审计说明

本版是**验收版**：没有产品代码改动，用 0.14.0 安装包作历史基线，把安装生命周期里的 `historicalUpgrade` 从未跑变成实测。 [Windows 验收](windows-acceptance-0.14.12.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.14.11-to-v0.14.12.patch` 核对差异（应只有版本号与 `package-lock.json` 同步）。
2. 读生命周期报告 `.preview/qa-0.14.12/install-evidence-20261125-102142-d574e377/report.json`：53 步、38 passed、0 `not_run`，`coverage.historicalUpgrade = passed_same_account_fixture_only`，`baselineInstaller.productVersion = 0.14.0`。
3. 复跑需要三样东西：候选安装包、**由 0.14.0 自己创建的三项目历史档案**、**快捷方式删除之后**取的干净冷备份。历史 fixture 必须由基线版本创建（脚本第 590 行校验 `fixture.sourceAppVersion` 与首个安装包版本一致），并且要有三个自定义项目（升级后才有四个草稿作用域）。
4. **重点质疑**：`historicalUpgrade` 只在同一 Windows 账户、合成档案、单机上成立（`passed_same_account_fixture_only`）。跨账户、跨机器、带真实附件或自动化的历史升级仍未验证；也只测了 0.14.0 → 0.14.12 这一条路径，0.13.x 及更早版本未测。
5. 本版没有重跑七套产品实包验收（`src/` 与 `electron/` 零差异），那批证据继续有效；如需每个安装包都重跑，请自行执行 `npm run test:archive`／`test:zip`／`test:errors`／`test:chat`／`test:updater`／`test:temp`。
6. 真实子任务归档仍未通过（子会话从未发出模型请求）；归档验收仍是合成子会话记录。
7. 依赖未变：1,178／1,162，0 high、0 critical、32 moderate；安装器未签名；真实云端未覆盖。
