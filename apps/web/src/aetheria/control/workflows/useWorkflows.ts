// The workflow runs view's hook (M07 Plan step 29): the one owner of a root's last runs read and of its Cancels. There is no change stream, so it reads once on mount, then on a timer while the page is
// visible, and again on a new session, when the network returns and when the tab becomes visible; reads are sequenced, the newest version wins, and a failed read marks the list stale or unavailable. Cancel is
// sent once per click per run, nothing is edited optimistically, and nothing is sent again after an uncertain reply. The hook is made for a mounted (environment, root): the page keys the provider on both,
// so a reply that lands after a root switch lands in the old, unmounted instance and nowhere else.
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "../../../hooks/useStableCallback";
import { randomUUID } from "~/lib/utils";
import { createSequencedReader } from "../reads";
import { useNewSession } from "../useControl";
import { createCancel, type CancelReport } from "./cancel";
import { classifyRuns, type RunsRead } from "./reply";
import {
  cancelOffered,
  initialWorkflows,
  readArrived,
  readFailed,
  viewOf,
  type WorkflowsState,
  type WorkflowsView,
} from "./state";
import type { WorkflowsTransport } from "./types";

const DEFAULT_POLL_MS = 5000;

export interface CancelControl {
  /** The runs whose Cancel is in flight, from the click until it settled and the runs were read back. */
  readonly busy: ReadonlySet<string>;
  /** Each run's last Cancel report, kept until the next one on that run starts. */
  readonly reports: Readonly<Record<string, CancelReport>>;
  /** Cancels the run as the last live read shows it. Sends nothing for a run that is not offered or is already in flight; resolves when it settled. */
  readonly start: (runId: string) => Promise<void>;
}

export interface WorkflowsHandle {
  readonly view: WorkflowsView;
  readonly cancel: CancelControl;
  /** One sequenced re-read: it updates the view and reports what it found. */
  readonly readRuns: () => Promise<RunsRead>;
}

export function useWorkflows(
  transport: WorkflowsTransport,
  environmentId: string,
  rootSessionId: string,
  pollMs: number = DEFAULT_POLL_MS,
): WorkflowsHandle {
  const [state, setState] = useState<WorkflowsState>(initialWorkflows);
  const stateRef = useRef(state);
  const apply = (next: WorkflowsState) => {
    stateRef.current = next;
    setState(next);
  };

  const readOnce = useStableCallback(async (): Promise<RunsRead> => {
    const read = classifyRuns(await transport.runs(environmentId, rootSessionId));
    apply(
      read.tag === "ok" ? readArrived(stateRef.current, read) : readFailed(stateRef.current, read),
    );
    return read;
  });
  const [readRuns] = useState(() => createSequencedReader(() => readOnce()));
  const read = useStableCallback(() => void readRuns());

  // A read sent before the session was ready, or whose reply a dropped connection lost, never comes back on its own: a new session re-reads.
  useNewSession(environmentId, read);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a timer and listeners on window and document: runs have no change stream, so the first read, a visible-only poll, and coming back online or visible re-read
  useEffect(() => {
    read();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") read();
    }, pollMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") read();
    };
    window.addEventListener("online", read);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", read);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [read, pollMs]);

  const [cancelAction] = useState(() =>
    createCancel({
      transport,
      environmentId,
      rootSessionId,
      newRequestId: randomUUID,
      readRuns: () => readRuns(),
    }),
  );
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [reports, setReports] = useState<Readonly<Record<string, CancelReport>>>({});
  const start = useStableCallback(async (runId: string) => {
    const current = stateRef.current;
    const run = current.held?.runs.find((candidate) => candidate.runId === runId);
    // Only a live list offers a Cancel: the run the person saw must be the last read, not a stale one.
    if (run === undefined || !cancelOffered(viewOf(current), run)) return;
    setBusy((held) => new Set(held).add(runId));
    // `.finally` rather than try/finally: React Compiler cannot compile a `try` without a `catch`.
    await cancelAction(run)
      .then((result) => {
        // A newer action's report is never replaced by an older one's.
        if (result.sent && result.latest) setReports((held) => ({ ...held, [runId]: result }));
      })
      .finally(() =>
        setBusy((held) => {
          const next = new Set(held);
          next.delete(runId);
          return next;
        }),
      );
  });

  return { view: viewOf(state), cancel: { busy, reports, start }, readRuns };
}
