// A renderer document can disappear while the host is still settling a run.
// Persistent conversations keep their saved anchor; volatile ones are cancelled
// and retired only after both the result and the actual process cleanup finish.
export class RendererLifetime {
  #generation = 0;
  #detached = new Map();

  constructor({ manager, handoffs, onError = () => {} }) {
    this.manager = manager;
    this.handoffs = handoffs;
    this.onError = onError;
  }

  get generation() {
    return this.#generation;
  }

  detach() {
    this.#generation += 1;
    const checks = [];
    for (const run of this.handoffs.snapshot().runs) {
      if (run.persist) continue;
      let entry = this.#detached.get(run.runId);
      if (!entry) {
        entry = {
          identity: { hostEpoch: run.hostEpoch, runId: run.runId, sessionId: run.sessionId },
          cancelAccepted: false,
          checkAgain: false,
          task: null,
        };
        this.#detached.set(run.runId, entry);
      }
      checks.push(this.#schedule(entry));
    }
    return Promise.all(checks);
  }

  observe(event) {
    if (event?.type !== 'run/terminal' || event.finalization?.processStatus !== 'exited')
      return Promise.resolve();
    const entry = this.#detached.get(event.runId);
    if (!entry || entry.identity.sessionId !== event.sessionId) return Promise.resolve();
    return this.#schedule(entry);
  }

  #notify(entry, stage) {
    try {
      // Keep failures actionable without logging receipt contents, paths or
      // native errors. The pending record remains available for a later retry.
      this.onError({ runId: entry.identity.runId, stage });
    } catch {
      // Diagnostics cannot turn a retained result into an unhandled rejection.
    }
  }

  #present(entry) {
    const { hostEpoch, runId, sessionId } = entry.identity;
    return this.handoffs
      .snapshot()
      .runs.some(
        (run) => run.hostEpoch === hostEpoch && run.runId === runId && run.sessionId === sessionId,
      );
  }

  #schedule(entry) {
    entry.checkAgain = true;
    if (entry.task) return entry.task;
    const completion = Promise.withResolvers();
    entry.task = completion.promise;
    // The microtask also crosses RuntimeManager's emit-terminal -> releaseRun
    // sequence. An exited event alone never authorizes deletion while its run
    // is still present in the manager's quarantine map.
    void Promise.resolve().then(async () => {
      try {
        while (entry.checkAgain && this.#detached.get(entry.identity.runId) === entry) {
          entry.checkAgain = false;
          await this.#retire(entry);
        }
      } catch {
        this.#notify(entry, 'retire');
      } finally {
        entry.task = null;
        completion.resolve();
      }
    });
    return entry.task;
  }

  async #retire(entry) {
    const { runId } = entry.identity;
    if (!entry.cancelAccepted) {
      try {
        await this.manager.cancel(runId);
        entry.cancelAccepted = true;
      } catch {
        this.#notify(entry, 'cancel');
        return;
      }
    }

    if (this.#present(entry)) {
      try {
        await this.handoffs.wait(entry.identity);
      } catch {
        // The previous renderer can acknowledge a settled receipt while its
        // document is going away. That race is already complete, not an error.
        if (this.#present(entry)) {
          this.#notify(entry, 'wait');
          return;
        }
      }
    }
    if (this.manager.runs.has(runId)) return;

    if (this.#present(entry)) {
      try {
        this.handoffs.forget(entry.identity);
      } catch {
        if (this.#present(entry)) {
          this.#notify(entry, 'forget');
          return;
        }
      }
    }
    this.#detached.delete(runId);
  }
}
