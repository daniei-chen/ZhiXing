# 分批代码质量门禁

本轮建立可执行的 ESLint、Stylelint 和 Prettier 门禁。**范围内通过不等于全仓质量达标，也不等于 Windows 实包或真实云端验收通过。** 不为通过格式检查重排已有的 `App.jsx`，不把遗留错误降为警告后宣称清零。

## 范围与基线

初始基线来源是 `718cb62e4018f43553968bd3ff96e9243acd1ecc`。`quality/baseline-718cb62.json` 保存该提交的 508 个文本路径及其 Git blob SHA-1；`.quality-scope.json` 记录基线来源、主动收编文件和生成物边界。

检查时读取 Git 中已跟踪文件和未忽略的新文件，再使用只读的 `git hash-object --stdin-paths` 比较当前内容。这个命令应用 Git 文本属性，不带 `-w`，不会写入 Git 对象。检查不依赖原分支或原提交仍然存在；squash 合并、删除分支和浅克隆不会丢失基线。快照缺失、损坏、来源不匹配或文件散列不完整都会直接失败，不退化为空范围通过。

| 检查      | 默认范围                                                                                          | 当前明确边界                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| ESLint    | 相对基线新增或内容变化的 JS/JSX/MJS/CJS，加上主动收编的 `src/run-status.js`、`src/run-summary.js` | 使用 recommended 正确性规则及 React `rules-of-hooks`；未引入 TypeScript，也未把 `exhaustive-deps` 或 React Compiler 规则算作已覆盖 |
| Stylelint | 新增或变化的 CSS，加上已有三份应用 CSS                                                            | 检查无效值、未定义 Token、未知属性、重复声明等；另有一份不进入产品的运行时 Token 参考文件                                          |
| Prettier  | 基线中不存在的新文本文件，加上主动收编的 `package.json`                                           | 已有文件的功能修改不会强制整文件格式化；门禁输出这些未收编的文件名                                                                 |

`package-lock.json` 和 `docs/evidence/` 是明确排除的生成物。PowerShell、NSIS 等不在这三个工具的语言范围内，不能由门禁通过推断其正确性。现有文件逐批清理后，可以在 `.quality-scope.json` 中主动收编；不要每次修改后重新生成基线以抹去错误。

下载的 Windows 原始日志、签名结果和截图按原字节归档，包含的 CRLF、BOM 及日志空白不做格式化。`docs/evidence/phase-0b/.gitattributes` 仅对具名原始证据路径禁用文本换行转换及 diff 空白检查，保住已记录的 SHA256；不影响产品源码或测试脚本的规则。

## 命令

