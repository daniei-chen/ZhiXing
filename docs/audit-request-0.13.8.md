# 知行 0.13.8 外部审计说明

以 `v0.13.7` 为比较基线，包内生产源码为 `fa5d34a2910950c50accf546826980940696b20d`，随包 Harness 固定为 `0.2.2-rc.5`。 [Windows 验收](windows-acceptance-0.13.8.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.13.7-to-v0.13.8.patch` 核对差异。
2. **依赖改动**：`package.json` 的 `overrides` 增加 `"uuid": "^11.1.1"`，把 `exceljs@4.4.0 → uuid@8.3.2` 提到 11.1.1。`uuid@8` 已停止维护且无修复版；`exceljs` 只调用 `v4()`，`uuid@11` 保留 CJS 导出，因此不需要 `npm audit fix --force` 建议的 `exceljs@3.4.0` 降级。
3. 审计数字：生产清单 1,162 个包，0 high、0 critical、32 moderate（上一版 34），unique 通告 3 → 2。
4. **自动更新补验**：`0.13.6 → 0.13.7` 完整链路（下载 286 秒、静默安装、应用被安装器拉起，4 个进程）。这是 `0.13.7` 换 Electron 运行时之后补做的一次验证。
5. **验证脚本的 `relaunched` 字段不可信**：Windows 下中文进程名经 `execFileSync` 传递会编码错乱；按安装路径匹配后手动执行能返回 4，脚本循环内仍报失败。审计时请以进程实测记录为准。
6. 签名仍未验证（无证书）。真实云端、交互式安装、跨账户不能从本机合成结果推断。
