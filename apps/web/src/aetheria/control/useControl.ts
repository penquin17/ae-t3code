// The hooks that wire the pure control logic to T3: the transport over T3's RPC commands, the interactions view (subscribe FIRST, read second), single-value reads, and the seven actions.
// A view keeps no second copy of backend state beyond the last read, marked stale when the connection ends; every change comes from a re-read.
// The hooks are made for a mounted (environment, root): the page keys the panel on both, so they are fixed for a hook's life.
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { randomUUID } from "~/lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { createControlActions, type ControlActions } from "./actions";
import {
  afterRead,
  classifyRead,
  createSequencedReader,
  readView,
  type ReadResult,
  type ReadState,
  type ReadView,
} from "./reads";
import {
  classifySnapshot,
  disconnected,
  initialInteractions,
  pushArrived,
  reconnected,
  snapshotArrived,
  snapshotFailed,
  streamEnded,
  viewOf,
  type InteractionsState,
  type InteractionsView,
  type SnapshotRead,
} from "./resync";
import {
  aetheriaControl,
  environmentIdOf,
  interactionChanges,
  transportResultOf,
} from "./transport";
import type { ControlTransport, PlanMode, TaskView, TransportResult } from "./types";

type CommandName = keyof typeof aetheriaControl;
type Call = (name: CommandName, environmentId: string, input: unknown) => Promise<TransportResult>;

const makeTransport = (call: Call): ControlTransport => ({
  snapshot: (env, rootSessionId) => call("snapshot", env, { rootSessionId }),
  planModeGet: (env, sessionId) => call("planModeGet", env, { sessionId }),
  tasksGet: (env, sessionId) => call("tasksGet", env, { sessionId }),
  answer: (env, p) => call("answer", env, p),
  cancel: (env, p) => call("cancel", env, p),
  hold: (env, p) => call("hold", env, p),
  close: (env, p) => call("close", env, p),
  planDecide: (env, p) => call("planDecide", env, p),
  planModeSet: (env, p) => call("planModeSet", env, p),
  authorizationGrant: (env, p) => call("authorizationGrant", env, p),
});

/** The control transport over T3's commands: one object for the component's life. */
export function useControlTransport(): ControlTransport {
  const options = { reportFailure: false } as const;
  const commands = {
    snapshot: useAtomCommand(aetheriaControl.snapshot, options),
    planModeGet: useAtomCommand(aetheriaControl.planModeGet, options),
    tasksGet: useAtomCommand(aetheriaControl.tasksGet, options),
    answer: useAtomCommand(aetheriaControl.answer, options),
    cancel: useAtomCommand(aetheriaControl.cancel, options),
    hold: useAtomCommand(aetheriaControl.hold, options),
    close: useAtomCommand(aetheriaControl.close, options),
    planDecide: useAtomCommand(aetheriaControl.planDecide, options),
    planModeSet: useAtomCommand(aetheriaControl.planModeSet, options),
    authorizationGrant: useAtomCommand(aetheriaControl.authorizationGrant, options),
  };
  const call = useStableCallback(
    async (name: CommandName, environmentId: string, input: unknown) => {
      const run = commands[name] as unknown as (value: unknown) => Promise<never>;
      return transportResultOf(await run({ environmentId: environmentIdOf(environmentId), input }));
    },
  );
  const [transport] = useState(() => makeTransport(call));
  return transport;
}

export interface InteractionsHandle {
  readonly view: InteractionsView;
  /** One sequenced re-read: it updates the view and reports what it found. */
  readonly readSnapshot: () => Promise<SnapshotRead>;
}

/**
 * Subscribes to the root's change stream FIRST (the atom is read before any effect runs), then reads the snapshot. Pushes only prompt reads; one that lands before the baseline is kept by the
 * pure state. A failed or ended stream marks the value stale or unavailable; the page coming back online or visible re-reads.
 */
export function useInteractions(
  transport: ControlTransport,
  environmentId: string,
  rootSessionId: string,
): InteractionsHandle {
  const signal = useAtomValue(interactionChanges(environmentId, rootSessionId));
  const [state, setState] = useState<InteractionsState>(initialInteractions);
  const stateRef = useRef(state);
  const apply = (next: InteractionsState) => {
    stateRef.current = next;
    setState(next);
  };

  /** One read applied to the state; `again` is true when a push already seen is newer than what it returned. */
  const readOnce = useStableCallback(
    async (): Promise<{ readonly read: SnapshotRead; readonly again: boolean }> => {
      const read = classifySnapshot(
        await transport.snapshot(environmentId, rootSessionId),
        rootSessionId,
      );
      if (read.tag !== "ok") {
        apply(snapshotFailed(stateRef.current, read.reason));
        return { read, again: false };
      }
      const step = snapshotArrived(stateRef.current, read.snapshot);
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- feeds each element of the Backend's change stream into the interactions state, which only a pushed element can change
  useEffect(() => {
    onSignal(signal);
  }, [signal, onSignal]);

  return { view: viewOf(state), readSnapshot };
}

/** A single-value read (plan mode, tasks): read on mount and whenever `trigger` changes, kept as the last value marked stale after a failure. */
function useReadModel<T>(
  read: () => Promise<ReadResult<T>>,
  trigger: unknown,
): { readonly view: ReadView<T>; readonly refresh: () => Promise<void> } {
  const [state, setState] = useState<ReadState<T>>({ status: "waiting" });
  const load = useStableCallback(async (_trigger: unknown) => {
    const result = await read();
    setState((previous) => afterRead(previous, result));
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the Backend's value when mounted and after each interactions version change: the Backend is outside React
  useEffect(() => {
    void load(trigger);
  }, [load, trigger]);
  return { view: readView(state), refresh: () => load(trigger) };
}

export function usePlanMode(
  transport: ControlTransport,
  environmentId: string,
  sessionId: string,
  trigger: unknown,
) {
  return useReadModel<PlanMode>(
    async () => classifyRead<PlanMode>(await transport.planModeGet(environmentId, sessionId)),
    trigger,
  );
}

export function useTasks(
  transport: ControlTransport,
  environmentId: string,
  sessionId: string,
  trigger: unknown,
) {
  return useReadModel<TaskView | null>(
    async () => classifyRead<TaskView | null>(await transport.tasksGet(environmentId, sessionId)),
    trigger,
  );
}

export function useControlActions(
  transport: ControlTransport,
  environmentId: string,
  rootSessionId: string,
  readSnapshot: () => Promise<SnapshotRead>,
): ControlActions {
  const [actions] = useState(() =>
    createControlActions({
      transport,
      environmentId,
      rootSessionId,
      newRequestId: randomUUID,
      readSnapshot: () => readSnapshot(),
    }),
  );
  return actions;
}
