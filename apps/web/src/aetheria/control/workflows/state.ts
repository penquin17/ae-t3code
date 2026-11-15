// The workflow runs of one root, from polled reads (M07 Plan step 29). Plain TypeScript. There is no change stream for runs, so the view reads on a timer while it is mounted and visible, and again when a new
// session, the network or the tab's visibility returns. The newest version wins: a read behind the one held is dropped. A failed read is never "no runs": unavailable and unknown keep the last list stale, and a
// refusal shows no runs at all. `unreadable` counts records the Backend could not read: they may belong to this root, so a list with any is never called complete.
import type { FailureKind, RunsRead, WorkflowRunView } from "./reply";

export interface WorkflowsFailure {
  readonly kind: FailureKind;
  readonly reason: string;
  readonly code?: string;
}

export interface HeldRuns {
  readonly version: number;
  readonly runs: readonly WorkflowRunView[];
  readonly unreadable: number;
}

export interface WorkflowsState {
  readonly held: HeldRuns | null;
  /** Why the last read failed, until a read succeeds. */
  readonly failure: WorkflowsFailure | null;
}

export type WorkflowsView =
  | { readonly status: "waiting"; readonly reason: string }
  | ({ readonly status: "live" } & HeldRuns)
  | ({ readonly status: "stale"; readonly reason: string } & HeldRuns)
  /** Nothing was read: the Backend could not take the request, or what happened is not known. */
  | {
      readonly status: "unavailable";
      readonly kind: "unavailable" | "unknown";
      readonly reason: string;
    }
  /** The Backend refused the read (no scope, revoked device, unknown root): no runs are shown. */
  | { readonly status: "refused"; readonly code: string; readonly reason: string };

export const initialWorkflows = (): WorkflowsState => ({ held: null, failure: null });

/** A successful read. One behind the version held is dropped whole (the state is returned as it was); an equal or newer one replaces the list and clears the failure. */
export function readArrived(
  state: WorkflowsState,
  read: Extract<RunsRead, { tag: "ok" }>,
): WorkflowsState {
  if (state.held !== null && read.version < state.held.version) return state;

  return {
    held: { version: read.version, runs: read.runs, unreadable: read.unreadable },
    failure: null,
  };
}

export const readFailed = (
  state: WorkflowsState,
  failure: Extract<RunsRead, { tag: "failed" }>,
): WorkflowsState => ({
  ...state,
  failure: {
    kind: failure.kind,
    reason: failure.reason,
    ...(failure.code === undefined ? {} : { code: failure.code }),
  },
});

export function viewOf(state: WorkflowsState): WorkflowsView {
  const { failure, held } = state;
  // A refusal ends what this client may show of the runs: the last list is not kept.
  if (failure !== null && failure.kind === "refused") {
    return { status: "refused", code: failure.code ?? "REFUSED", reason: failure.reason };
  }
  if (held === null) {
    return failure === null
      ? { status: "waiting", reason: "waiting for the Backend's first read" }
      : {
          status: "unavailable",
          kind: failure.kind === "unknown" ? "unknown" : "unavailable",
          reason: failure.reason,
        };
  }
  if (failure !== null) return { status: "stale", reason: failure.reason, ...held };
  return { status: "live", ...held };
}

/** A run the person may cancel: only on a live list, still running, with no cancel asked for. A stale, waiting, unavailable or refused view offers none. */
export const cancelOffered = (view: WorkflowsView, run: WorkflowRunView): boolean =>
  view.status === "live" && run.state === "running" && run.cancelRequested !== true;

/** What the Backend must show for a cancel to count as seen: the run ended, or its cancel is recorded as asked for. */
export const cancelShows = (run: WorkflowRunView | undefined): boolean =>
  run !== undefined && (run.state !== "running" || run.cancelRequested === true);
