// 反馈规则由主进程与界面共用一份：真实模块在 electron/message-feedback.mjs（随包发布），
// 这里只做转发，避免打包后主进程 import 不到 src 目录。
export * from '../electron/message-feedback.mjs';
