# 知行 0.14.7 外部审计说明

本版新增「打包为 ZIP」。核心在 `electron/zip-writer.mjs`，接线在 `electron/main.cjs` 的 `workspace:zip`、`electron/preload.cjs` 与 `src/Workbench.jsx` 的文件页工具栏。 [Windows 验收](windows-acceptance-0.14.7.md)

1. 校验安装器、`latest.yml`、`SHA256SUMS-release.txt` 与包内 `build-provenance.json`；用 `ZhiXing-v0.14.6-to-v0.14.7.patch` 核对差异，应当只有 `electron/zip-writer.mjs`、`electron/main.cjs`、`electron/preload.cjs`、`electron/workspace-files.mjs`、`src/Workbench.jsx`、`src/styles.css`、`tests/zip-writer.test.mjs`、`scripts/test-zip-export-ui.mjs`、`package.json` 与文档。
2. 读 `buildZip` 与 `normalizeEntryName`，重点核对：
   - 归档内路径必须相对、不许 `..`、不许盘符与开头的 `/`；**不接受**任何「调用方自己保证」的说法；
   - 文件名用 UTF-8 标志位写出；
   - 压缩后不比原文小的时候退回 store，避免无意义膨胀。
3. 读 `workspace:zip` 处理函数，重点看：私密清单是否真的复用 `isPrivateRelative`、上限是否在写盘前生效、取消时是否不写文件。
4. 重跑实包验收：`npm run test:zip -- "<repo>\release\win-unpacked\知行.exe"`。脚本会用临时 profile 启动打包 EXE，接管原生保存对话框，真实点击按钮，然后用 yauzl 读回归档核对内容与排除项。
5. 重点质疑的地方：
   - 归档里**没有**目录项，空目录会被丢弃；
   - 排除是路径名匹配，`secret.txt` 这类改名的密钥不会被排除；
   - 大文件整份读入内存，256 MB 上限是这个设计的前提；
   - 没有 ZIP64，4 GB 以上会直接报错。
6. 已知限制：只在 Windows x64 实包验证，读回用 yauzl；7-Zip、macOS 归档工具未逐一核对；安装器未签名；`historical-upgrade` 仍为 `not_run`；真实云端未覆盖。
7. 依赖未变：1,178／1,162，0 high、0 critical、32 moderate、2 条 unique 通告（本版没有引入新依赖）。
