/* oxlint-disable t3code/no-low-value-comments -- The header carries the B6 findings, the replay fence and its stated cost: the constraint this observer must keep, not background. */
// AETHERIA M07 Plan step 19 (D10, B6) — the fork observer: it calls the goal service's `onSessionForked` once for each newly appearing fork of a main root, so the fork starts with a paused copy of the
// parent's goal and the parent is untouched. M07 supplies this hook itself (no `onSessionForked` exists in T3 or M05); this file owns only WHEN it is called, never what a copy is.
//
// What B6 found, and what follows from it. T3 has no fork event: a fork is a thread shell whose lineage names its parent, visible to the next pull of the lineage reader, with its Pi session null
// until M04's index binds it. A user's fork and an M05 fork child look identical there (`relationshipToParent: "fork"`); only M03's identity kind tells them apart, and the goal service reads that
// itself (a child answers `GOAL_NOT_ROOT`, an unreadable identity answers `unavailable`). So this observer diffs successive pulls and never decides identity.
//
// Replay fence. Copies come only from threads that APPEAR after the observer's first successful pull: every fork listed by that pull (a restart's whole history, or a replayed feed) is fenced and
// never copied, because a copy made later would take whatever goal the parent holds NOW, not the one it held at the fork. The cost is stated: a fork created while the server was down, or before the
// first pull, keeps D10's fallback (no goal, nothing runs). A thread is fenced once handled; the service's deterministic copy id and tombstones make a repeated call a no-op (`already`). A thread whose
// session or whose parent's session is not yet readable, or whose service answer is `unavailable`, is waiting and is tried again at the next observation; it is never read as "no goal".
//
// This file never writes T3's goal field (B7: the Backend has no write seam) and infers no goal from a fork's copied text or history.
import type { ChildLineageReader, ChildLineageThread } from "@t3tools/aetheria-server";

/** What the observer needs of the goal service's answer; `GoalResult<{copy}>` satisfies it. */
export type ForkCopyAnswer =
  | { readonly status: "ok"; readonly value: { readonly copy: "created" | "none" | "already" } }
  | { readonly status: "refused"; readonly code: string }
  | { readonly status: "unavailable" }
  | { readonly status: "awaiting-human" };

export interface GoalForkObserverDeps {
  /** The pull the M05 children service already uses (`lineageReader.ts`); an unreadable listing is `unavailable`, never an empty list. */
  readonly reader: ChildLineageReader;
  /** The Pi session M04's index bound to a thread: null when none, "unknown" when the index cannot be read. */
  readonly sessionOf: (threadId: string) => string | null | "unknown";
  readonly goals: {
    onSessionForked(fork: {
      readonly parentSessionId: string;
      readonly childSessionId: string;
    }): Promise<ForkCopyAnswer>;
  };
}

/** What happened to one thread in one observation. `child`: the service refused it as an M05 child (no goal, ever). `waiting`: not decidable yet, tried again next time. */
export type ForkObservation =
  | "created"
  | "none"
  | "already"
  | "child"
  | "refused"
  | "waiting"
  | "closed";

export interface ObserveReport {
  /** False when the listing could not be read: nothing was decided, and the fence is as it was. */
  readonly ok: boolean;
  /** True for the pass that took the fence (no copy is made in it). */
  readonly fenced: boolean;
  readonly forks: readonly { readonly threadId: string; readonly outcome: ForkObservation }[];
}

export interface GoalForkObserver {
  /**
   * Observes now and resolves with that pass's report. Calls that overlap share one serial loop (a call made while a pass runs causes exactly one more pass after it), so two events for one
   * fork never copy twice.
   */
  observe(): Promise<ObserveReport>;
}

const isFork = (thread: ChildLineageThread): boolean => thread.relationshipToParent === "fork";

export function makeGoalForkObserver(deps: GoalForkObserverDeps): GoalForkObserver {
  const fenced = new Set<string>();
  let baselined = false;
  let running: Promise<ObserveReport> | null = null;
  let again = false;

  async function pass(): Promise<ObserveReport> {
    let listing: Awaited<ReturnType<ChildLineageReader["listChildThreads"]>>;
    try {
      listing = await deps.reader.listChildThreads();
    } catch {
      return { ok: false, fenced: false, forks: [] };
    }
    if (!listing.ok) return { ok: false, fenced: false, forks: [] };
    const forks = listing.threads.filter(isFork);
    const listed = new Set(forks.map((thread) => thread.threadId));
    for (const id of fenced) if (!listed.has(id)) fenced.delete(id);
    if (!baselined) {
      for (const thread of forks) fenced.add(thread.threadId);
      baselined = true;
      return { ok: true, fenced: true, forks: [] };
    }
    const forksSeen: { threadId: string; outcome: ForkObservation }[] = [];
    for (const thread of forks) {
      if (fenced.has(thread.threadId)) continue;
      const outcome = await observeOne(thread);
      if (outcome !== "waiting") fenced.add(thread.threadId);
      forksSeen.push({ threadId: thread.threadId, outcome });
    }
    return { ok: true, fenced: false, forks: forksSeen };
  }

  async function observeOne(thread: ChildLineageThread): Promise<ForkObservation> {
    if (thread.closed) return "closed";
    const childSessionId = thread.sessionId;
    if (childSessionId === null || childSessionId === "unknown") return "waiting";
    const parentSessionId = deps.sessionOf(thread.parentThreadId);
    if (parentSessionId === null || parentSessionId === "unknown") return "waiting";
    let answer: ForkCopyAnswer;
    try {
      answer = await deps.goals.onSessionForked({ parentSessionId, childSessionId });
    } catch {
      return "waiting";
    }
    switch (answer.status) {
      case "ok":
        return answer.value.copy;
      case "refused":
        return answer.code === "GOAL_NOT_ROOT" ? "child" : "refused";
      default:
        return "waiting";
    }
  }

  /** Runs passes until none was requested during the last one, and reports every fork any of them decided. `running` is cleared in the same step that decides to stop, so no call slips between. */
  async function loop(): Promise<ObserveReport> {
    const decided: { readonly threadId: string; readonly outcome: ForkObservation }[] = [];
    let report: ObserveReport;
    let tookFence = false;
    do {
      again = false;
      report = await pass();
      decided.push(...report.forks);
      tookFence ||= report.fenced;
    } while (again);
    running = null;
    return { ok: report.ok, fenced: tookFence, forks: decided };
  }

  return {
    observe() {
      if (running !== null) {
        again = true;
        return running;
      }
      const started = loop();
      running = started;
      return started;
    },
  };
}
