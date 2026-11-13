// The children view's behaviour (M10 Plan step 10, R1, D4): one owner for the last list read of a root, a per-child Stop that sends exactly one interrupt-or-close, and reads of stored reports.
// Nothing is edited optimistically, a lost reply is `unknown` and is not resent, a stale reply lands nowhere, and leaving the page cancels nothing.
import { useAtomMount, useAtomSubscribe } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { environmentCatalog } from "~/connection/catalog";
import { useStableCallback } from "../../hooks/useStableCallback";
import { randomUUID } from "~/lib/utils";
import { createActionRunner, type ActionOutcome, type SendResult } from "../core/outcome";
import { childStopSend } from "../run/childStop";
import type { ChildrenCalls } from "./calls";
import {
  finishRead,
  initialListState,
  listViewFromSend,
  startRead,
  stopWithReadBack,
  type ChildRowView,
  type ListState,
  type ListView,
} from "./model";
import {
  finishReport,
  initialReports,
  reportViewFromReply,
  reportViewOf,
  startReport,
  type ReportsState,
  type ReportsTransport,
  type ReportView,
} from "./reports";

export interface StopNotice {
  readonly rootThreadId: string;
  readonly childId: string;
  readonly name: string;
  readonly outcome: ActionOutcome<unknown>;
}

const settled = async (send: () => Promise<SendResult<unknown>>): Promise<SendResult<unknown>> => {
  try {
    return await send();
  } catch {
    // A call that threw never told us what the Backend did: it is a lost reply, not a refusal.
    return { tag: "lost" };
  }
};

export function useChildren(input: {
  readonly environmentId: EnvironmentId;
  readonly rootThreadId: string;
  readonly calls: ChildrenCalls;
}) {
  const { environmentId, rootThreadId, calls } = input;
  const root = useRef(rootThreadId);
  const owner = useRef<ListState>(initialListState(rootThreadId));
  const [state, setState] = useState<ListState>(() => initialListState(rootThreadId));
  const [notice, setNotice] = useState<StopNotice | null>(null);
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [runner] = useState(() => createActionRunner({ newRequestId: randomUUID }));
  const inFlight = useRef(new Set<string>());

  async function read(forRoot: string): Promise<ListView> {
    const started = startRead(owner.current, forRoot);
    owner.current = started.state;
    setState(started.state);
    const view = listViewFromSend(
      await settled(() => calls.list({ environmentId, rootThreadId: forRoot })),
    );
    owner.current = finishRead(owner.current, started.ticket, forRoot, view);
    setState(owner.current);
    return view;
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the root's children from the Backend when the root or environment changes
  useEffect(() => {
    root.current = rootThreadId;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `read` is rebuilt every render and closes over these two values; the read starts only when they change
    void read(rootThreadId);
  }, [environmentId, rootThreadId]);

  // A list read sent before the session is ready, or whose reply a dropped connection lost, is not retried by anything else: read it again once a new session is up (the signal T3's directory reads
  // follow). It fires on a change, once per new session, so a read that fails again does not loop.
  const sessionGeneration = environmentCatalog.sessionGenerationAtom(environmentId);
  // A listener alone does not compute the atom, so nothing would follow the connection.
  useAtomMount(sessionGeneration);
  useAtomSubscribe(
    sessionGeneration,
    useStableCallback(() => void read(root.current)),
  );

  /** One Stop: the existing per-child decision (`run/childStop.ts`) sends a single interrupt or close; the list is then re-read, which is a read and never a resend. */
  async function stop(row: ChildRowView): Promise<void> {
    const forRoot = rootThreadId;
    const key = `${environmentId}\u0000${forRoot}\u0000${row.childId}`;
    if (row.state === "closed" || inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setStopping(new Set(inFlight.current));
    // `.finally` rather than try/finally: React Compiler cannot compile a `try` without a `catch`.
    await runStop(forRoot, key, row).finally(() => {
      inFlight.current.delete(key);
      setStopping(new Set(inFlight.current));
    });
  }

  async function runStop(forRoot: string, key: string, row: ChildRowView): Promise<void> {
    const target = { environmentId, rootThreadId: forRoot, childThreadId: row.childId };
    const run = await runner.run(key, {
      label: "Stop",
      send: () =>
        childStopSend(
          {
            list: () => settled(() => calls.list({ environmentId, rootThreadId: forRoot })),
            interrupt: () => settled(() => calls.interrupt(target)),
            close: () => settled(() => calls.close(target)),
          },
          { rootThreadId: forRoot, childThreadId: row.childId },
        ),
    });
    // The page may have moved to another root while the Stop was away: its re-read and notice belong to the root it was sent for.
    if (root.current !== forRoot) return;
    const readBack = await read(forRoot);
    if (!run.current || root.current !== forRoot) return;
    setNotice({
      rootThreadId: forRoot,
      childId: row.childId,
      name: row.name,
      outcome: stopWithReadBack(run.outcome, row.childId, row.mode, readBack),
    });
  }

  const visible: ListState =
    state.rootThreadId === rootThreadId
      ? state
      : { rootThreadId, ticket: 0, refreshing: true, view: { tag: "reading" } };
  const visibleNotice = notice !== null && notice.rootThreadId === rootThreadId ? notice : null;
  const isStopping = (childId: string) =>
    stopping.has(`${environmentId}\u0000${rootThreadId}\u0000${childId}`);

  return {
    list: visible,
    notice: visibleNotice,
    refresh: () => void read(rootThreadId),
    stop: (row: ChildRowView) => void stop(row),
    isStopping,
  };
}

/** Reads of stored reports, one per (root, child); the only copy of an answer is the one in this state. */
export function useReports(rootThreadId: string, transport: ReportsTransport) {
  const owner = useRef<ReportsState>(initialReports);
  const [state, setState] = useState<ReportsState>(initialReports);

  async function read(target: string): Promise<void> {
    const started = startReport(owner.current, rootThreadId, target);
    owner.current = started.state;
    setState(started.state);
    let view: ReportView;
    try {
      view = reportViewFromReply(await transport.read({ rootThreadId, target }));
    } catch (error) {
      const why = error instanceof Error && error.message !== "" ? error.message : String(error);
      view = { tag: "unreadable", reason: `the read failed before an answer (${why})` };
    }
    owner.current = finishReport(owner.current, rootThreadId, target, started.ticket, view);
    setState(owner.current);
  }

  return {
    viewOf: (target: string) => reportViewOf(state, rootThreadId, target),
    read: (target: string) => void read(target),
  };
}
