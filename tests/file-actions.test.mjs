import assert from 'node:assert/strict';
import test from 'node:test';
import {FILE_ACTIONS, actionDoneLabel, actionFailureLabel, actionLabel, actionPendingLabel} from '../src/file-actions.js';

test('动作清单与桌面版一致：预览、默认应用打开、文件管理器定位', () => {
  assert.deepEqual(FILE_ACTIONS.map(item => item.id), ['preview', 'open', 'reveal']);
  assert.deepEqual(FILE_ACTIONS.map(item => item.label), ['预览', '在默认应用中打开', '在文件管理器中显示']);
  assert.equal(actionLabel('open'), '在默认应用中打开');
  assert.equal(actionLabel('missing'), '');
});

test('进行中的提示按动作区分', () => {
  assert.equal(actionPendingLabel('open'), '正在打开…');
  assert.equal(actionPendingLabel('reveal'), '正在定位…');
  assert.equal(actionPendingLabel('preview'), '');
});

test('成功只在这两个动作上有句子', () => {
  assert.equal(actionDoneLabel('open'), '已交给默认应用打开。');
  assert.equal(actionDoneLabel('reveal'), '已在文件管理器中显示。');
  assert.equal(actionDoneLabel('preview'), '');
});

test('失败文案说明下一步，且不冒充成功', () => {
  assert.equal(actionFailureLabel('open').includes('默认应用'), true);
  assert.equal(actionFailureLabel('reveal').includes('移动或删除'), true);
  assert.notEqual(actionDoneLabel('open'), actionFailureLabel('open'));
});
