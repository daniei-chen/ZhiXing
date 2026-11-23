export const PERMISSION_MODES = [
  { id: 'ask', label: '请求批准', short: '请求批准', description: '写入、外部文件、终端和联网工具均需批准', sandbox: 'workspace-write' },
  { id: 'auto', label: '帮我批准', short: '帮我批准', description: '自动读取与新建；覆盖、外部文件、命令和联网询问', sandbox: 'workspace-write' },
  { id: 'full', label: '完全访问权限', short: '完全访问', description: '允许文件、终端和已配置的外部工具执行，不逐项询问', sandbox: 'danger-full-access' },
];
export const permissionMode = id => PERMISSION_MODES.find(item => item.id === id) || PERMISSION_MODES[0];

export const HARNESS_PERMISSION_PRESETS = Object.freeze({
  'read-only': { name:'只读（未绑定项目）', sandbox:'read-only', approval:'ask' },
  'workspace-write': { name:PERMISSION_MODES[0].label, sandbox:'workspace-write', approval:'ask' },
  'workspace-auto-new': { name:PERMISSION_MODES[1].label, sandbox:'workspace-write', approval:'ask' },
  'workspace-full-with-confirmations': { name:PERMISSION_MODES[2].label, sandbox:'danger-full-access', approval:'ask' },
});

export const harnessPermissionPreset = (permission, hasWorkspace) => !hasWorkspace ? 'read-only'
  : permission === 'full' ? 'workspace-full-with-confirmations' : permission === 'auto' ? 'workspace-auto-new' : 'workspace-write';
