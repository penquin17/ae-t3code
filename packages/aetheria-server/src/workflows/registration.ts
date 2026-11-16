// @effect-diagnostics globalDate:off globalTimers:off - The run service's clock and bounded drain poll use host APIs outside an Effect runtime.
/* oxlint-disable t3code/no-low-value-comments -- The header states the authority boundary of the run-record operations and the one state this file owns. */
// AETHERIA M07 Plan step 22 — the Backend `workflows-backend` registration: ONE workflow ledger under `<stateRoot>/workflows/`, served through exactly the three strict, data-only XC-6 operations
// `workflows.run-start`, `workflows.member` and `workflows.run-end` (the archive's names and codecs). The module starts no script, no child and no process: the Agent host's controller does, and M05 keeps
// every child's state. The caller is the verified carrier session (`context.sessionId`, `rootSessionId`, `kind`), never an argument; only a main session writes a record, and M03's verdict on the
// `workflow` tool is asked for a run start only (later calls are checked against the record's owner).
//
// One state belongs to this file and nowhere else: the RUNNING ledger, present only between start and drain. While it is absent every operation answers `unavailable` (the adapter also gates them on the
// module's own state): nothing is recorded and no caller may read that as a start. Writes are guarded by the Backend's owner lock through `assertHeld`, so a write after drain or without the lock fails closed.
import type { Xc6Operation, Xc6OperationContext } from "@t3tools/aetheria-contracts";

import type { BackendRegistration } from "../adapter.ts";
import {
  WORKFLOW_OPERATIONS,
  createWorkflowOperations,
  createWorkflowRuns,
  openWorkflowLedger,
  type ReconcileReport,
  type RunsPorts,
  type WorkflowLedger,
  type WorkflowRunAuthorization,
  type WorkflowRuns,
} from "./entry.ts";
import { WORKFLOWS_BACKEND_ENTRY } from "./row.ts";

export interface WorkflowsRegistrationOptions {
  /** The Backend's state root. Absent: the module runs unconfigured (digest only), no ledger exists and every operation answers unavailable. */
  readonly stateRoot?: string | undefined;
  /**
   * M03's verdict on starting a workflow for a verified session. Absent: every run start answers unavailable (the verdict is never guessed). A throw is read as the identity being unavailable.
   */
  readonly authorize?:
    | ((input: {
        readonly sessionId: string;
        readonly rootSessionId: string;
      }) => Promise<WorkflowRunAuthorization>)
    | undefined;
  /** Throws unless the Backend's owner lock is held; the ledger asks before every write. Absent: no owner check (a test seam). */
  readonly assertHeld?: (() => void) | undefined;
  /**
   * M05's jobs and children as the run service needs them (ports.ts). Absent: no run service exists, so the runs view and cancel answer unavailable and the boot reconcile cannot run (a configured
   * state root with no ports is reported as unreconciled, never as clean).
   */
  readonly ports?: RunsPorts | undefined;
  /** The clock for `cancelRequestedAt` and `lost`. Default: the system clock. */
  readonly now?: (() => string) | undefined;
  /** Whole workflow cancel-and-join bound at Backend shutdown. Default 5000 ms. */
  readonly drainBoundMs?: number | undefined;
  /** Poll interval while waiting for the Agent to publish a terminal run fact. Default 20 ms. */
  readonly drainPollMs?: number | undefined;
}

export type WorkflowsBackendRegistration = BackendRegistration & {
  /** The running ledger, or undefined before start and after drain (a caller then answers unavailable, never "no run"). */
  readonly ledger: () => WorkflowLedger | undefined;
  /** The running run service (list, cancel), or undefined before start, after drain, and when no ports were supplied. */
  readonly runs: () => WorkflowRuns | undefined;
  /** What the last boot reconcile found; undefined before start or when it could not run. A report with `unresolved` or `unreadable` entries is a debt, never "clean". */
  readonly reconcileReport: () => ReconcileReport | undefined;
};

export function createWorkflowsBackendRegistration(
  options: WorkflowsRegistrationOptions,
): WorkflowsBackendRegistration {
  let running: WorkflowLedger | undefined;
  let service: WorkflowRuns | undefined;
  let lastReport: ReconcileReport | undefined;

  const operations = createWorkflowOperations({
    ledger: () => running,
    authorize: async (context) =>
      options.authorize === undefined
        ? { ok: false, code: "AUTH_IDENTITY_UNAVAILABLE", reason: "no workflow authorizer" }
        : options.authorize({ sessionId: context.sessionId, rootSessionId: context.rootSessionId }),
  });

  const served: Record<string, Xc6Operation> = {};
  for (const name of WORKFLOW_OPERATIONS) {
    const run = operations[name];
    served[name] = (context: Xc6OperationContext) =>
      run({
        sessionId: context.sessionId,
        rootSessionId: context.rootSessionId,
        kind: context.kind,
        args: context.args,
      });
  }

  return {
    entry: WORKFLOWS_BACKEND_ENTRY,
    operations: Object.freeze(served),
    activation: {
      start: async () => {
        if (options.stateRoot === undefined) return;
        const ledger = openWorkflowLedger({
          stateRoot: options.stateRoot,
          ...(options.assertHeld === undefined ? {} : { assertHeld: options.assertHeld }),
        });
        const started = ledger.start();
        if (started.status !== "ok")
          throw new Error(`the workflow ledger did not start: ${started.detail}`);
        if (options.ports !== undefined) {
          const runs = createWorkflowRuns({
            ledger: () => ledger,
            ports: options.ports,
            now: options.now ?? (() => new Date().toISOString()),
            drainWait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
            ...(options.drainBoundMs === undefined ? {} : { drainBoundMs: options.drainBoundMs }),
            ...(options.drainPollMs === undefined ? {} : { drainPollMs: options.drainPollMs }),
          });
          // Before any update or start is accepted: a run left `running` by a stopped Backend becomes `lost` and its children are closed. A failure here is a recorded debt, never a refusal to
          // start the module and never a clean claim.
          try {
            lastReport = await runs.reconcile();
          } catch {
            lastReport = undefined;
          }
          service = runs;
        }
        running = ledger;
      },
      drain: async () => {
        const stopped = running === undefined ? [] : ["backend-workflows.ledger"];
        // Admission first: nothing new is accepted, then every cancel in flight is joined, and only then does the ledger go.
        running = undefined;
        const draining = service;
        service = undefined;
        let stillLive: readonly string[] = [];
        if (draining !== undefined) {
          const report = await draining.drain();
          if (report.joined > 0) stopped.push(`backend-workflows.cancels:${report.joined}`);
          stopped.push(...report.ended.map((runId) => `backend-workflows.run:${runId}`));
          stillLive = report.stillLive;
        }
        return { released: [], stopped, transferred: [], stillLive: [...stillLive] };
      },
    },
    ledger: () => running,
    runs: () => service,
    reconcileReport: () => lastReport,
  };
}
