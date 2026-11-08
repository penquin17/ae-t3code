// AETHERIA — the Backend liveness service: one observation per holder (a T3 thread), `unknown` — never a free-looking state — whenever it cannot tell.
// Reads T3's `provider-session.*` records and writes nothing back; every event advances the sequence cursor, so a missing number is a missed observation.
// running = starting|running|waiting; settled = ready (not agent_end); stopped = stopped|detached; crash = error; restart = new session after stop or crash;
// unknown = never observed, gap, lost feed or unreadable record (with `lastKnown` kept).
export type LivenessKind = "running" | "settled" | "stopped" | "crash" | "restart" | "unknown";

/** Why a holder is `unknown`. */
export type UnknownReason =
  | "never-observed"
  | "gap"
  | "unreadable"
  | "feed-ended"
  | "feed-failed"
  | (string & {});

export interface LivenessObservation {
  readonly kind: LivenessKind;
  readonly threadId: string;
  readonly providerSessionId: string | null;
  /** 1 for the first Pi session seen for this thread; +1 each time a new one replaces it. */
  readonly incarnation: number;
  /** Short safe code for the record that produced this observation (a status word or `detached`); never payload text. */
  readonly basis: string;
  /** Sequence of the producing event; null when the state came from a gap, a lost feed or no event. */
  readonly sequence: number | null;
  /** Service clock (ms) when the state was set. */
  readonly observedAt: number;
  /** Set only when `kind` is `unknown`. */
  readonly reason: UnknownReason | null;
  /** What the holder was before it became `unknown`; null otherwise. */
  readonly lastKnown: Exclude<LivenessKind, "unknown"> | null;
}

/** A stored domain event, structurally. The service reads only these three fields and, for provider-session events, the payload's id and status. */
export interface LivenessInputEvent {
  readonly sequence: number;
  readonly type: string;
  readonly threadId: string;
  readonly payload?: unknown;
}

export interface LivenessObserverHandle {
  readonly close: () => void;
}

export interface LivenessService {
  /** Apply one stored event. Never throws: an event it cannot read makes the affected holder `unknown`. */
  ingest(event: LivenessInputEvent): void;
  /** The feed lost events or ended: every known holder becomes `unknown` until it is observed again. */
  noteGap(reason: UnknownReason): void;
  /** The holder for a thread; `unknown` (`never-observed`) when nothing was seen. */
  status(threadId: string): LivenessObservation;
  /** The holder whose CURRENT Pi session has this id; null for an unseen or replaced session. */
  statusOfProviderSession(providerSessionId: string): LivenessObservation | null;
  snapshot(): readonly LivenessObservation[];
  /** Read-only: frozen observations, on change only; a listener's throw or rejection is swallowed. */
  observe(
    listener: (observation: LivenessObservation) => void | Promise<void>,
  ): LivenessObserverHandle;
}

export interface LivenessOptions {
  readonly now?: () => number;
}

const STATUS_KIND: Readonly<Record<string, Exclude<LivenessKind, "unknown" | "restart">>> =
  Object.freeze({
    starting: "running",
    running: "running",
    waiting: "running",
    ready: "settled",
    stopped: "stopped",
    error: "crash",
  });

const TERMINAL = new Set<LivenessKind>(["stopped", "crash"]);

