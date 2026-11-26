import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';

// Server rendering verifies real Sidebar grouping; browser layout is a separate layer.
const compiled = await build({
  stdin: {
    contents: `
      import { createElement } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { Sidebar } from './src/Sidebar.jsx';
      export const render = props => renderToStaticMarkup(createElement(Sidebar, props));
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'jsx',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react-dom/server'], logLevel: 'silent',
});
const sandbox = { module: { exports: {} }, require: createRequire(import.meta.url), window: {} };
vm.runInNewContext(compiled.outputFiles[0].text, sandbox);

test('项目、置顶、独立及悬空项目聊天分别出现一次，不重复高亮或隐藏旧会话', () => {
  const workspace = { id: 'office-home', type: 'office', name: '个人办公' };
  const projects = [{ id: 'project', name: '项目', expanded: true }];
  const chats = [
    { id: 'in-project', projectId: 'project', title: '项目内聊天' },
    { id: 'pinned-project', projectId: 'project', title: '项目置顶聊天', pinned: true },
    { id: 'independent', title: '独立聊天' },
    { id: 'orphan-project', projectId: 'missing-project', title: '项目已缺失的旧聊天' },
  ];
  for (const activeChat of chats.map(chat => chat.id)) {
    const html = sandbox.module.exports.render({
      state: { workspaces: [workspace] }, workspace, projects, chats,
      activeChat, section: 'home', unread: false,
    });
    for (const chat of chats) {
      assert.equal(html.split(`data-chat-id="${chat.id}"`).length - 1, 1, chat.id);
    }
    assert.equal((html.match(/class="chat-row selected"/g) || []).length, 1);
    assert(html.indexOf('data-chat-id="orphan-project"') > html.indexOf('最近聊天</span>'));
    assert.equal(chats.find(chat => chat.id === 'orphan-project').projectId, 'missing-project');
  }
});
