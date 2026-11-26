# 知行 0.32.0 审计说明

面向外部审计的检查顺序与已知限制。结论都标注证据层：源码 / 合成运行 / Windows 实包 / 真实云端；低层不能代替高层。

## 建议检查顺序

1. **确认版本与哈希**：`SHA256SUMS-release.txt` 覆盖 18 个资产；`ZhiXing-0.32.0-x64.exe` 的大小与 SHA-256 应与 `acceptance-summary-0.32.0.json` 一致。
2. **核对源码一致**：`packed-source-manifest.json` 与 `build-provenance.json`（`sourceDirty=false`）。
3. **跑源码层**：`npm test`、`npm run test:components`、`npm run test:sites`。
4. **跑实包层**：`npm run test:packed -- ".\release\win-unpacked\知行.exe"`、`npm run test:errors`（本版重点）、`npm run test:compact-command`。
5. **人工复核 `ENOTFOUND`**：设置 → 供应商，名称随便填，地址填 `https://<64 个 a>.invalid/v1`，Key 填任意 8 位以上字符串，点「拉取模型并保存」。应看到界面提示「解析不到服务地址，请检查网络连接或代理设置。」，且没有新增供应商；主进程日志里能看到带 `（ENOTFOUND）` 的技术句。
6. **复核对照行为**：同样的步骤把地址换成普通的不存在域名（如 `https://qa-xxx.invalid/v1`），本机会被代理接住，界面应显示「连接被中途断开，请检查网络后重试。」——这是环境行为，不是缺陷。

## 本版改了什么（供复核）

- `scripts/test-error-copy-ui.mjs`：DNS 用例换成真正解析失败的地址并硬断言 `ENOTFOUND`；保留被本机网络接住的对照用例；401 探测加重试；日志断言改成按实际用例数比对。
- `package.json` 版本；`docs/iteration-0.32.0.md`、`docs/windows-acceptance-0.32.0.md`、`docs/harness-parity.md`、`docs/harness-capability-map.md`、`AGENTS.md`。
- **产品代码没有任何改动**。

## 已知限制（不要当已通过）

- 本版的 `ENOTFOUND` 是「标签过长导致解析失败」，与「域名不存在（NXDOMAIN）」共用同一错误码但成因不同；本机 DNS 被代理接管，造不出 NXDOMAIN。
- 401 用例依赖真实访问 `api.deepseek.com`；网络中断时即使重试也可能失败，脚本此时会明确失败（不会跳过）。
- 对照用例的错误码取决于本机网络行为，脚本只要求它在映射表里，不硬编码。
- 本轮没有重跑 `test:review`／`test:changes`／`test:actions` 等其它实包套件（本轮只动错误文案脚本）。
- **本版没有为新安装包重跑安装生命周期**，现有 53 步证据属于 0.24.0。
- 真实云端层本版无新增证据；安装包未签名；首次内容绘制仍为 `null`。
