# 知行 0.13.0 · 自动更新

在此之前，「检查知行更新」只查 GitHub 发行记录然后跳转发行页，用户要自己下载安装包再覆盖安装。这一版接入 `electron-updater`，把检查、下载、重启安装做成应用内流程。

## 改动

- **应用内更新链路。** 主进程按 `app-update.yml` 的 GitHub 源检查更新，状态（检查中／有新版／下载进度／已下载／出错）实时推给设置页；下载完成前不会安装，安装必须点「重启并安装」。
- **不擅自安装。** `autoDownload` 与 `autoInstallOnAppQuit` 都关闭，启动后 45 秒只在后台查一次，发现新版本也只显示，不下载。
- **安装包改名。** 产物从 `知行-${version}-x64.exe` 改为 `ZhiXing-${version}-x64.exe`，与 `latest.yml` 里的 `url` 一致，也避免资产名含中文导致更新器拼 URL 出错。
- **补齐构建元数据。** `electron-builder --dir` 不写 `app-update.yml`，新增 `scripts/write-update-config.mjs` 在目录构建后生成，`electron:dist` 已串上这一步。
- **退出路径。** 点「重启并安装」先冲刷工作区保存，再标记 `installingUpdate` 让 `before-quit` 放行，最后由更新器退出并运行安装包。

## 实测

本地 HTTP feed 端到端验证（真实打包应用，`ZHIXING_UPDATE_FEED` 指到临时服务）：

1. `checkDesktopUpdate()` 返回 `available`，版本 `0.99.0`，随后收到 `update:available` 事件。
2. `downloadDesktopUpdate()` 进入 `downloading`，进度到 100%（1,856 bytes），再收到 `downloaded`。
3. 状态序列完整：`checking → available → downloading → downloaded`。

真实 GitHub feed 另测一次：打包应用不带任何覆盖直接检查，返回 `current`，证明 GitHub API 调用、`latest.yml` 下载解析与版本比较在真实网络下都能走通；本版已是最新，所以没有可下载项。

构建产物核对：`app-update.yml` 为 `provider: github / owner: daniei-chen / repo: ZhiXing / releaseType: prerelease`；`latest.yml` 的 `url` 与 `path` 均为 `ZhiXing-0.13.0-x64.exe`，sha512 与安装器一致；`electron-updater` 及 `builder-util-runtime`、`js-yaml`、`lazy-val` 已进包。

## 边界

本地 feed 验证的是检测、下载、校验与状态链路，**不是**从 GitHub 真实下载 338 MB 的完整升级，也没有验证装完后的新版本启动——这两步要等本版发布后用旧安装包实测。更新包未做代码签名，Windows 上安装时仍会触发 SmartScreen 提示；签名证书不到位时这是固有限制。

## 范围

审批、脱敏、沙箱与内核行为未变。源码回归 354/355，目录包回归 322/323（各 1 项受文件符号链接权限限制跳过），组件 14/14，Sites 4/4，Windows 桌面专项 5/5。安装生命周期**未在本版安装包上复跑**，`0.12.12` 的证据不能直接推广到本版。 [Windows 验收](windows-acceptance-0.13.0.md) · [能力地图](harness-capability-map.md)