| 命令                                     | 用途                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run quality`                        | CI 默认入口，运行上述范围内的全部检查                                         |
| `npm run quality:changed`                | 仅检查相对固定快照的新增/修改，不附加主动收编项；不是相对当前 HEAD 的临时差异 |
| `npm run lint`                           | 同一默认范围的 ESLint 和 Stylelint                                            |
| `npm run format:check`                   | 同一默认范围的 Prettier，只读，不自动改写文件                                 |
| `npm run quality:all -- --report <path>` | 扫描全仓并输出完整 JSON 债务清单；存在遗留错误时退出码为 1                    |
| `npm run test:quality`                   | 运行门禁本身的负例、Git 基线、CLI 和换行回归；也已加入 `npm test`             |

质量检查入口（不含 `test:quality`）可追加 `-- --report <path>` 保存不含源码正文的诊断。非豁免错误或警告都会令门禁失败，没有 `--quiet`、警告预算或 `continue-on-error`。需要格式化时，显式对本次文件运行 `npx --no-install prettier --write <file>`，不要对全仓盲目执行。

## 已核对的例外与工具限制

1. `--effort-position` 在 `src/ModelControls.jsx` 的 React inline style 中定义。`quality/runtime-properties.css` 只供静态检查参考，不被应用导入；门禁会核对源文件仍有这个具名绑定。不存在绑定时失败，不能把静态参考当作运行时样式。
2. `tests/runtime-lifecycle.test.mjs` 有两处清理目录范围保护：发现路径不属于临时夹具时，在 `finally` 中抛错以阻止删除。保持该控制流，对两条 `throw` 使用带理由的 `no-unsafe-finally` 行内豁免。只有这个文件允许行内配置，失效豁免仍报错；规则没有对整份文件关闭。JSON 报告和控制台明确列出实际使用的两条豁免。
3. Stylelint 18.1.0 的 CSSTree 值匹配器在 `src/model-controls.css` 中最高思考档位亮点的九层 `radial-gradient` 背景（`.effort-fill::after`）达到 15,000 次迭代限制，输出 `[csstree-match] BREAK after 15000 iterations`。已用逐声明检查定位；没有关闭规则、隐藏输出或改动该视觉。这一条复杂背景值的匹配未完整覆盖，Stylelint 返回零规则诊断不能消除该限制，也不能代替浏览器视觉验收。

本轮确实由 Stylelint 找到并修复一处 CSS 问题：`.question-detail` 的 `font: 13px/1.75 inherit` 不是有效的字号/行高/字体简写，改为 `font-size: 13px; line-height: 1.75; font-family: inherit`。其余旧 CSS 没有整文件格式化。

## 依赖与 Windows 换行

新增工具均为精确版本的开发依赖：ESLint 10.15.0、`@eslint/js` 10.0.1、`eslint-plugin-react-hooks` 7.1.1、globals 17.14.0、Prettier 3.10.1、Stylelint 18.1.0。生产依赖清单与初始基线保持一致。

工具的已安装 `engines.node` 中，Stylelint 要求 Node `^22.22.2 || ^24.15.0 || >=26`。打包工作流固定的 Node 24.19.0 满足全部新增工具的要求；源码工作流选择 Node 24 系列，本轮实际为 24.22.3，本地验证也使用 24.22.3。版本声明兼容不等于已经执行了 Windows 验证，实际执行范围另见本轮证据。ESLint 10 自带 [JSX 引用跟踪](https://eslint.org/blog/2026/02/eslint-v10.0.0-released/)，不需要额外引入 peer 范围不包含 ESLint 10 的旧 React 插件。[Stylelint 的 `referenceFiles`](https://stylelint.io/user-guide/rules/no-unknown-custom-properties/) 用于跨文件 Token 和具名运行时参考。

首次检查时已跟踪文本均为 LF。新增 `.gitattributes` 只为格式检查支持的文本扩展名指定 `text eol=lf`，避免 Windows `core.autocrlf=true` 检出造成格式假失败；没有运行 `git add --renormalize`，没有重写历史文件，也没有改变 PowerShell 或二进制文件规则。

## 本轮验证与未收口债务

源码层的门禁回归 8/8：新文件与修改范围、缺失快照失败、原提交不存在的 squash 情形、真实 JSX/Hook 错误、真实 Stylelint 错误、格式检查只读、失效运行时 Token 参考、CLI 非零退出及 Git 换行行为分别有断言。部分场景在同一测试内组合执行。

首次完整扫描覆盖 284 份 JavaScript、4 份 CSS（含静态参考）及 513 份可格式文本，结果为 **228 条 ESLint 诊断、405 份格式差异，退出码 1**，另外明确保留上述两处安全清理豁免。这里的 228 条是规则诊断，不是 228 个已经复现的产品故障；需要结合现有隐私、清理与运行时语义逐项审查。扫描时本说明尚未加入，后续文件数量以实际报告为准。

后续在 `9130781` 上复扫为 **226 条 ESLint 诊断、405 份格式差异，退出码仍为 1**。工具时间线脚本收编后，为原有八处空 `catch` 逐条补上处理理由，保留原控制流；`3735910` 上再扫为 **218 条 ESLint 诊断、405 份格式差异，退出码仍为 1**。原始、阶段与当前清单均保留在 `docs/evidence/phase-0b/`。四条 `rules-of-hooks` 实际都来自普通事件处理器 `useTemplate` 的命名误判：该函数没有调用 Hook，后续可统一更名，不能把这四条写成已复现的渲染故障。

`runtime-cleanup.test.mjs` 的重复 `client` 是真实夹具缺陷，使旧用例未表达其声称的非零退出。已在这份测试中改用初始 `exitCode: null`、`close()` 时转为非零并发出 `exit` 的 `zhixingProcess` 事件句柄；新增断言核对进入关闭前仍未退出、非零状态、退出事件、关闭一次及目录清理。该文件源码回归 **5/5**，范围内质量检查通过；临时副本恢复旧重复键与无退出事件行为后，新断言以 `null !== 3221226505` 明确失败。只修改测试，没有修改运行时产品代码；这是合成进程句柄的契约验证，不是 Windows 真实进程退出验收。

范围内门禁通过只说明已收编及新增/修改内容满足当前规则。旧代码的全量类型检查、全部静态债务清理、Windows 实包、真实云端、安装升级和签名均不在这个结论内。

## 维护入口的默认行为

`npm run maintenance:inventory` 只输出当前仓库固定目标目录的元数据清单，不读取文件内容、不删除文件，也不直接写报告文件。清单中的元数据不等于已完成哈希备份或允许删除。

`maintenance:preview` 和 `maintenance:updater-cache` 两个常用 npm 入口现在默认带 `--dry-run`。旧脚本的实际删除实现没有在本轮重写；这只保证常用入口默认只读，**不代表可恢复清理或用户 Windows 上 87 GB 历史数据已经处理完毕**。
