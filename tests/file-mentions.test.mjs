import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MENTION_LIMIT,
  activeMention,
  applyMention,
  formatMention,
  mentionNote,
  mentionState,
} from '../src/file-mentions.js';

const files = [
  { path: 'src/App.jsx', kind: 'file' },
  { path: 'src/app.css', kind: 'file' },
  { path: 'src/components/AppShell.jsx', kind: 'file' },
  { path: 'docs/说明.md', kind: 'file' },
  { path: 'docs/app 指南.md', kind: 'file' },
  { path: 'src', kind: 'directory' },
  { path: 'src/components', kind: 'directory' },
  { path: 'scripts', kind: 'directory' },
  { path: '.github/workflow.yml', kind: 'file' },
  { path: 'notes/.draft.md', kind: 'file' },
];

const paths = (state) => state.items.map((item) => item.path);

test('记号只从行首、空白或标点后的 @ 开始', () => {
  assert.deepEqual(
    { start: activeMention('请看 @src', 7)?.start, query: activeMention('请看 @src', 7)?.query },
    { start: 3, query: 'src' },
  );
  assert.equal(activeMention('@src', 4)?.query, 'src', '行首的 @ 也是记号');
  assert.equal(activeMention('一行\n@docs', 8)?.query, 'docs', '换行后同样是边界');
  assert.equal(activeMention('邮箱 foo@bar.com', 13), null, '邮箱里的 @ 不触发候选');
  assert.equal(activeMention('@src 之后的光标', 10), null, '记号已用空白结束');
  assert.equal(activeMention('请看 @', 3), null, '光标停在 @ 之前就没有记号');
});

test('空查询同样是一个记号，光标位置决定查询范围', () => {
  const token = activeMention('@', 1);
  assert.equal(token?.query, '');
  assert.equal(token?.start, 0);
  assert.equal(activeMention('@src/App', 8)?.query, 'src/App');
  assert.equal(activeMention('@src/App', 4)?.query, 'src', '光标在中间时只取到光标之前');
});

test('带空格的路径走上游的引号语法', () => {
  const token = activeMention('@docs/app 指南', 9);
  assert.equal(token?.quoted, false, '未加引号的记号在空格处结束');
  assert.equal(token?.query, 'docs/app');
  const quoted = activeMention('看 @"docs/app 指南', 15);
  assert.equal(quoted?.quoted, true);
  assert.equal(quoted?.query, 'docs/app 指南');
});

test('插入的是相对路径文本，并留出一个空格继续写', () => {
  const token = activeMention('请核对 @src/App 的布局', 12);
  const applied = applyMention('请核对 @src/App 的布局', token, {
    path: 'src/App.jsx',
    kind: 'file',
  });
  assert.equal(applied.text, '请核对 @src/App.jsx 的布局');
  assert.equal(applied.caret, '请核对 @src/App.jsx'.length);
});

test('插入在行尾补一个空格，已有空白不重复补', () => {
  assert.equal(
    applyMention('@src', activeMention('@src', 4), { path: 'src/App.jsx', kind: 'file' }).text,
    '@src/App.jsx ',
  );
  assert.equal(
    applyMention('@src 后面', activeMention('@src', 4), { path: 'src/App.jsx', kind: 'file' }).text,
    '@src/App.jsx 后面',
  );
});

test('插入只替换当前记号，其它 @ 文本与上下文原样保留', () => {
  const text = '第一行 @docs/说明.md\n第二行 @src';
  const token = activeMention(text, text.length);
  assert.equal(
    applyMention(text, token, { path: 'src/app.css', kind: 'file' }).text,
    '第一行 @docs/说明.md\n第二行 @src/app.css ',
  );
});

