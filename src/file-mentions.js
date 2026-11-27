// 输入区 `@` 文件引用：记号语法与候选排序口径移植自上游
// `@deepseek-ai/dsh-file-reference`（0.2.2-rc.5）的 `grammar.ts`，以及
// `dsh-file-reference-local` 的 `search.ts` 排序评分。上游把候选发现放在主机侧，
// 知行由主机一次列出工作区索引（`electron/file-references.mjs`），
// 渲染层在这里按同一个查询口径筛选、排序与截断；插入的始终是相对路径文本，
// 不加附件、不读文件内容，模型用已有的文件工具自己去读。
export const MENTION_LIMIT = 20;

const SUBSEQUENCE = Symbol('subsequence');

// 只有行首、空白或标点后的 `@` 才开启候选：邮箱里的 @ 不是记号。
function tokenAt(prefix) {
  const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(prefix);
  if (quoted?.[1] !== undefined && quoted[2] !== undefined) {
    return { prefix: quoted[1], query: quoted[2], quoted: true };
  }
  const plain = /(?:^|\s)(@([^\s]*))$/u.exec(prefix);
  if (plain?.[1] === undefined || plain[2] === undefined) return null;
  return { prefix: plain[1], query: plain[2], quoted: false };
}

export function activeMention(text, caret = String(text ?? '').length) {
  const source = String(text ?? '');
  if (!Number.isInteger(caret) || caret < 0 || caret > source.length) return null;
  const token = tokenAt(source.slice(0, caret));
  if (!token) return null;
  return { ...token, start: caret - token.prefix.length, end: caret };
}

// 控制符与双引号在记号语法里无法安全表达（上游同样拒绝）。
function unrepresentable(value) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x22) return true;
  }
  return false;
}

export function formatMention(candidate, preserveQuote = false) {
  const path =
    candidate?.kind === 'directory' ? `${candidate.path}/` : String(candidate?.path ?? '');
  if (!path || unrepresentable(path)) return null;
  const quoted = preserveQuote || /\s/u.test(path);
  if (!quoted) return `@${path}`;
  if (candidate.kind === 'directory') return `@"${path}`;
  return `@"${path}"`;
}

// 用选中的候选替换当前记号；行尾补一个空格方便继续写，其它位置的 `@` 原文不动。
export function applyMention(text, token, candidate) {
  const source = String(text ?? '');
  const mention = token ? formatMention(candidate, token.quoted) : null;
  if (!mention) return { text: source, caret: token ? token.end : source.length };
  const suffix = source.slice(token.end);
  const spacing = suffix === '' || !/^[\s，。；：！？、,.!?;:)\]）】]/u.test(suffix) ? ' ' : '';
  return {
    text: `${source.slice(0, token.start)}${mention}${spacing}${suffix}`,
    caret: token.start + mention.length + spacing.length,
  };
}

// 上游只在查询本身涉及点文件时才列出点路径，避免 `.github`、`.vscode` 淹没候选。
function visibleForGlobalQuery(path, query) {
  if (query.startsWith('.') || query.includes('/.')) return true;
  return !path.split('/').some((segment) => segment.startsWith('.'));
}

// 带斜杠的查询列该目录的直接子项（上游 search.ts 的 listDirectory 口径）。
function candidatesFor(entries, query) {
  if (!query.includes('/')) {
    return {
      candidates: entries.filter((entry) => visibleForGlobalQuery(entry.path, query)),
      fragment: query,
    };
  }
  const directory = query.slice(0, query.lastIndexOf('/') + 1);
  const fragment = query.slice(query.lastIndexOf('/') + 1);
  const candidates = entries.filter((entry) => {
    if (!entry.path.startsWith(directory) || entry.path.length === directory.length) return false;
    const name = entry.path.slice(directory.length);
    if (name.includes('/')) return false;
    return fragment.startsWith('.') || !name.startsWith('.');
  });
  return { candidates, fragment };
}

function subsequenceScore(target, needle) {
  let cursor = 0;
  let gap = 0;
  for (const character of needle) {
    const found = target.indexOf(character, cursor);
    if (found < 0) return undefined;
    gap += found - cursor;
    cursor = found + 1;
  }
  return Math.max(0, 100 - gap);
}

function scoreCandidate(candidate, fragment) {
  if (fragment === '') return 0;
  const path = candidate.path.toLowerCase();
  const name = path.slice(path.lastIndexOf('/') + 1);
  const needle = fragment.toLowerCase();
  const directoryBonus = candidate.kind === 'directory' ? 25 : 0;
  if (name === needle) return 1000 + directoryBonus;
  if (name.startsWith(needle)) return 900 + directoryBonus;
  if (name.includes(needle)) return 700 + directoryBonus;
  if (path.includes(needle)) return 500 + directoryBonus;
  const subsequence = subsequenceScore(path, needle);
  return subsequence === undefined ? SUBSEQUENCE : 300 + subsequence + directoryBonus;
}

function rank(candidates, fragment) {
  const ranked = [];
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, fragment);
    if (score !== SUBSEQUENCE) ranked.push({ candidate, score });
  }
  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      (left.candidate.kind === 'directory' ? 0 : 1) -
        (right.candidate.kind === 'directory' ? 0 : 1) ||
      (fragment === '' ? 0 : left.candidate.path.length - right.candidate.path.length) ||
      (left.candidate.path < right.candidate.path
        ? -1
        : left.candidate.path > right.candidate.path
          ? 1
          : 0),
  );
  return ranked.map((entry) => entry.candidate);
}

// 一次列出的工作区索引 + 当前查询 → 候选、是否截断、空态原因。
// `empty`：workspace（没有项目工作区）／no-files（工作区是空的）／no-match（没有匹配）。
export function mentionState(source, query, limit = MENTION_LIMIT) {
  const entries = Array.isArray(source?.entries) ? source.entries : [];
  if (source?.workspace === false) return { items: [], truncated: false, empty: 'workspace' };
  if (!entries.length) return { items: [], truncated: false, empty: 'no-files' };
  const { candidates, fragment } = candidatesFor(
    entries,
    String(query ?? '').replaceAll('\\', '/'),
  );
  const ranked = rank(candidates, fragment);
  if (!ranked.length) return { items: [], truncated: false, empty: 'no-match' };
  return {
    items: ranked.slice(0, limit),
    truncated: ranked.length > limit || source?.truncated === true,
    empty: '',
  };
}

export function mentionNote(state) {
  if (state?.empty === 'no-match') return '没有匹配的文件。';
  if (state?.empty === 'no-files') return '这个工作区里还没有可引用的文件。';
  if (state?.empty === 'workspace')
    return '当前聊天还没有项目工作区。请在项目设置里选择目录后，再引用其中的文件。';
  if (!state?.truncated) return '';
  return state.items.length >= MENTION_LIMIT
    ? `候选已截断，仅显示前 ${state.items.length} 项。`
    : '工作区里的文件太多，候选已截断。';
}
