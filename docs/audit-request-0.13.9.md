# 知行 0.13.9 外部审计说明

以 `v0.13.8` 为比较基线，包内生产源码为 `20be1b3e257cfdedad337586e5224ce4f629cc4a`，随包 Harness 固定为 `0.2.2-rc.5`。 [Windows 验收](windows-acceptance-0.13.9.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.13.8-to-v0.13.9.patch` 核对差异。
2. **本版改动仅 `src/App.jsx`**：`errorText()` 增加网络错误到用户可行动文案的映射（401／403／429／域名解析／连接拒绝／连接中断／超时／证书）。匹配不到的错误保持原文，不作猜测性改写；原始文本仍进诊断日志。
3. 依赖无变化：1,162 个包，0 high、0 critical、32 moderate、2 条 unique 通告（随包 npm CLI 的 `glob`／`minimatch`）。
4. **错误文案映射未在真实网络故障下端到端实测**——本轮只覆盖构建、目录包回归与 Windows 桌面专项。审计时请勿把「映射表存在」当作「界面显示已验证」。
5. 请求侧超时 90 秒；无供应商配置时点发送会打开供应商设置而不发请求。
6. 签名仍未验证（无证书）。真实云端、交互式安装、跨账户不能从本机合成结果推断。
