// AETHERIA M09 step 21 — snapshot retention (design D16 as refined by R7): the snapshots of a Pi session live until the last thread holding that
// session is deleted. T3 announces a deletion as a `thread.deleted` event on the stream the Backend already reads; the thread index maps the thread
// to the Pi session the snapshots are tied to. The index keeps a deleted thread's binding, so a session with several holders is forgotten only when
// every other holder has been seen deleted; those sightings are kept in memory, and the stream replays them at the next start.
import type { ThreadIndex } from "./identity/threadIndex.ts";

export interface SnapshotRetentionOptions {
  readonly index: Pick<ThreadIndex, "lookup" | "threadsOf">;
  /** Removes a Pi session's snapshots (the providers module's `forgetSession`). */
  readonly forgetSession: (sessionId: string) => Promise<unknown>;
}

export interface SnapshotRetention {
  /** Apply one thread deletion. Never throws: a failed forget is retried when the event is replayed at the next start. */
  threadDeleted(threadId: string): Promise<void>;
}

export function createSnapshotRetention(options: SnapshotRetentionOptions): SnapshotRetention {
  const { index } = options;
  const deletedHolders = new Map<string, Set<string>>();

  return Object.freeze({
    async threadDeleted(threadId: string): Promise<void> {
      try {
        const found = index.lookup(threadId);
        if (found.status !== "ok") return;
        const sessionId = found.binding.sessionId;
        const seen = deletedHolders.get(sessionId) ?? new Set<string>();
        const others = index.threadsOf(sessionId).filter((holder) => holder !== threadId);
        if (!others.every((holder) => seen.has(holder))) {
          seen.add(threadId);
          deletedHolders.set(sessionId, seen);
          return;
        }
        deletedHolders.delete(sessionId);
        await options.forgetSession(sessionId);
      } catch {
        /* retention never fails the event feed */
      }
    },
  });
}
