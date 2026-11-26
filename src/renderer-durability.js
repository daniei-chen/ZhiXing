// Keep the last mounted App's durability barrier after a render failure. Its
// cleanup can still be waiting for write A before submitting newer draft B;
// remounting/reloading before B reaches the host could restore stale input.
let barrier = async ({ reason } = {}) => {
  if (reason === 'quit') throw new Error('本机工作空间尚未完成读取。');
};

export function registerRendererDurability(flush) {
  barrier = flush;
}

export function flushRendererDurability(options) {
  return barrier(options);
}

// This listener belongs to the renderer entry point, outside the App subtree.
// A global render failure must not remove the host's normal quit handshake.
export function bindRendererDurability(desktop) {
  return desktop?.onPrepareToQuit?.(async () => {
    try {
      await flushRendererDurability({ reason: 'quit' });
      desktop.acknowledgeQuitPreparation?.({ saved: true });
    } catch {
      desktop.acknowledgeQuitPreparation?.({
        saved: false,
        error: '最后的更改仍未保存，请检查磁盘空间和本机权限后重试。',
      });
    }
  });
}
