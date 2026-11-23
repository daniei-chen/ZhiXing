# 知行 0.12.7 Windows 验收

Windows x64 未签名预发布版。DeepSeek Harness 固定为 `0.2.2-rc.5`。 [迭代记录](iteration-0.12.7.md) · [能力地图](harness-capability-map.md) · [GitHub 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.12.7)

| 检查 | 结果 |
| --- | --- |
| 包内生产源码 | `aad2cfabe6843d20f08bd4cc45230b9c2f7ffa47`，`sourceDirty=false`，Node `v24.19.0` |
| 源码指纹 | `006230233306a9d45e63d979a55cbed40257b59900d3f95f5102136a402f7f3a`，88 个匹配文件 |
| 锁文件 SHA-256 | `d7a9437172d93f1e194ff2755747cfde67cb18c6c1ae601c22dce5259de4cbf2` |
| 源码回归 | 354 项，353 通过，0 失败，0 取消，1 条件跳过 |
| 组件与 Sites | 14/14、4/4；生产构建通过 |
| 目录包回归 | 322 项，321 通过，0 失败，0 取消，1 条件跳过 |
| Windows 桌面专项 | 5/5；真实目录包、真实 Harness、本机合成 Chat Completions |
| 品牌核对 | `verify-brand.mjs` 通过，原始墨竹素材未变 |
| `知行.exe` | 246,317,568 bytes，SHA-256 `a075890ad58e78451900589018c55a6e3d3360075bcf9845ba8daf3bd288d8ba` |
| `知行-0.12.7-x64.exe` | 562,831,210 bytes，SHA-256 `0648a48b00fb7f17f1e14395b49875675ad5a18831074544ac3fef8dff06521b` |
| `知行-0.12.7-x64.exe.blockmap` | 489,648 bytes，SHA-256 `b6dab8e75ee14a7c7f7552b015a3a23f5e0763b7c1578d3026ec50d92f720387` |
| 安装器签名 | `NotSigned` |

安装器由该次验收的目录包以 `--prepackaged` 构建。源码与目录包回归各因 Windows 未授予文件符号链接权限跳过一项 `owner.json` 测试。

## 本轮能力实测

- **原生执行权限预设。** 在真实 Harness 中，同一原生会话依次以完全访问、请求批准、帮我批准、帮我批准运行。每一次的实际命令沙箱模式、加密历史里的 `permission/preset` 事件和审批策略都与桌面选择一致，三次受批复核为 `office_execute`；无项目的诊断返回 `read-only`。真实 Electron renderer 在内核设置显示「本次诊断使用：只读（未绑定项目）」，清除诊断后该文案同步消失。
- **WebP 与单帧 GIF。** 无损 WebP、质量 92 的 WebP 和单帧 GIF 都经 Windows OCR 命中合成手机号并遮罩，生成的副本统一为 PNG，重读副本不再出现原号码；动画 GIF、动画 WebP、把 WebP 改名成 `.png` 以及 BMP 都被拒绝，且不截取首帧。项目图片路径对 WebP、GIF 同样返回 PNG 副本，不支持的扩展名在读出文件前拒绝。原生 `read_image` 的 PNG/JPEG 遮罩副本不变，BMP 仍被拒绝。

## 桌面业务实测

真实目录包、合成供应商与本机 Chat Completions 收件，共 5 项通过：

- 拖放准备生成遮罩副本并持久化不透明本地副本。
- 第一次完整重启恢复草稿，并且只发送一份已批准副本。
- 第二次完整重启重放已批准的同一哈希，没有新增未批准副本。
- 关闭隐私规则前历史像素被拒绝，未发出第三次请求。
- 三个隔离的打包进程均正常退出。

## 生产依赖与证据范围

审核覆盖 1,170 个实际随包安装路径，npm CLI `11.21.3`。锁投影审计为 0 high、0 critical、34 moderate 影响记录，其中 3 条公告直接命中安装路径。Electron、Node、原生库内部和用户自行安装的插件另验。

安装、升级、卸载与重装生命周期在本轮未复跑：本轮改动位于应用内代码，未改 NSIS 配置、数据格式与加密存储，`0.12.6` 的同账户合成资料生命周期证据不被本轮继承，也不据此宣称通过。真实云服务、交互式安装、跨账户解密和真实用户档案迁移未覆盖。WebP/GIF 的桌面点击旅程未单独执行，本轮的证据来自源码回归、目录包回归和真实 Windows OCR 回环。原生 ZIP、完整子会话与附件字节归档、工作目录切换、跨启动文件观察、原生 Auto reviewer、常驻 Host 与 OAuth 仍有缺口。图片遮罩限于 OCR 识别到且命中规则的文字；全面 NER、OCR 漏检、手写、二维码、人脸和图表语义未覆盖。
