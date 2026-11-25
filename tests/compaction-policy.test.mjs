import test from 'node:test';
import assert from 'node:assert/strict';
import { compactionPolicy, compactionSummary, DESKTOP_HEADROOM_TOKENS } from '../electron/compaction-policy.mjs';

test('128k 窗口用桌面版默认 headroom，不收缩', () => {
  const policy = compactionPolicy({ contextWindow: 128000, maxTokens: 8192 });
  assert.equal(policy.headroomTokens, DESKTOP_HEADROOM_TOKENS);
  assert.equal(policy.clamped, false);
  assert.deepEqual(policy.config, { headroomTokens: 65536, maxTokens: 65536, thresholdRatio: 0.8, retainRatio: 0.16 });
  // 预算：128000 - 8192 - 65536 = 54272；阈值取 min(102400, 54272)
  assert.equal(policy.thresholdTokens, 54272);
  assert.equal(policy.retainTokens, Math.floor(119808 * 0.16));
});

test('200k 窗口阈值仍受 headroom 限制', () => {
  const policy = compactionPolicy({ contextWindow: 200000, maxTokens: 8192 });
  assert.equal(policy.clamped, false);
  assert.equal(policy.thresholdTokens, Math.min(160000, 200000 - 8192 - 65536));
});

test('小窗口按预算收缩并标记，仍能算出正阈值', () => {
  const policy = compactionPolicy({ contextWindow: 16000, maxTokens: 8192 });
  assert.equal(policy.clamped, true);
  assert.equal(policy.headroomTokens, Math.floor((16000 - 8192) / 2));
  assert.ok(policy.thresholdTokens > 0);
  assert.ok(policy.retainTokens < policy.thresholdTokens);
  assert.match(compactionSummary(policy), /已按窗口收缩/);
});

test('极窄窗口收缩后保底 1024', () => {
  const policy = compactionPolicy({ contextWindow: 10000, maxTokens: 8192 });
  assert.equal(policy.headroomTokens, 1024);
  assert.ok(policy.thresholdTokens > 0);
});

test('maxTokens 不小于窗口时报错，不静默糊过去', () => {
  assert.throws(() => compactionPolicy({ contextWindow: 8192, maxTokens: 8192 }), /maxTokens 必须小于 contextWindow/);
});

test('比例越界与 retain 不小于 threshold 都报错', () => {
  assert.throws(() => compactionPolicy({ contextWindow: 128000, maxTokens: 8192, thresholdRatio: 1.2 }), /thresholdRatio/);
  assert.throws(() => compactionPolicy({ contextWindow: 128000, maxTokens: 8192, retainRatio: 0.9 }), /retainRatio 必须小于/);
});
