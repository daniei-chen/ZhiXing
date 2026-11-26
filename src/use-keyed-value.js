import { useCallback, useSyncExternalStore } from 'react';

export function useKeyedValue(store, key, fallback) {
  const subscribe = useCallback(
    (listener) => store?.subscribe(key, listener) || (() => {}),
    [store, key],
  );
  const snapshot = useCallback(() => store?.get(key), [store, key]);
  return useSyncExternalStore(subscribe, snapshot, snapshot) ?? fallback;
}
