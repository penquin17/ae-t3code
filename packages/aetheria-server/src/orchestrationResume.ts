// AETHERIA M05 step 6 (C2 resume): M06's resume handling (reconcileWaits, then redeliver) is tracked per Pi session here.
// The children service awaits `resumed(sessionId)` before releasing that session's deliveries; M05 makes no second reconcile call.
// The barrier opens when the handling ends, however it ends, and never rejects a waiter.
export interface ResumeBarrier {
  /** Registers one resume handling for a session; resolves (never rejects) when it has ended. */
  track(sessionId: string, handling: Promise<unknown>): Promise<void>;
  /** Resolves once no tracked handling of this session is in progress. Immediately when there is none. */
  resumed(sessionId: string): Promise<void>;
}

export function createResumeBarrier(): ResumeBarrier {
  const pending = new Map<string, Set<Promise<void>>>();
  const barrier: ResumeBarrier = {
    track(sessionId, handling) {
      const ended: Promise<void> = Promise.resolve(handling).then(
        () => undefined,
        () => undefined,
      );
      const set = pending.get(sessionId) ?? new Set<Promise<void>>();
      set.add(ended);
      pending.set(sessionId, set);
      void ended.then(() => {
        set.delete(ended);
        if (set.size === 0 && pending.get(sessionId) === set) pending.delete(sessionId);
      });
      return ended;
    },
    async resumed(sessionId) {
      // Loop: a handling that begins while we wait is also waited for.
      for (
        let set = pending.get(sessionId);
        set !== undefined && set.size > 0;
        set = pending.get(sessionId)
      )
        await Promise.all(set);
    },
  };
  return Object.freeze(barrier);
}
