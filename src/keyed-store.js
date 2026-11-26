// Each subscriber owns one draft or run. An unrelated keystroke/token must not
// invalidate the workspace, sidebar, or previously completed messages.
export function createKeyedStore() {
  const values = new Map();
  const listeners = new Map();
  return {
    get(key) {
      return values.get(key);
    },
    set(key, value) {
      if (!key || Object.is(values.get(key), value)) return;
      if (value === undefined) values.delete(key);
      else values.set(key, value);
      for (const listener of listeners.get(key) || []) listener();
    },
    replace(entries) {
      for (const key of values.keys()) {
        if (!Object.hasOwn(entries, key)) this.set(key, undefined);
      }
      for (const [key, value] of Object.entries(entries)) this.set(key, value);
    },
    subscribe(key, listener) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(listener);
      return () => {
        const group = listeners.get(key);
        group?.delete(listener);
        if (!group?.size) listeners.delete(key);
      };
    },
  };
}
