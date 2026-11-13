// The sessions a thread has replaced (M10 review 1, follow-up 4b). The Backend's snapshot of the thread's live root names the roots the thread held before (`retiredRoots`); what each of them asked and
// left open is still the person's to read, so the page reads each one's snapshot and lists its records with the live root's. Plain TypeScript: the per-root read is supplied.
import type { SnapshotRead } from "./resync";
import type { InteractionRecord, InteractionsSnapshot } from "./types";

/**
 * The live root's snapshot with every earlier root's records added after its own; the version stays the live root's (pushes are for that root). An earlier root that cannot be read makes the whole read a
 * failure that says so: a list that quietly leaves a session's requests out would read as complete.
 */
export async function readWithEarlier(
  first: InteractionsSnapshot,
  readEarlier: (rootSessionId: string) => Promise<SnapshotRead>,
): Promise<SnapshotRead> {
  const roots = first.retiredRoots ?? [];
  if (roots.length === 0) return { tag: "ok", snapshot: first };
  const seen = new Set(first.interactions.map((record) => record.interactionId));
  const merged: InteractionRecord[] = [...first.interactions];
  for (const root of roots) {
    const read = await readEarlier(root);
    if (read.tag !== "ok") {
      return {
        tag: "failed",
        reason: `an earlier session of this thread could not be read (${read.reason})`,
      };
    }
    for (const record of read.snapshot.interactions) {
      if (seen.has(record.interactionId)) continue;
      seen.add(record.interactionId);
      merged.push(record);
    }
  }
  return { tag: "ok", snapshot: { ...first, interactions: merged } };
}

/** A record the page's live root did not ask: an earlier session of the same thread did. */
export const isFromEarlierSession = (
  record: InteractionRecord,
  liveRootSessionId: string,
): boolean => record.rootSessionId !== liveRootSessionId;
