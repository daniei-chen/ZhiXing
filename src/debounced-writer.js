// A bounded delay reduces disk writes without leaving continuously edited
// drafts pending forever. Explicit barriers also wait for an in-flight write
// and any newer edits. Failures retain the newest snapshot for retry.
export function createDebouncedWriter({
  snapshot,
  write,
  onError = () => {},
  delay = 400,
  maxWait = 2000,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let requested = 0;
  let persisted = 0;
  let quietTimer;
  let maximumTimer;
  let inFlight;
  let disposed = false;

  function clearTimers() {
    cancel(quietTimer);
    cancel(maximumTimer);
    quietTimer = maximumTimer = undefined;
  }

  async function flush() {
    clearTimers();
    if (inFlight) {
      await inFlight;
      if (requested > persisted) return flush();
      return;
    }
    if (requested === persisted) return;
    const revision = requested;
    const value = snapshot();
    inFlight = Promise.resolve().then(() => write(value));
    try {
      await inFlight;
      persisted = revision;
    } catch (error) {
      onError(error);
      throw error;
    } finally {
      inFlight = undefined;
    }
    if (requested > persisted) return flush();
  }

  function backgroundFlush() {
    // onError exposes the failure; only an explicit retry or newer edit retries.
    void flush().catch(() => {});
  }

  return {
    schedule() {
      if (disposed) return;
      requested++;
      cancel(quietTimer);
      quietTimer = schedule(backgroundFlush, delay);
      maximumTimer ??= schedule(backgroundFlush, maxWait);
    },
    flush,
    pending() {
      return requested > persisted;
    },
    dispose() {
      disposed = true;
      clearTimers();
    },
    resume() {
      disposed = false;
    },
  };
}
