// @effect-diagnostics globalDate:off globalTimers:off - The run service's clock and bounded drain poll use host APIs outside an Effect runtime.
/* oxlint-disable t3code/no-low-value-comments -- The header states the authority boundary of the run-record operations and the one state this file owns. */
// AETHERIA M07 Plan step 22 — the Backend `workflows-backend` registration: ONE workflow ledger under `<stateRoot>/workflows/`, served through exactly the three strict, data-only XC-6 operations
// `workflows.run-start`, `workflows.member` and `workflows.run-end` (the archive's names and codecs). The module starts no script, no child and no process: the Agent host's controller does, and M05 keeps
// every child's state. The caller is the verified carrier session (`context.sessionId`, `rootSessionId`, `kind`), never an argument; only a main session writes a record, and M03's verdict on the
// `workflow` tool is asked for a run start only (later calls are checked against the record's owner).
//
// Two states belong to this file and nowhere else: the RUNNING ledger, present from start until the drain's wait ends, and DRAINING, true from the first step of a drain. While the ledger is absent every
// operation answers `unavailable` (the adapter also gates them on the module's own state): nothing is recorded and no caller may read that as a start. While draining, a run start and a new member
// answer `unavailable` (`WORKFLOWS_DRAINING`), but `workflows.run-end` and the settlement of a member the ledger already holds still reach the ledger: the drain waits for the terminal record the Agent
// publishes through that operation (D23, Plan step 28), so the ledger is cleared only after the wait. Writes are guarded by the Backend's owner lock through `assertHeld`, so a write after drain or
// without the lock fails closed.
import type { Xc6Operation, Xc6OperationContext } from "@t3tools/aetheria-contracts";

import type { BackendRegistration } from "../adapter.ts";
import {
  WORKFLOW_OPERATIONS,
  createWorkflowOperations,
  createWorkflowRuns,
  openWorkflowLedger,
  type ReconcileReport,
  type RunsPorts,
  type WorkflowAnswer,
  type WorkflowLedger,
  type WorkflowRunAuthorization,
  type WorkflowRuns,
} from "./entry.ts";
import { WORKFLOWS_BACKEND_ENTRY } from "./row.ts";

/** The code of an answer to a run start or a new member that arrives while the module drains. */
const DRAINING = "WORKFLOWS_DRAINING";

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
  /** The running ledger (still present while a drain waits for terminal records), or undefined before start and after the drain (a caller then answers unavailable, never "no run"). */
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
  // True from the first step of a drain until its wait ends (then the ledger is gone). The ledger stays present while it is true, so the Agent's terminal `run-end` (and the settlement of an existing member) can still
  // be written and the drain's wait can see it; only new work is refused.
  let draining = false;

  const operations = createWorkflowOperations({
    ledger: () => running,
    authorize: async (context) => {
      if (draining) return { ok: false, code: DRAINING };
      if (options.authorize === undefined)
        return { ok: false, code: "AUTH_IDENTITY_UNAVAILABLE", reason: "no workflow authorizer" };
      const verdict = await options.authorize({
        sessionId: context.sessionId,
        rootSessionId: context.rootSessionId,
      });
      // A drain may have begun, or even ended, while M03 was asked (the operation took its ledger before): the run is not recorded then.
      return draining || running === undefined ? { ok: false, code: DRAINING } : verdict;
    },
  });

  /** Does the ledger already hold this member of this run? Only that member's settlement is old work; anything else is a new member. */
  const holdsMember = (args: Readonly<Record<string, unknown>>): boolean => {
    const { runId, seq } = args;
    if (typeof runId !== "string" || typeof seq !== "number") return false;
    const read = running?.read(runId);
    return (
      read?.ok === true && read.value !== null && read.value.members.some((m) => m.seq === seq)
    );
  };

  const unavailableWhileDraining: WorkflowAnswer = { status: "unavailable", code: DRAINING };
  const served: Record<string, Xc6Operation> = {};
  for (const name of WORKFLOW_OPERATIONS) {
    const run = operations[name];
    served[name] = async (context: Xc6OperationContext) => {
      // While draining: no new run and no new member; `run-end` and an existing member's settlement go on, because the drain waits for the Agent's terminal fact.
      if (
        draining &&
        (name === "workflows.run-start" ||
          (name === "workflows.member" && !holdsMember(context.args)))
      )
        return unavailableWhileDraining;
      const answer = await run({
        sessionId: context.sessionId,
        rootSessionId: context.rootSessionId,
        kind: context.kind,
        args: context.args,
      });
      // The authorizer's drain refusal is the module's, not M03's verdict.
      return answer.status === "refused" && answer.code === DRAINING
        ? unavailableWhileDraining
        : answer;
    };
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
        // Admission first: no new run, no new member and no new cancel is accepted. The ledger stays, because the drain waits for each run's terminal record, which the Agent publishes through
        // `workflows.run-end`; it goes only after the run service's drain (bounded) returns, even if that throws.
        draining = true;
        const stopping = service;
        service = undefined;
        let stillLive: readonly string[] = [];
        try {
          if (stopping !== undefined) {
            const report = await stopping.drain();
            if (report.joined > 0) stopped.push(`backend-workflows.cancels:${report.joined}`);
            stopped.push(...report.ended.map((runId) => `backend-workflows.run:${runId}`));
            stillLive = report.stillLive;
          }
        } finally {
          running = undefined;
          // The absent ledger now answers every operation `unavailable`; the draining state has done its work.
          draining = false;
        }
        return { released: [], stopped, transferred: [], stillLive: [...stillLive] };
      },
    },
    ledger: () => running,
    runs: () => service,
    reconcileReport: () => lastReport,
  };
}
