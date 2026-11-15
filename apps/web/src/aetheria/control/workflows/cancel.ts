// One-click Cancel of a workflow run as one honest outcome (M07 Plan step 29, D4). The click sends `aetheria.workflow.cancel` for exactly the run the person saw, at most once. A lost reply, a throw, a reply
// that does not decode and `WORKFLOWS_OUTCOME_UNKNOWN` are all `unknown`: the runs are read again and nothing is sent again. Success needs a read-back that shows the run ended or its cancel recorded as
// asked for (`cancelRequested`); a read-back that does not show it, or fails, leaves the outcome unknown. A second click on a run while its cancel is in flight sends nothing; other runs are independent.
import { gateOnConnection } from "../../connection/gate";
import {
  createActionRunner,
  type ActionOutcome,
  type OutcomeStep,
  type SendResult,
} from "../../core/outcome";
import { classifyCancel, type RunsRead, type WorkflowRunView } from "./reply";
import { cancelShows } from "./state";
import type { WorkflowsTransport } from "./types";

export type CancelReport =
  /** Nothing was sent: this run's cancel is already in flight. */
  | { readonly sent: false }
  | {
      readonly sent: true;
      readonly requestId: string;
      readonly runId: string;
      readonly name: string;
      readonly outcome: ActionOutcome<WorkflowRunView>;
      /** False when a newer action on this run started before this one settled. */
      readonly latest: boolean;
    };

export interface CancelDeps {
  readonly transport: WorkflowsTransport;
  readonly environmentId: string;
  readonly rootSessionId: string;
  readonly newRequestId: () => string;
  /** One sequenced re-read of the runs, owned by the view: it updates the view and reports what it found. */
  readonly readRuns: () => Promise<RunsRead>;
}

export function createCancel(deps: CancelDeps): (run: WorkflowRunView) => Promise<CancelReport> {
  const { transport, environmentId, rootSessionId } = deps;
  const runner = createActionRunner({ newRequestId: deps.newRequestId });
  const inFlight = new Set<string>();

  return async function cancel(run: WorkflowRunView): Promise<CancelReport> {
    if (inFlight.has(run.runId)) return { sent: false };
    inFlight.add(run.runId);
    try {
      let attempted = false;
      let confirmRead = false;
      const send = async (): Promise<SendResult<WorkflowRunView>> => {
        attempted = true;
        try {
          const reply = classifyCancel(
            await transport.cancel(environmentId, rootSessionId, run.runId),
          );
          switch (reply.tag) {
            case "accepted":
              return { tag: "accepted", value: reply.run };
            case "refused":
              return { tag: "refused", code: reply.code, message: reply.detail ?? "" };
            case "unavailable":
              return { tag: "unavailable", reason: reply.reason };
            case "unknown":
              return { tag: "lost" };
          }
        } catch {
          // A call that threw never told us what the Backend did: it is a lost reply, not a refusal.
          return { tag: "lost" };
        }
      };
      const step: OutcomeStep<WorkflowRunView> = {
        label: "Cancel",
        send,
        // The Backend's own projection decides: a read-back that shows this run ended or with its cancel asked for, or the outcome is unknown.
        confirm: async (accepted) => {
          confirmRead = true;
          const read = await deps.readRuns();
          if (read.tag !== "ok") return { tag: "failed", reason: read.reason };
          return cancelShows(read.runs.find((candidate) => candidate.runId === accepted.runId))
            ? { tag: "shows" }
            : { tag: "absent" };
        },
      };
      // The gate blocks the send while the connection does not allow actions: `attempted` stays false, nothing was sent, and nothing is read back.
      const result = await runner.run(`cancel:${run.runId}`, gateOnConnection(step));
      // Whatever the reply, the view reads again unless the confirming read already did: it never trusts the reply to change it.
      if (attempted && !confirmRead) await deps.readRuns();
      return {
        sent: true,
        requestId: result.requestId,
        runId: run.runId,
        name: run.name,
        outcome: result.outcome,
        latest: result.current,
      };
    } finally {
      inFlight.delete(run.runId);
    }
  };
}
