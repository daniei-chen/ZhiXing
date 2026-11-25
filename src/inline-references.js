// 收尾正文里的行内文件引用。桌面版（dsh-client-ui-deliverables）只把「本轮产出或已交付的路径」
// 变成链接：行内代码 token 可按精确目标路径、该目标记录的精确参数，或唯一 basename 解析；
// 所有匹配事实必须指向同一文件，有歧义的 basename 保持不可点击；不使用后缀或当前目录猜测。
// 这里实现同样的判定，供渲染层给行内代码加链接样式，点击仍走主进程的交付记录校验。
const SEPARATORS = /[\\/]/;

function normalize(value) {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').toLocaleLowerCase('zh-CN');
}

export function referencePath(file) {
  return typeof file?.path === 'string' ? file.path.trim() : '';
}

export function baseName(file) {
  const path = referencePath(file);
  if (!path) return '';
  return path.split(/[\\/]/).filter(Boolean).at(-1) || '';
}

// token 是否长得像路径（含分隔符或盘符），用于区分「精确路径」与「basename」两种解析。
export function looksLikePath(token) {
  const value = String(token ?? '').trim();
  return SEPARATORS.test(value) || /^[a-zA-Z]:/.test(value);
}

export function resolveReference(token, files) {
  const value = String(token ?? '').trim();
  const list = (Array.isArray(files) ? files : []).filter(file => referencePath(file));
  if (!value || !list.length) return null;
  const normalized = normalize(value);
  if (looksLikePath(value)) {
    const exact = list.filter(file => normalize(referencePath(file)) === normalized);
    return exact.length === 1 ? exact[0] : null;
  }
  if (SEPARATORS.test(value)) return null;
  const byBase = list.filter(file => normalize(baseName(file)) === normalized);
  return byBase.length === 1 ? byBase[0] : null;
}

// 返回 {files, refs}：refs 是「token → 文件」的可点击判定，供渲染层逐段使用。
export function referenceResolver(files) {
  const list = (Array.isArray(files) ? files : []).filter(file => referencePath(file));
  return token => resolveReference(token, list);
}

export function referenceTitle(file) {
  return referencePath(file);
}
