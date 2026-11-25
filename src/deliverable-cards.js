// 交付物卡片的展示规则。桌面版把 present 声明渲染成轮次末尾的卡片：
// 显示文件名与「说明或文件类型」，多个交付用双列网格，超过四个默认收起。
// 这里只做展示层判定，是否可打开仍由主进程的交付记录决定。
export const DELIVERABLE_VISIBLE_LIMIT = 4;

const TYPES = [
  [/\.(docx?|rtf|odt)$/i, 'Word 文档'],
  [/\.(xlsx?|xlsm|csv|ods)$/i, '表格'],
  [/\.(pptx?|odp)$/i, '演示文稿'],
  [/\.pdf$/i, 'PDF 文档'],
  [/\.(png|jpe?g|gif|webp|bmp|tiff?|svg)$/i, '图片'],
  [/\.(md|markdown|txt|log)$/i, '纯文本'],
  [/\.(zip|7z|rar|tar|gz|tgz)$/i, '压缩包'],
  [/\.(json|ya?ml|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|ps1|sh)$/i, '代码或结构化文本'],
];

export function deliverableName(file) {
  const path = typeof file?.path === 'string' ? file.path.trim() : '';
  if (!path) return '成果文件';
  return path.split(/[\\/]/).filter(Boolean).at(-1) || '成果文件';
}

export function deliverableType(file) {
  const name = deliverableName(file);
  for (const [pattern, label] of TYPES) if (pattern.test(name)) return label;
  return '文件';
}

// 卡片副标题：优先用交付时写下的说明，没有说明才退回文件类型。
export function deliverableCaption(file) {
  const description = typeof file?.description === 'string' ? file.description.trim() : '';
  return description || deliverableType(file);
}

export function splitDeliverables(files, limit = DELIVERABLE_VISIBLE_LIMIT) {
  const list = Array.isArray(files) ? files : [];
  const shown = Math.max(0, Math.trunc(limit));
  return {
    total: list.length,
    visible: list.slice(0, shown),
    hidden: list.slice(shown),
    collapsible: list.length > shown,
  };
}

export function deliverableMoreLabel(total, limit = DELIVERABLE_VISIBLE_LIMIT, expanded = false) {
  if (!Number.isFinite(total) || total <= limit) return '';
  return expanded ? '收起' : `展开全部 ${total} 个交付`;
}
