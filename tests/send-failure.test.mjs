import test from 'node:test';
import assert from 'node:assert/strict';
import { SEND_RECOVERY, sendFailureToast, sendRecoveryState } from '../src/send-failure.js';

test('发送被拒后的三种结局分别给出准确的恢复文案', () => {
  const message = '合成主机拒绝了本次启动。';
  // ① 本来就没有草稿：再次执行、斜杠命令，用户一个字都没打。
  assert.equal(
    sendRecoveryState({ hadDraft: false, consumed: false, restored: false, kept: false }),
    SEND_RECOVERY.none,
  );
  assert.equal(sendFailureToast(message, SEND_RECOVERY.none), `未发送：${message}`);
  assert.doesNotMatch(sendFailureToast(message, SEND_RECOVERY.none), /恢复|输入框/);

  // ② 草稿没被消费：内容原样留在输入框里，不能说没了。
  assert.equal(
    sendRecoveryState({ hadDraft: true, consumed: false, restored: false, kept: true }),
    SEND_RECOVERY.kept,
  );
  const kept = sendFailureToast(message, SEND_RECOVERY.kept);
  assert.match(kept, /刚才的内容还在输入框里/);
  assert.doesNotMatch(kept, /没能恢复/);

  // ③ 消费了却没还原：这时才可以说没恢复。
  assert.equal(
    sendRecoveryState({ hadDraft: true, consumed: true, restored: false, kept: false }),
    SEND_RECOVERY.lost,
  );
  const lost = sendFailureToast(message, SEND_RECOVERY.lost);
  assert.match(lost, /没能恢复，请重新输入/);

  // ④ 还原成功：不论是原样写回还是接到后面，都告诉用户内容接回来了。
  assert.equal(
    sendRecoveryState({ hadDraft: true, consumed: true, restored: true, kept: false }),
    SEND_RECOVERY.restored,
  );
  assert.match(sendFailureToast(message, SEND_RECOVERY.restored), /已接回输入框/);
});

test('恢复状态不会把没被消费的草稿当成丢失', () => {
  // 有草稿但没被消费，输入框却是空的（用户自己清掉了）：这时确实没有内容可回。
  assert.equal(
    sendRecoveryState({ hadDraft: true, consumed: false, restored: false, kept: false }),
    SEND_RECOVERY.lost,
  );
  // restored 只可能发生在消费之后；即使调用方传错，也不能降级成「还在输入框里」。
  assert.equal(
    sendRecoveryState({ hadDraft: true, consumed: true, restored: true, kept: true }),
    SEND_RECOVERY.restored,
  );
});
