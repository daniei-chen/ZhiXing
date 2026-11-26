# 0.41.0 外部审计入口

## 先确认检查对象

请以 [v0.41.0 发行页](https://github.com/daniei-chen/ZhiXing/releases/tag/v0.41.0) 的实际 tag、`build-provenance.json`、`packed-source-manifest.json` 和 `acceptance-summary-0.41.0.json` 识别构建。源码说明中的计划与历史数字不能代替本轮实际日志。若发行页尚不存在，当前仍是候选源码。

先核对 `SHA256SUMS-release.txt` 列出的其余 17 件资产。该清单不能包含自己的自引用哈希；流水线外部 manifest 另外记录全部 18 件资产，用于上传后的 API digest 或独立下载复算。安装器为未签名 Windows x64 预发行包，不能据 `exe` 本体哈希推断所有散装应用代码均相同，必须同时核对包内源码指纹。

## 建议检查顺序

1. 阅读 [本轮实现说明](iteration-0.41.0.md) 和机器可读验收摘要，分开源码测试、隔离 renderer、目录包内核、打包 UI、NSIS 装配、用户安装和真实云端。
2. 审查 `src/App.jsx`、`keyed-store.js`、`debounced-writer.js`、`Composer.jsx`、`StreamingAnswer.jsx` 和 `Workbench.jsx`：逐字输入不得更新整个工作空间，流式事件不得反复保存整个聊天数组，主聊天与侧边聊天不得串草稿或串输出。
3. 审查 `electron/workspace-persistence.mjs`、`main.cjs`、`preload.cjs`：两类写入必须共用队列；草稿不得挤掉尚未完成的结构保存；旧 epoch 不得恢复删除内容；损坏文件必须保留并报错，不能静默回退。
4. 验证发送期间新编辑、用户清空后失败、删除项目期间迟到附件、持久化关闭、写入失败重试、正常退出与更新前保存。原审批、凭据隔离、视觉附件引用与自动化授权范围必须保持。
5. 阅读 `tests/workspace-persistence.test.mjs`、`renderer-slices.test.mjs`、`conversation-drafts-ui.test.mjs`、`error-boundary-ui.test.mjs` 和 `scripts/test-phase1-ui.mjs`。源码 mock 调用次数不等于 Windows 写盘次数；后者应有实际文件采样及真实内核的慢 SSE 旅程。
6. 审查错误边界：工作面板异常不能卸载聊天；固定提示不得泄露错误对象，重试和重新载入必须真实执行。边界本身不应改动持久记录。
7. 核对发布工作流：构建使用精确源码和锁文件；失败门禁不能发布；公开前先建 draft、上传固定 18 资产并逐个校验。高写权限仅分配最终发布 job，不能由外部 PR 触发。

## 明确边界

没有此次用户安装生命周期、代码签名、真实云端办公评测、跨账户 DPAPI 解密、强制断电零丢失或全量 Harness 桌面机制一致性的结论。常驻 Host、SQLite、大容量资料库、完整 Office 编辑能力仍待后续里程碑。`test:packed` 的测试文件与部分夹具来自源码，加载分类记录在测试输出中，不能描述为所有断言都只针对安装包。

历史审计中“模式前缀必然使技能失效”和“未 patch 默认模型即证明子 Agent 路由失效”已被实际内核测试纠正，详见 [Phase 0A 核实](phase-0a-audit.md)。不要因原审计措辞强烈而重新引入未验证的修补。
