# 0.43.0 首候选的 Windows 实包验收失败

[打包 run 45954360110](https://github.com/daniei-chen/ZhiXing/actions/runs/45954360110)、job `140357299267` 检出 PR head `feaadaeb575671fa326b9eedd6ac631c7e68f1ce`。`build-provenance.json` 记录版本 `0.43.0`、`sourceDirty: false`、Node `v24.19.0`；工作流本身的 merge SHA 是 `0a69d5c84046b04186ff6fa177e714d8d2e6ec0e`。本目录只属于这个首候选，不属于后续修复或正式发行。

## 原始结果

| 门禁 | 本次结果 | 证据及范围 |
| --- | --- | --- |
| 目录包模块回归 | 476/476，失败／取消／跳过均为 0 | `logs/packed.log`，559,403.7521 ms；来源分类为 46 个 package-aware、3 个 mixed-source、1 个 source-only **测试文件**，不能写成 476 条断言全部来自包内源码 |
| 错误文案 | 7 项通过，另 5 条 observed | observed 不计入通过数 |
| 原生文件与导出 | 5/5 | 当前脚本的五条实际记录，不外推新审批专项的刷新与恢复行为 |
| 工具时间线 | 3/3 | 原始 `tool-timeline` 报告 |
| Phase 0A | 9/9 | 当前包的既有聊天 UI 专项 |
| Phase 1 | 7/7 | 当前包的草稿、流式持久化及退出专项 |
| 工作面板 | 10/10 | 当前包的标签与交付预览专项 |
| 新增审批与恢复 | **0 项通过、首项失败，其余 12 项未执行** | 启动身份检查失败，`providerRequests` 为空，不能宣称审批业务链通过 |
| NSIS | 构建成功，NotSigned | 没有执行安装、升级或用户安装生命周期；整体必需门禁仍失败 |

详见 [核验摘要](audit-summary.json)、原始 `checks.json` 和 [完整 job 日志](job-140357299267.log)。源码 CI 的 691/691 与组件 44/45 属于[独立源码失败记录](../candidate-source-attempt-1/)，不得混入本表作为实包通过项。

## 审批专项在哪里失败

原始 [result.json](journeys/approvals/approval-recovery-ui-V7ElSh/result.json) 中，首项 `application identity and temporary profile are verified` 在 `launch()` 的身份检查失败：读取窗口 URL 得到空串，断言要求精确的 `zhixing://app/index.html`。堆栈为首候选脚本 `scripts/test-approval-recovery-ui.mjs:550:10`。此时尚未进入允许、拒绝、撤回、刷新和恢复业务用例，模型请求数为 0。

保留 [原始 failure.png](journeys/approvals/approval-recovery-ui-V7ElSh/failure.png)，42,499 字节，SHA256 `8d665777a20919dd8c76e945417ee5450c28e5fdaa142e7fa680df2291bc7e00`。原报告仍为 `pending-human-review`，未改成视觉验收通过。已有 AI 看图观察另放在后续修复记录中，不覆盖原 metadata。失败后的进程正常 exit 0，临时目录清理成功；这些清理结果也不构成审批业务通过。

## 夹具修复的独立证据

[local-launch-fix/approval-launch-review.json](local-launch-fix/approval-launch-review.json) 记录启动时序分析与本地检查，[fixture-update.patch](local-launch-fix/fixture-update.patch) 保留相对首候选的精确 QA 修改。修复等待主 frame 提交精确应用 URL、结束加载，并等实际页面和工作区就绪，再重新取得身份信息；原有六条身份断言、13 项旅程验收及异常拒绝继续保留。只对两种已知导航执行上下文错误重试，不吞其他错误，没有修改产品代码。

本地语法、ESLint、Prettier 与就绪 helper 探针已检查；**修复后的完整应用启动与新一轮 Windows 实包验收在本证据检查点尚未执行**。此处记录修复依据，首轮失败保持失败。

## 原件与校验

下载 artifact 为 `15178314910`，ZIP 1,410,853 字节，SHA256 `b29f4919789da37ff5e98c776cb248ddf6283b7e5a63b42b6fbbe6cb3c076c1c`。下载记录记载其与 GitHub digest 一致；归档时再次复算 ZIP，并核对 `checks.json` 列出的 46 份文件大小与 SHA256。Windows 路径分隔符仅在定位文件时转换，原始 JSON 字节不改。

本目录逐字节保留所有小文本、构建来源、签名状态及审批失败 PNG。其他 19 张成功截图留在原下载 artifact，其路径与指纹列于 [omitted-screenshots.json](omitted-screenshots.json)，没有宣称它们已在本目录内。安装器和目录包二进制不随本失败归档复制。

`archive-manifest.json` 覆盖本目录除自身以外的全部文件；目录内 Git 属性标记 `-text`，防止 Windows checkout 改写原始换行。原始报告不经格式化。仍未覆盖真实云端、签名、用户安装生命周期及人工视觉验收。
