// AETHERIA M06 step 13 (D5): a bound thread attached to a provider session after replay is a resume; the interaction service then
// reconciles that Pi session's waits and redelivers its late answers. This file only decides "is this event a resume"; history
// (sequence at or before the replay horizon, or an unknown horizon) never is, and a failing call is swallowed so the feed never stops.

/** What the signal needs of the interaction service. */
export interface ResumeTarget {
  reconcileWaits(sessionId: string): Promise<unknown>;
  redeliver(sessionId: string): Promise<unknown>;
}

export interface ResumeSignalOptions {
  /** The Pi session bound to a thread, or undefined when there is none (or more than one: never a guess). */
  readonly sessionOf: (threadId: string) => string | undefined;
  /** The running interaction service, or undefined before start and after drain. */
  readonly target: () => ResumeTarget | undefined;
  /** The highest sequence that existed before the feed was subscribed; undefined until known. */
  readonly horizon: () => number | undefined;
}

export interface ResumeSignal {
  /** Settles after both calls ended; never rejects. */
  attached(event: { readonly threadId: string; readonly sequence: number }): Promise<void>;
}

export function createResumeSignal(options: ResumeSignalOptions): ResumeSignal {
  const signal: ResumeSignal = {
    async attached(event) {
      const horizon = options.horizon();
      if (horizon === undefined || event.sequence <= horizon) return;
      const target = options.target();
      if (target === undefined) return;
      const sessionId = options.sessionOf(event.threadId);
      if (sessionId === undefined) return;
      await Promise.resolve()
        .then(() => target.reconcileWaits(sessionId))
        .catch(() => undefined);
      await Promise.resolve()
        .then(() => target.redeliver(sessionId))
        .catch(() => undefined);
    },
  };
  return Object.freeze(signal);
}
