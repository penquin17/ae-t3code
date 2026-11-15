// The goal view's hook (M07 Plan step 18, D24, XC-23): subscribe to the root's change stream FIRST (the atom is read before any effect runs), then read the snapshot; a push only prompts a re-read, the newest
// version wins, and a failed or ended stream marks the value stale or unavailable. It also owns the one Re-arm action: one in flight, its last report, nothing optimistic, and no call that cancels anything
// when the page disconnects or unmounts. The hook is made for a mounted (environment, root): the page keys the provider on both, so they are fixed for its life and a reply that lands after a root switch lands
// in the old, unmounted instance and nowhere else.
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "../../../hooks/useStableCallback";
import { randomUUID } from "~/lib/utils";
import { createSequencedReader } from "../reads";
import { useNewSession } from "../useControl";
import { goalChanges } from "./commands";
import { createRearm, type RearmReport } from "./rearm";
import { classifySnapshot, type GoalRead, type GoalView } from "./reply";
import {
  disconnected,
  initialGoals,
  liveGoal,
  pushArrived,
  reconnected,
  snapshotArrived,
  snapshotFailed,
  streamEnded,
  viewOf,
  type GoalsState,
  type GoalsView,
} from "./state";
import type { GoalsTransport } from "./types";

export interface RearmControl {
  /** True from the click until the Re-arm settles and the goal was read back. */
  readonly busy: boolean;
  /** The last Re-arm's report, kept until the next one starts. */
  readonly report: RearmReport | null;
  /** Re-arms the goal as the person saw it. Sends nothing for a goal with no offer or while one is in flight; resolves when it settled. */
  readonly start: (goal: GoalView) => Promise<void>;
}

export interface GoalsHandle {
  readonly view: GoalsView;
  readonly rearm: RearmControl;
  /** One sequenced re-read: it updates the view and reports what it found. */
  readonly readSnapshot: () => Promise<GoalRead>;
}

export function useGoals(
  transport: GoalsTransport,
  environmentId: string,
  rootSessionId: string,
): GoalsHandle {
  const signal = useAtomValue(goalChanges(environmentId, rootSessionId));
  const [state, setState] = useState<GoalsState>(initialGoals);
  const stateRef = useRef(state);
  const apply = (next: GoalsState) => {
    stateRef.current = next;
    setState(next);
  };

  /** One read applied to the state; `again` is true when a push already seen is newer than what it returned. */
  const readOnce = useStableCallback(
    async (): Promise<{ readonly read: GoalRead; readonly again: boolean }> => {
      const read = classifySnapshot(await transport.snapshot(environmentId, rootSessionId));
      if (read.tag !== "ok") {
        apply(snapshotFailed(stateRef.current, read));
        return { read, again: false };
      }
      const step = snapshotArrived(stateRef.current, read);
      apply(step.state);
      return { read, again: step.read };
    },
  );
  const [sequenced] = useState(() => {
    const reader = createSequencedReader(async () => {
      const { read, again } = await readOnce();
      if (again) void reader();
      return read;
    });
    return reader;
  });
  const readSnapshot = useStableCallback(() => sequenced());

  const onSignal = useStableCallback((next: typeof signal) => {
    if (AsyncResult.isFailure(next)) {
      apply(disconnected(stateRef.current));
      return;
    }
    if (!AsyncResult.isSuccess(next) || next.value.tag === "opened") return;
    const value = next.value;
    if (value.tag === "event") {
      const step = pushArrived(stateRef.current, rootSessionId, value.event);
      apply(step.state);
      if (step.read) void readSnapshot();
    } else if (value.tag === "ended") {
      apply(
        streamEnded(stateRef.current, "The change stream ended; the Backend may have shut down."),
      );
    } else {
      apply(disconnected(stateRef.current));
    }
  });
  const onReconnect = useStableCallback(() => {
    apply(disconnected(stateRef.current));
    apply(reconnected(stateRef.current).state);
    void readSnapshot();
  });
  // A read sent before the session was ready, or whose reply a dropped connection lost, never comes back on its own: a new session re-baselines it.
  useNewSession(environmentId, () => void readSnapshot());

  const started = AsyncResult.isSuccess(signal) || AsyncResult.isFailure(signal);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a timer: the baseline read runs one macrotask after the stream's first element, so it follows the subscribe call the stream makes next
  useEffect(() => {
    if (!started) return;
    const timer = setTimeout(() => void readSnapshot(), 0);
    return () => clearTimeout(timer);
  }, [started, readSnapshot]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listeners on window and document: coming back online or visible re-baselines a view that may have missed pushes
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") onReconnect();
    };
    window.addEventListener("online", onReconnect);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onReconnect);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [onReconnect]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- feeds each element of the Backend's change stream into the goal state, which only a pushed element can change
  useEffect(() => {
    onSignal(signal);
  }, [signal, onSignal]);

  const [rearmAction] = useState(() =>
    createRearm({
      transport,
      environmentId,
      rootSessionId,
      newRequestId: randomUUID,
      readSnapshot: () => readSnapshot(),
    }),
  );
  const [report, setReport] = useState<RearmReport | null>(null);
  const [busy, setBusy] = useState(false);
  const start = useStableCallback(async (goal: GoalView) => {
    // Only a live view offers a Re-arm: the goal the person saw must be the last read, not a stale one.
    if (liveGoal(viewOf(stateRef.current)) === null) return;
    setBusy(true);
    // `.finally` rather than try/finally: React Compiler cannot compile a `try` without a `catch`.
    await rearmAction(goal)
      .then((result) => {
        // A newer action's report is never replaced by an older one's.
        if (result.sent && result.latest) setReport(result);
      })
      .finally(() => setBusy(false));
  });

  return {
    view: viewOf(state),
    rearm: { busy, report, start },
    readSnapshot,
  };
}
