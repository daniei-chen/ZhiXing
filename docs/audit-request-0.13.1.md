# 知行 0.13.1 外部审计说明

以 `v0.13.0` 为比较基线，包内生产源码为 `1153da658f9b3e597f1cce1c8d0220833748c99c`，随包 Harness 固定为 `0.2.2-rc.5`。本版无功能改动，只调整签名开关并补充长时间运行观察。 [Windows 验收](windows-acceptance-0.13.1.md)

1. 校验完整安装器、`latest.yml`、`SHA256SUMS-release.txt`、包内 `build-provenance.json` 与 `packed-source-manifest.json`，并用 `ZhiXing-v0.13.0-to-v0.13.1.patch` 核对差异。本版源码指纹与 `0.13.0` 相同，差异只在构建配置、版本号与文档。
2. 签名行为可复核：不设 `CSC_LINK` 构建，日志应输出 `no code signing certificate configured, signing is skipped` 且产物为 `NotSigned`；设置证书后应变为已签名。**当前没有证书，签名成功路径未经任何验证。**
3. **soak 只覆盖空闲态**：29.8 分钟、54 次采样，工作集 +1.0 MB、句柄 +77、进程数恒为 4。不能由此外推「无泄漏」，带会话与模型往返的负载未测。
4. **目录包回归有 2 项因超时取消**（323 项中 320 通过、0 失败、1 跳过）。取消项未定位，不要视为通过。
5. 自动更新逻辑未改动，其实测结果沿用 `0.13.0`：本地 feed 全链路通过、真实 GitHub feed 返回 `current`。安装生命周期**未在本版安装包上复跑**。真实云端、交互式安装、跨账户与真实用户资料不能从本机合成结果推断。
