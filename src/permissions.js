export const PERMISSION_MODES = [
  { id: 'ask', label: '请求批准', short: '请求批准', description: '写入、外部文件、终端和联网工具均需批准', sandbox: 'workspace-write' },
  { id: 'auto', label: '帮我批准', short: '帮我批准', description: '自动读取与新建；覆盖、外部文件、命令和联网询问', sandbox: 'workspace-write' },
  { id: 'full', label: '完全访问权限', short: '完全访问', description: '允许文件、终端和已配置的外部工具执行，不逐项询问', sandbox: 'danger-full-access' },
];
export const permissionMode = id => PERMISSION_MODES.find(item => item.id === id) || PERMISSION_MODES[0];
