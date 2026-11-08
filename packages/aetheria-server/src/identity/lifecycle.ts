// AETHERIA — T3 lifecycle observations for M03's identity sweep, kept per thread and joined to Pi sessions through the thread index; it has no writer and no store.
// Every answer is `true`, `false` or `null`; `null` (unknown) retains the record, and an accepted prompt (`true`) is permanent.
// `exists:false` and `closed:true` come only from what T3 reported; unbound or doubly claimed sessions answer unknown and never resolve to an identity.

import type { ThreadIndex } from "./threadIndex.ts";

/** What T3 reports about one thread. `closed.acceptedPrompt` states whether T3 positively knows a prompt was accepted (`true`), was never accepted (`false`), or does not know (`null`). */
export type LifecycleEvent =
  | {
      readonly kind: "running" | "settled" | "accepted" | "deleted" | "unknown";
      readonly threadId: string;
    }
  | { readonly kind: "closed"; readonly threadId: string; readonly acceptedPrompt: boolean | null };

/** The three answers M03's sweep reads. Structurally M03's `LifecycleObservation`. */
export interface LifecycleObservation {
  readonly exists: boolean | null;
  readonly closed: boolean | null;
  readonly acceptedPrompt: boolean | null;
}

/** The part of M03's `LifecycleObserver` the Backend can answer: sessions only (staged attempts are the Agent host's). */
export interface LifecycleObserver {
  readonly session: (sessionId: string) => LifecycleObservation;
}

/** M03's `SweepReport`, structurally. */
export interface SweepReport {
  readonly removedPending: readonly string[];
  readonly retired: readonly string[];
  readonly retained: readonly { readonly id: string; readonly why: string }[];
  readonly problems: readonly string[];
}

/** The store's sweep, given the observer to consult. Supplied by whoever holds the identity store's sweep. */
export type Sweeper = (observer: LifecycleObserver) => SweepReport;

export interface SweepOutcome {
  /** The store's report, or `null` when the sweep did not run or returned nothing usable. */
  readonly report: SweepReport | null;
  /** Retained sessions no thread is bound to: stray records (T3's short-lived discovery processes) and launches not yet indexed. Never resolvable. */
  readonly unbound: readonly string[];
  readonly problems: readonly string[];
}

export interface LifecycleTracker {
  /** Take one T3 observation. Returns false, and changes nothing, for an event that is not well-formed. */
  record(event: LifecycleEvent): boolean;
  /** The observer to hand a sweep. Frozen; it can only be asked. */
  observer(): LifecycleObserver;
  /** Run a sweep with this tracker's observer and classify what it retained. */
  sweep(sweeper: Sweeper): SweepOutcome;
  /** The observer's three answers for each listed session, as one frozen record: what the Agent host's sweep is given over XC-6 (step 16). */
  snapshot(sessionIds: readonly string[]): Readonly<Record<string, LifecycleObservation>>;
}

interface State {
  exists: boolean | null;
  closed: boolean | null;
  acceptedPrompt: boolean | null;
}

const UNKNOWN: LifecycleObservation = Object.freeze({
  exists: null,
  closed: null,
  acceptedPrompt: null,
});
const KINDS = new Set(["running", "settled", "accepted", "deleted", "unknown", "closed"]);

export function createLifecycleTracker(options: {
  readonly index: Pick<ThreadIndex, "threadsOf">;
}): LifecycleTracker {
  const { index } = options;
  const threads = new Map<string, State>();

  const record = (event: LifecycleEvent): boolean => {
    if (event === null || typeof event !== "object") return false;
    const { kind, threadId } = event as { kind?: unknown; threadId?: unknown };
    if (
      typeof kind !== "string" ||
      !KINDS.has(kind) ||
      typeof threadId !== "string" ||
      threadId === "" ||
      threadId.length > 256
    )
      return false;
    if (kind === "closed") {
      const accepted = (event as { acceptedPrompt?: unknown }).acceptedPrompt;
      if (accepted !== null && typeof accepted !== "boolean") return false;
    }
    const state = threads.get(threadId) ?? { exists: null, closed: null, acceptedPrompt: null };
    switch (kind) {
      case "running":
      case "settled":
        state.exists = true;
        state.closed = false;
        break;
      case "accepted":
        state.exists = true;
        state.acceptedPrompt = true;
        break;
      case "closed": {
        const accepted = (event as { acceptedPrompt: boolean | null }).acceptedPrompt;
        state.exists = true;
        state.closed = true;
        // Accepted is permanent; a closure can add knowledge but never withdraw it.
        if (state.acceptedPrompt !== true && accepted !== null) state.acceptedPrompt = accepted;
        break;
      }
      case "deleted":
        state.exists = false;
        break;
      default:
        // "unknown": the perishable facts are forgotten, the permanent one is kept.
        state.exists = null;
        state.closed = null;
    }
    threads.set(threadId, state);
    return true;
  };

  const observer: LifecycleObserver = Object.freeze({
    session(sessionId: string): LifecycleObservation {
      const holders = typeof sessionId === "string" ? index.threadsOf(sessionId) : [];
      if (holders.length !== 1) return UNKNOWN;
      const state = threads.get(holders[0] as string);
      return state === undefined
        ? UNKNOWN
        : Object.freeze({
            exists: state.exists,
            closed: state.closed,
            acceptedPrompt: state.acceptedPrompt,
          });
    },
  });

  return Object.freeze({
    record,
    observer: () => observer,
    snapshot(sessionIds: readonly string[]): Readonly<Record<string, LifecycleObservation>> {
      const out: Record<string, LifecycleObservation> = Object.create(null);
      for (const id of sessionIds)
        if (typeof id === "string" && id !== "") out[id] = observer.session(id);
      return Object.freeze(out);
    },
    sweep(sweeper: Sweeper): SweepOutcome {
      let report: SweepReport;
      try {
        report = sweeper(observer);
      } catch (error) {
        return Object.freeze({
          report: null,
          unbound: Object.freeze([]),
          problems: Object.freeze([
            `the sweep failed: ${error instanceof Error ? error.message : String(error)}`,
          ]),
        });
      }
      if (
        report === null ||
        typeof report !== "object" ||
        !Array.isArray(report.retained) ||
        !Array.isArray(report.retired) ||
        !Array.isArray(report.problems)
      ) {
        return Object.freeze({
          report: null,
          unbound: Object.freeze([]),
          problems: Object.freeze(["the sweep returned no report"]),
        });
      }
      const unbound = report.retained
        .map((r) => r.id)
        .filter((id) => index.threadsOf(id).length === 0)
        .sort();
      return Object.freeze({
        report,
        unbound: Object.freeze(unbound),
        problems: Object.freeze([...report.problems]),
      });
    },
  });
}
