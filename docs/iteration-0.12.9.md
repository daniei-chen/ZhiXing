# 知行 0.12.9 · 安装包体积

打包阶段在复制锁定的生产依赖之后增加一次裁剪，移除运行时不会加载的内容：TypeScript 源码（`.ts`、`.tsx`、`.mts`、`.cts`）、source map、`@types` 类型声明包、WebAssembly 版 OfficeKit 兜底，以及 `node-pty` 为 macOS、Linux 与 win32-arm64 提供的预编译二进制。

Windows x64 保留全部运行时文件：OfficeKit 的 win32-x64 转换器、sharp 的 libvips、ripgrep、conpty、随包 Node、字体与许可证。`libreoffice-kit` 在 win32 上按平台解析 win32-x64 侧车，WebAssembly 版只在其它平台使用，所以删除它不影响本机转换。

应用目录从 1,454 MB 降到 818 MB，安装器从 562.8 MB 降到 322.8 MB，裁剪时移除 67,865 个文件、共 636 MB。裁剪只作用于打包树，源码仓库、开发依赖和构建脚本不变。

验证在裁剪后的真实目录包上完成：包内回归 322/323，桌面专项 5/5，覆盖 Office 转换、原生写入审批、多文件补丁部分完成、重启恢复、Markdown 导出与保存快照失效；源码回归 355 项。裁剪不改变审批、脱敏、沙箱、图片或存储链路，也不移除任何 Windows 运行时文件。

限制：安装目录不再包含依赖的 TypeScript 源码与 source map，无法在安装目录里直接阅读依赖原始 `.ts`，也无法用 source map 还原压缩前的堆栈行号。已编译的内核、插件与前端产物完整保留。 [Windows 验收](windows-acceptance-0.12.9.md) · [能力地图](harness-capability-map.md)
