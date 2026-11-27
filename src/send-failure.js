// 直接发送被宿主拒绝后，用户刚写的那段内容到底怎么样，有三种完全不同的结局：
// 本来就没有草稿（再次执行、斜杠命令）、草稿没被消费所以还在输入框里、以及
// 消费了却没能还原。共用一句「内容没能恢复」会让什么都没丢的人以为丢了，
// 也会让内容还在输入框里的人重复输入再发一遍。
export const SEND_RECOVERY = { none: 'none', kept: 'kept', restored: 'restored', lost: 'lost' };

export function sendRecoveryState({ hadDraft, consumed, restored, kept }) {
  if (!hadDraft) return 'none';
  if (restored) return 'restored';
  if (!consumed && kept) return 'kept';
  return 'lost';
}

export function sendFailureToast(message, state) {
  const prefix = `未发送：${message}`;
  if (state === 'kept') return `${prefix}刚才的内容还在输入框里。`;
  if (state === 'restored') return `${prefix}刚才没送出的内容已接回输入框。`;
  if (state === 'lost') return `${prefix}刚才输入的内容没能恢复，请重新输入。`;
  return prefix;
}