test('没有记号时插入不改动草稿，重复插入同一记号不叠加', () => {
  assert.deepEqual(applyMention('纯文本', null, { path: 'src/App.jsx', kind: 'file' }), {
    text: '纯文本',
    caret: 3,
  });
  const once = applyMention('@ap', activeMention('@ap', 3), { path: 'src/App.jsx', kind: 'file' });
  assert.equal(once.text, '@src/App.jsx ');
  assert.equal(
    applyMention(once.text, activeMention(once.text, once.caret), {
      path: 'src/App.jsx',
      kind: 'file',
    }).text,
    '@src/App.jsx ',
    '同一位置再选一次不会变成两个路径',
  );
});

test('光标停在已有引用中间时，替换整段记号而不是只替换到光标', () => {
  const text = '复核 @src/App.jsx 的布局';
  const token = activeMention(text, 9);
  assert.equal(token?.query, 'src/A', '查询仍然只取光标之前的部分');
  const applied = applyMention(text, token, { path: 'src/App.jsx', kind: 'file' }, ['src/App.jsx']);
  assert.equal(applied.text, '复核 @src/App.jsx 的布局', '不会留下  p.jsx 这种半截后缀');
  assert.equal(applied.caret, 3 + '@src/App.jsx'.length);
});

test('引号形式的引用从中间补全时连结束引号一起替换', () => {
  const text = '看 @"docs/带 空格 的名字.md" 之后';
  const token = activeMention(text, 12);
  assert.equal(token?.quoted, true);
  const applied = applyMention(text, token, { path: 'docs/带 空格 的名字.md', kind: 'file' }, [
    'docs/带 空格 的名字.md',
  ]);
  assert.equal(applied.text, '看 @"docs/带 空格 的名字.md" 之后');
});

test('紧随其后的中文正文不会被当成路径的一部分删掉', () => {
  const text = '帮我看一下 @文件说明';
  const token = activeMention(text, 7);
  assert.equal(token?.query, '', '光标就在 @ 之后，查询是空的');
  const applied = applyMention(text, token, { path: 'src/App.jsx', kind: 'file' }, ['src/App.jsx']);
  assert.equal(applied.text, '帮我看一下 @src/App.jsx 文件说明');
});

test('没有对上真实路径时不扩展，引号里的其它引号也不会被吞掉', () => {
  const text = '看 @"src/a 然后 "b"';
  const token = activeMention(text, 9);
  assert.equal(token?.quoted, true);
  const applied = applyMention(text, token, { path: 'src/App.jsx', kind: 'file' }, ['src/App.jsx']);
  assert.equal(applied.text, '看 @"src/App.jsx" 然后 "b"');
});

test('后缀能对上工作区里的真实路径时才扩展替换范围', () => {
  const text = '@src/App.jsx';
  const applied = applyMention(
    text,
    activeMention(text, 9),
    { path: 'src/App.jsx', kind: 'file' },
    ['src/App.jsx'],
  );
  assert.equal(applied.text, '@src/App.jsx ');
  const withoutIndex = applyMention(text, activeMention(text, 9), {
    path: 'src/App.jsx',
    kind: 'file',
  });
  assert.equal(withoutIndex.text, '@src/App.jsx jsx', '没有索引时不猜，保持只替换到光标');
});

test('含空格的路径按上游语法加引号，目录保留尾斜杠', () => {
  assert.equal(formatMention({ path: 'src/App.jsx', kind: 'file' }, false), '@src/App.jsx');
  assert.equal(
    formatMention({ path: 'docs/app 指南.md', kind: 'file' }, false),
    '@"docs/app 指南.md"',
  );
  assert.equal(formatMention({ path: 'docs', kind: 'directory' }, false), '@docs/');
  assert.equal(
    formatMention({ path: 'docs/app 指南', kind: 'directory' }, false),
    '@"docs/app 指南/',
  );
  assert.equal(
    formatMention({ path: 'a\u0007b', kind: 'file' }, false),
    null,
    '控制符无法用记号表达',
  );
});

