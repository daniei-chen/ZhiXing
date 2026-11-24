# 知行 0.14.0 外部审计说明

以 `v0.13.9` 为比较基线，包内生产源码为 `b1e7d234c97e13ddf7160d2fb55dd8d38df326e3`，随包 Harness 固定为 `0.2.2-rc.5`。 [Windows 验收](windows-acceptance-0.14.0.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.13.9-to-v0.14.0.patch` 核对差异。
2. **本版是纯前端重构**：新增 `src/error-copy.js`，把原先在五个组件里各定义一份的 `errorText` 收成共享模块；网络错误映射此前只存在于 `App.jsx`，现在覆盖供应商设置、定时任务、插件市场与 Harness 插件。
3. `errorText` 入参改为 `String(error?.message ?? error)`，避免非 Error 值触发二次异常。
4. 依赖无变化：1,162 个包，0 high、0 critical、32 moderate、2 条 unique 通告。Electron 仍为 `44.11.5`。
5. **错误文案映射仍未在真实网络故障下端到端实测**——本轮覆盖源码、组件、站点、目录包与 Windows 桌面专项，未构造真实 401／DNS／超时。请勿把「映射存在且已共享」当作「界面显示已验证」。
6. 签名仍未验证（无证书）。真实云端、交互式安装、跨账户不能从本机合成结果推断。
