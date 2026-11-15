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
  openWorkflowLedger,
  type WorkflowLedger,
  type WorkflowRunAuthorization,
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
}

export type WorkflowsBackendRegistration = BackendRegistration & {
  /** The running ledger, or undefined before start and after drain (a caller then answers unavailable, never "no run"). */
  readonly ledger: () => WorkflowLedger | undefined;
};

export function createWorkflowsBackendRegistration(
  options: WorkflowsRegistrationOptions,
): WorkflowsBackendRegistration {
  let running: WorkflowLedger | undefined;

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
        running = ledger;
      },
      drain: async () => {
        const stopped = running === undefined ? [] : ["backend-workflows.ledger"];
        running = undefined;
        return { released: [], stopped, transferred: [], stillLive: [] };
      },
    },
    ledger: () => running,
  };
}
