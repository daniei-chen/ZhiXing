import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeBridge } from '../harness/privacy-bridge.mjs';

// The bridge publishes one encrypted record by atomic rename. Only absence
// means it may still be starting; corrupt records and access failures stay loud.
// The caller shares this signal with HTTP, so readiness cannot renew its budget.
export async function waitExecutionControlBridge(file, key, signal) {
  for (;;) {
    signal.throwIfAborted();
    try {
      return decodeBridge(await fs.readFile(file, { signal }), key);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(25, undefined, { signal });
  }
}
