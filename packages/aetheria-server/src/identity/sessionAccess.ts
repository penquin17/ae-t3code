// AETHERIA — which thread-index resolver a caller may use for a Pi session whose thread has replaced it (see threadIndex.ts, "Retired sessions").
// Reads and a late answer's route to the THREAD may use the alias (`canOperate`, `threadOf`); every write to a session uses `liveThreadOf` only.
// A late answer goes through T3's by-thread intake to the thread's live session; it never writes to the replaced Pi session.
import type { ThreadIndex } from "./threadIndex.ts";

export interface SessionAccess {
  /** The human-control access rule: the target session and its root each belong to a bound thread, live or replaced. */
  canOperate(target: { readonly sessionId: string; readonly rootSessionId: string }): boolean;
  /** The thread a session belongs to for reading and for routing a late answer to its thread: live or replaced; unknown or ambiguous is undefined. */
  threadOf(sessionId: string): string | undefined;
  /** The thread a session is bound to LIVE, for every path that writes to the session. A replaced session is undefined. */
  liveThreadOf(sessionId: string): string | undefined;
}

export function createSessionAccess(
  index: Pick<ThreadIndex, "aliasOfSession" | "bindingOfSession">,
): SessionAccess {
  const threadOf = (sessionId: string): string | undefined =>
    index.aliasOfSession(sessionId)?.binding.threadId;
  const access: SessionAccess = {
    canOperate: (target) =>
      threadOf(target.sessionId) !== undefined && threadOf(target.rootSessionId) !== undefined,
    threadOf,
    liveThreadOf: (sessionId) => index.bindingOfSession(sessionId)?.threadId,
  };
  return Object.freeze(access);
}
