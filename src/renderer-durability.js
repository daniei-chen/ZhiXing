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

// This action is explicitly labelled as stopping the handoff in the global
// fallback. Otherwise an unmounted approval form and the save barrier can wait
// for one another forever. Panel-only recovery never calls this function.
export async function recoverRenderer(desktop) {
  const snapshot = await desktop?.runHandoffs?.();
  if (snapshot)
    await Promise.all(
      snapshot.runs
        .filter((run) => run.status === 'running')
        .map((run) => desktop.cancelRun(run.runId)),
    );
  await flushRendererDurability({ reason: 'recovery' });
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
