import fs from 'node:fs';

// Watch one project directory at a time per scope and report batched changes.
// Windows supports recursive fs.watch; anything else falls back to a shallow
// watch so a missing platform feature degrades instead of throwing.
export class FileWatcher {
  constructor({onChange, delayMs = 400} = {}) {
    this.onChange = onChange;
    this.delayMs = delayMs;
    this.watchers = new Map();
    this.timers = new Map();
    this.pending = new Map();
  }

  watch(key, directory) {
    this.unwatch(key);
    if (!directory) return false;
    let watcher;
    try {
      watcher = fs.watch(directory, {recursive: true, persistent: false}, (event, filename) => {
        this.record(key, {event, filename: typeof filename === 'string' ? filename : null});
      });
    } catch {
      try {
        watcher = fs.watch(directory, {persistent: false}, (event, filename) => {
          this.record(key, {event, filename: typeof filename === 'string' ? filename : null});
        });
      } catch { return false; }
    }
    watcher.on('error', () => this.unwatch(key));
    this.watchers.set(key, {watcher, directory});
    return true;
  }

  record(key, change) {
    const entry = this.pending.get(key) || {count: 0, paths: new Set(), last: null};
    entry.count += 1;
    entry.last = change.event;
    if (change.filename && entry.paths.size < 20) entry.paths.add(change.filename.replace(/\\/g, '/'));
    this.pending.set(key, entry);
    if (this.timers.has(key)) return;
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      const batch = this.pending.get(key);
      this.pending.delete(key);
      if (batch) this.onChange?.(key, {count: batch.count, last: batch.last, paths: [...batch.paths]});
    }, this.delayMs));
  }

  unwatch(key) {
    const timer = this.timers.get(key);
    if (timer) { clearTimeout(timer); this.timers.delete(key); }
    this.pending.delete(key);
    const entry = this.watchers.get(key);
    if (!entry) return false;
    try { entry.watcher.close(); } catch {}
    this.watchers.delete(key);
    return true;
  }

  closeAll() {
    for (const key of [...this.watchers.keys()]) this.unwatch(key);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }
}