interface Holder {
  current: LivenessObservation;
  /** Session ids replaced by a newer incarnation; a late record of one of them must not undo the restart. */
  readonly retired: Set<string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function createLivenessService(options: LivenessOptions = {}): LivenessService {
  const now = options.now ?? Date.now;
  const holders = new Map<string, Holder>();
  const bySession = new Map<string, string>();
  const listeners = new Set<(observation: LivenessObservation) => void | Promise<void>>();
  let cursor: number | null = null;

  const notify = (observation: LivenessObservation): void => {
    for (const listener of Array.from(listeners)) {
      try {
        void Promise.resolve(listener(observation)).catch(() => {});
      } catch {
        /* an observer's failure never reaches the service */
      }
    }
  };

  const unknownObservation = (
    threadId: string,
    previous: LivenessObservation | undefined,
    reason: UnknownReason,
    sequence: number | null,
  ): LivenessObservation => ({
    kind: "unknown",
    threadId,
    providerSessionId: previous?.providerSessionId ?? null,
    incarnation: previous?.incarnation ?? 0,
    basis: previous?.basis ?? "none",
    sequence,
    observedAt: now(),
    reason,
    lastKnown:
      previous === undefined
        ? null
        : previous.kind === "unknown"
          ? previous.lastKnown
          : previous.kind,
  });

  const set = (threadId: string, next: LivenessObservation): void => {
    const frozen = Object.freeze(next);
    const holder = holders.get(threadId);
    const before = holder?.current;
    if (holder === undefined) holders.set(threadId, { current: frozen, retired: new Set() });
    else holder.current = frozen;
    if (frozen.providerSessionId !== null) bySession.set(frozen.providerSessionId, threadId);
    const changed =
      before === undefined ||
      before.kind !== frozen.kind ||
      before.providerSessionId !== frozen.providerSessionId ||
      before.incarnation !== frozen.incarnation ||
      before.reason !== frozen.reason;
    if (changed) notify(frozen);
  };

  const markUnknown = (threadId: string, reason: UnknownReason, sequence: number | null): void => {
    const holder = holders.get(threadId);
    if (holder === undefined) return;
    if (holder.current.kind === "unknown" && holder.current.reason === reason) return;
    set(threadId, unknownObservation(threadId, holder.current, reason, sequence));
  };

  const applySession = (
    event: LivenessInputEvent,
    id: string,
    status: string,
    isAttach: boolean,
  ): void => {
    const kindOfStatus = STATUS_KIND[status];
    if (kindOfStatus === undefined) {
      markUnknown(event.threadId, "unreadable", event.sequence);
      return;
    }
    const holder = holders.get(event.threadId);
    const previous = holder?.current;
    let incarnation = previous?.incarnation ?? 0;
    const sameSession = previous !== undefined && previous.providerSessionId === id;
    if (!sameSession) {
      // A record of a session this thread already replaced is history, not the present.
      if (holder?.retired.has(id) === true) return;
      if (previous !== undefined && previous.providerSessionId !== null) {
        holder?.retired.add(previous.providerSessionId);
        bySession.delete(previous.providerSessionId);
      }
      incarnation += 1;
    } else if (isAttach && previous !== undefined && TERMINAL.has(previous.kind)) {
      incarnation += 1; // the same session id re-attached after it stopped is a new process
    }
    const replaced = incarnation > (previous?.incarnation ?? 0);
    const afterEnd =
      previous !== undefined &&
      (TERMINAL.has(previous.kind) ||
        (previous.kind === "unknown" &&
          previous.lastKnown !== null &&
          TERMINAL.has(previous.lastKnown)));
    const kind: LivenessKind =
      replaced && afterEnd && (status === "starting" || status === "ready")
        ? "restart"
        : kindOfStatus;
    // A repeat of the same terminal status (T3 writes `error` twice on a crash) changes nothing.
    set(event.threadId, {
      kind,
      threadId: event.threadId,
      providerSessionId: id,
      incarnation,
      basis: status,
      sequence: event.sequence,
      observedAt: now(),
      reason: null,
      lastKnown: null,
    });
  };

  const applyDetached = (event: LivenessInputEvent, id: string): void => {
    const holder = holders.get(event.threadId);
    const previous = holder?.current;
    if (previous === undefined || previous.providerSessionId !== id) return; // a replaced or never-seen session: nothing is known to end
    if (previous.kind === "crash") return; // a crash is not softened into a graceful stop
    set(event.threadId, {
      ...previous,
      kind: "stopped",
      basis: "detached",
      sequence: event.sequence,
      observedAt: now(),
      reason: null,
      lastKnown: null,
    });
  };

  const service: LivenessService = {
    ingest(event) {
      try {
        if (
          !Number.isInteger(event.sequence) ||
          typeof event.threadId !== "string" ||
          typeof event.type !== "string"
        )
          return;
        if (cursor !== null && event.sequence <= cursor) return; // a replay or an old record never rewrites the present
        if (cursor !== null && event.sequence !== cursor + 1)
          for (const threadId of Array.from(holders.keys()))
            markUnknown(threadId, "gap", event.sequence);
        cursor = event.sequence;
        const { type, payload } = event;
        if (type === "provider-session.attached" || type === "provider-session.updated") {
          if (
            !isRecord(payload) ||
            typeof payload["id"] !== "string" ||
            typeof payload["status"] !== "string"
          )
            markUnknown(event.threadId, "unreadable", event.sequence);
          else
            applySession(
              event,
              payload["id"],
              payload["status"],
              type === "provider-session.attached",
            );
        } else if (type === "provider-session.detached") {
          if (!isRecord(payload) || typeof payload["providerSessionId"] !== "string")
            markUnknown(event.threadId, "unreadable", event.sequence);
          else applyDetached(event, payload["providerSessionId"]);
        }
      } catch {
        try {
          markUnknown(event.threadId, "unreadable", null);
        } catch {
          /* ingest never throws */
        }
      }
    },

    noteGap(reason) {
      for (const threadId of Array.from(holders.keys())) markUnknown(threadId, reason, null);
    },

    status(threadId) {
      return (
        holders.get(threadId)?.current ??
        Object.freeze(unknownObservation(threadId, undefined, "never-observed", null))
      );
    },

    statusOfProviderSession(providerSessionId) {
      const threadId = bySession.get(providerSessionId);
      const holder = threadId === undefined ? undefined : holders.get(threadId);
      return holder !== undefined && holder.current.providerSessionId === providerSessionId
        ? holder.current
        : null;
    },

    snapshot: () => Object.freeze([...holders.values()].map((h) => h.current)),

    observe(listener) {
      listeners.add(listener);
      return Object.freeze({ close: () => void listeners.delete(listener) });
    },
  };
  return Object.freeze(service);
}
