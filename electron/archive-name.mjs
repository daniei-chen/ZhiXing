// 归档文件名：带会话名与日期，避免第二次归档悄悄覆盖上一次。
const pad = value => String(value).padStart(2, '0');

export function archiveFileName({ title, date = Date.now(), index } = {}) {
  const day = new Date(date);
  const stamp = Number.isFinite(day.getTime()) ? `${day.getFullYear()}${pad(day.getMonth() + 1)}${pad(day.getDate())}` : '未标日期';
  const clean = String(title || '子会话')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const suffix = index === undefined || index === null ? '' : `-${index}`;
  return `子会话-${clean || '子会话'}-${stamp}${suffix}.md`;
}

export function numberedName(name, attempt) {
  if (attempt <= 1) return name;
  const extension = name.toLowerCase().endsWith('.md') ? name.slice(-3) : '';
  const stem = extension ? name.slice(0, -3) : name;
  return `${stem}-${attempt}${extension}`;
}
