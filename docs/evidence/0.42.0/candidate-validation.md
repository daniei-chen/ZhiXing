# 0.42.0 候选验收：换行引用的鼠标命中

## 首次 Windows 候选

PR #2 head 为 `cc147ef46404d2a13a2e35e43a77174a4dadc322`，Windows packed [run 45931234274](https://github.com/daniei-chen/ZhiXing/actions/runs/45931234274) attempt 1 最终失败，不能当作全绿候选或正式发行。实际包 provenance 指向这个 head；workflow 的 PR merge SHA 为 `ed33c7c35795c5f3fefb466ff8989c1e7a9b1ab9`，两者不可混用。

原始 [工作面板结果](candidate-1-workbench-result.json) 为 **9/10**。通过的九项包含包身份、真实 Harness 两次 write 与一次 present、四次本地模型请求、卡片和行内引用进入预览、文字上限、显式放大、真实文件移走及重试、九视图、键盘和聊天隔离。应用正常退出，临时目录清理成功。

第十项在实际深色设置、950 × 912 窗口内重新点击 `季度纪要.md` 时失败，栈指向 `test-workbench-preview-ui.mjs:881` → `qa-cdp.mjs:48`，错误为 `Control is obscured 季度纪要.md`。该项后续的窄屏预览、输入可用性和末尾截图未执行，不得算成通过。原始 [失败截图](candidate-1-failure.png) 显示文件引用分成两行，没有可见模态层覆盖正文。

同一 run 的其余结果：包内 406/406，错误文案 7 passed + 5 observed，原生文件 5/5，工具时间线 3/3，Phase 0A 9/9，Phase 1 7/7；这些结果不能抵消新门禁失败。NSIS 虽已生成，仍未安装、未签名、未公开发行。

小证据 artifact `15169630337`：ZIP 1,369,994 字节，SHA256 `0311fa4b30fd536bc5012c43bd7121a65c20cc24205694201c22956c60228d80`，与 GitHub digest 一致；收集清单 42 项文件的大小及 SHA256 全部匹配。本目录保留失败原件和独立几何证据，完整 Windows 结论另由后续候选及正式发布报告提供。

## 根因的可控复现

用生产 `AnswerText`、`styles.css`、真实 Electron 44.11.5 renderer 和相同合成回复复现。300 px 聊天列扣除两侧 48 px 内距及 38 px 助手缩进，得到 214 px 正文；文件引用自然生成两个 `getClientRects()` 片段。

原驱动只取 `getBoundingClientRect()` 的整体矩形中心。实测中心 `(193.29, 167.45)` 命中段落 `P`，不在任一文件引用片段上，因而被误报为遮挡。两个实际片段中心都命中 `CODE.inline-file-ref`；真实鼠标输入点击整体中心时打开回调为 0，点击首片段后为 1。252 px 正文对照只有一个片段，整体中心正常命中。

数据和图分别见 [geometry.json](inline-reference-geometry.json) 与 [geometry.png](inline-reference-geometry.png)。这是 Linux 生产组件几何证据，与 Windows 失败图的换行形态一致；不是第二次 Windows 专项通过，也不承诺跨平台字体及坐标相同。

## 修复与后续门禁

修复限定在测试鼠标驱动：从实际行内片段与视口的交集中选择命中目标的点，再发送原生 CDP 鼠标事件。唯一控件、disabled 和真实遮挡校验继续生效；没有用 DOM click、忽略遮挡或跳过窄屏断言使测试变绿。新增真实 Electron/CDP 回归覆盖换行、遮挡和不可操作控件。

产品的引用渲染、布局、读取权限及预览实现没有为此调整。修复后的 Windows 结果以其实际源码提交和报告为准；本文件保留第一次失败，不回写成通过。

## 修复后的候选与正式构建

修复候选 head `cdda640e37b139ed05c2514db6fe03e2963c0cb4` 的 [源码 run 45934009542](https://github.com/daniei-chen/ZhiXing/actions/runs/45934009542) 完成 607/607 源码、36/36 组件、4/4 Sites；实际源码 checkout 为 PR merge `aecee16e7c93cbd2c590100b946910973be20d0b`，tree 与 head 相同。组件 36 包含新增点击驱动父测试及 6 个子测试，不能解释为 36 个独立产品场景。

[实包候选 run 45934009465](https://github.com/daniei-chen/ZhiXing/actions/runs/45934009465) 从该 head 构建，目录包 406/406，错误文案 7 passed + 5 observed，原生文件 5/5、时间线 3/3、Phase 0A 9/9、Phase 1 7/7、工作面板 10/10。950 × 912 深色窄屏项通过，进程正常退出、临时 profile 删除。小证据 artifact 15169129634 为 1,366,938 字节，SHA256 `3aecaa5d6af07766828fadb54289fa844fc004d51228bc2186e69794bd12273e`；42 个收集文件逐项匹配。截图经 AI 复核，原始人工待审字段不改写。

合并后的正式发布重新构建并跑完全部必需门禁，其完整原件见 [final/](final/)。候选安装器没有公开为正式安装包，也不以候选计数代替最终构建证据。
