// 交付卡片的文件动作（对标 dsh-client-ui-deliverables 的 PresentedAction：'open' | 'reveal'）。
// 桌面版把这两个动作放进卡片上的动作菜单，并只允许打开「本轮声明过」的文件；
// 开关状态有 opening / revealing / error / revealError / nativeUnavailable 五种。
export const FILE_ACTIONS = [
  { id: 'preview', label: '预览' },
  { id: 'open', label: '在默认应用中打开' },
  { id: 'reveal', label: '在文件管理器中显示' },
];

export function actionLabel(action) {
  return FILE_ACTIONS.find(item => item.id === action)?.label || '';
}

export function actionPendingLabel(action) {
  if (action === 'open') return '正在打开…';
  if (action === 'reveal') return '正在定位…';
  return '';
}

export function actionDoneLabel(action) {
  if (action === 'open') return '已交给默认应用打开。';
  if (action === 'reveal') return '已在文件管理器中显示。';
  return '';
}

export function actionFailureLabel(action) {
  if (action === 'open') return '打不开这个文件，请检查默认应用或稍后重试。';
  if (action === 'reveal') return '找不到这个文件的位置，它可能已被移动或删除。';
  return '这个操作没有完成。';
}
