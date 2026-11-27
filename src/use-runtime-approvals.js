import { useSyncExternalStore } from 'react';
import { runtimeApprovals } from './runtime-approvals.js';

export function useRuntimeApprovals(store = runtimeApprovals) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
