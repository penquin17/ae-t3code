// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M05 Plan step 9 (D19/R1, native round 3, IP-25) — the Backend's side of the one narrow way to open a held child's Pi session with a REQUESTED session id.
//
// The Backend's ThreadPort adapter (threadPort.ts) records the id it wants for a child thread here, just before it asks T3 to open the thread's provider session. The Pi
// adapter (`packages/provider-pi/src/server/adapter.ts`, IP-25) takes it once, when it launches that thread's Pi process, and adds Pi's own `--session-id <id>`. A launch
// argument a USER supplies is still refused there; only this slot, which only the in-process Backend can fill, can ask for an id. Absent on bare T3: nothing is requested.
//
// A request is for one launch: `take` removes it, so a later session of the same thread gets Pi's own id, and an abandoned request is withdrawn by `withdraw`.

/** The global slot the Pi adapter reads. The same key as provider-pi's `AETHERIA_SESSION_ID_SEAM`; the two sides share nothing else. */
const SLOT = Symbol.for("aetheria.pi.session-id-seam");

interface SessionIdSeam {
  /** The id requested for the thread's next Pi launch, once; undefined when none was requested. */
  readonly take: (threadId: string) => string | undefined;
}

const requests = new Map<string, string>();
const seam: SessionIdSeam = {
  take: (threadId) => {
    const id = requests.get(threadId);
    requests.delete(threadId);
    return id;
  },
};

/**
 * The slot key of a FORK thread's copy. T3's `thread.fork` makes only the thread; the Pi session copy is made later by `PiAdapter.forkThread` (`pi --fork <file> --session-id <id>`),
 * which asks for `fork:<threadId>`. The thread's own open launch asks for the plain thread id, so it can never consume (or be given) a fork's request.
 */
export const forkSlotKey = (threadId: string): string => `fork:${threadId}`;

/** Asks for `sessionId` as the Pi session id of the thread's next launch. Installs the slot on first use (idempotent). */
export function requestPiSessionId(threadId: string, sessionId: string): void {
  (globalThis as Record<symbol, SessionIdSeam | undefined>)[SLOT] = seam;
  requests.set(threadId, sessionId);
}

/** Withdraws an unused request (a launch that failed or never happened must not leave one for a later session). */
export function withdrawPiSessionIdRequest(threadId: string): void {
  requests.delete(threadId);
}