test('排序照上游评分：同名、前缀、包含、路径包含、子序列依次递减', () => {
  const entries = [
    { path: 'vendor/App.jsx', kind: 'file' },
    { path: 'src/AppShell.jsx', kind: 'file' },
    { path: 'src/my-app.ts', kind: 'file' },
    { path: 'lib/app-tools/x.js', kind: 'file' },
    { path: 'src/App.jsx', kind: 'file' },
  ];
  assert.deepEqual(paths(mentionState({ workspace: true, entries }, 'app')), [
    'src/App.jsx',
    'vendor/App.jsx',
    'src/AppShell.jsx',
    'src/my-app.ts',
    'lib/app-tools/x.js',
  ]);
  const exact = mentionState({ workspace: true, entries }, 'app.jsx');
  assert.equal(exact.items[0].path, 'src/App.jsx');
});

test('目录与非目录同分时目录在前，再按路径长度与字典序', () => {
  const entries = [
    { path: 'app.js', kind: 'file' },
    { path: 'app', kind: 'directory' },
    { path: 'app-long.js', kind: 'file' },
    { path: 'app-ab.js', kind: 'file' },
  ];
  assert.deepEqual(paths(mentionState({ workspace: true, entries }, 'app')), [
    'app',
    'app.js',
    'app-ab.js',
    'app-long.js',
  ]);
});

test('目录内的查询只列直接子项', () => {
  const state = mentionState({ workspace: true, entries: files }, 'src/');
  assert.deepEqual(paths(state).sort(), ['src/App.jsx', 'src/app.css', 'src/components']);
  assert.equal(
    state.items.some((item) => item.path === 'src/components/AppShell.jsx'),
    false,
  );
  const fragment = mentionState({ workspace: true, entries: files }, 'src/App');
  assert.deepEqual(paths(fragment), ['src/App.jsx', 'src/app.css'], '目录内按前缀匹配直接子项');
});

test('点文件默认不出现在候选里，显式打点才列出来', () => {
  assert.equal(mentionState({ workspace: true, entries: files }, 'workflow').items.length, 0);
  assert.deepEqual(paths(mentionState({ workspace: true, entries: files }, '.workflow')), [
    '.github/workflow.yml',
  ]);
  assert.deepEqual(paths(mentionState({ workspace: true, entries: files }, 'notes/.')), [
    'notes/.draft.md',
  ]);
});

test('候选有上限，超出时标为已截断并给出提示', () => {
  const many = Array.from({ length: 40 }, (_, index) => ({
    path: `src/file-${String(index).padStart(2, '0')}.js`,
    kind: 'file',
  }));
  const state = mentionState({ workspace: true, entries: many }, 'file');
  assert.equal(MENTION_LIMIT, 20);
  assert.equal(state.items.length, 20);
  assert.equal(state.truncated, true);
  assert.match(mentionNote(state), /已截断/);
  assert.match(mentionNote(state), /20/);
  const partial = mentionState({ workspace: true, entries: many.slice(0, 5) }, 'file');
  assert.equal(partial.truncated, false);
  assert.equal(mentionNote(partial), '');
});

test('工作区索引本身被截断时同样提示，不混淆为无匹配', () => {
  const state = mentionState(
    { workspace: true, entries: [{ path: 'src/App.jsx', kind: 'file' }], truncated: true },
    'App',
  );
  assert.equal(state.items.length, 1);
  assert.equal(state.truncated, true);
  assert.match(mentionNote(state), /已截断/);
});

test('三种空态各有自己的说明', () => {
  assert.equal(mentionState({ workspace: false, entries: [] }, '').empty, 'workspace');
  assert.match(mentionNote(mentionState({ workspace: false, entries: [] }, '')), /项目工作区/);
  assert.equal(mentionState({ workspace: true, entries: [] }, '').empty, 'no-files');
  assert.match(mentionNote(mentionState({ workspace: true, entries: [] }, '')), /还没有/);
  assert.equal(mentionState({ workspace: true, entries: files }, '找不到').empty, 'no-match');
  assert.match(
    mentionNote(mentionState({ workspace: true, entries: files }, '找不到')),
    /没有匹配/,
  );
  assert.equal(mentionNote(mentionState({ workspace: true, entries: files }, 'src/App')), '');
});
