// AETHERIA M07 Plan step 22 — the Backend `workflows-backend` module as data: its ids and its manifest row. No runtime import of the pinned archive, so the composition (composition.ts) and the
// outer digest tests load it as data; the registration is registration.ts and the join to the archive is entry.ts.
import { WORKFLOWS_PINNED_ARTIFACT } from "../artifact.ts";

export const WORKFLOWS_BACKEND_ID = "workflows-backend";
export const WORKFLOWS_BACKEND_ENTRY = "aetheria:workflows-backend";

/**
 * The manifest row (schema v1, raw) that selects this module on the Backend host. The outer manifest.yml carries the same row; the two copies must give the same digest. `stamp` defaults to the
 * workflows archive this build carries, so a row copied from here is never stale. The ledger starts no child and no process, so the row requires no other module.
 */
export function workflowsBackendModuleRow(
  options: { readonly stamp?: string } = {},
): Record<string, unknown> {
  return {
    id: WORKFLOWS_BACKEND_ID,
    host: "backend",
    entry: WORKFLOWS_BACKEND_ENTRY,
    required: true,
    mutatesToolInput: false,
    owns: ["backend-workflows-state"],
    compat: {
      artifacts: {
        [WORKFLOWS_PINNED_ARTIFACT.package]: {
          stamp: options.stamp ?? WORKFLOWS_PINNED_ARTIFACT.stamp,
        },
      },
    },
    contract: {
      consumer:
        "The Agent host's workflow controller, through the three XC-6 operations workflows.run-start, workflows.member and workflows.run-end, for a main session whose M03 identity authorizes the workflow tool. No client reads it before M07 step 29.",
      success:
        "A run's record is written under the state root only through the three operations: a run start publishes the run for the verified caller, a member fact is written before the child it names is started and again with its child id, and a run end is the one terminal fact; an identical repeat changes nothing; the module drains once.",
      failure:
        "An argument outside the strict contract, including any session, root or owner field that names another caller, is refused before the ledger is read; a run that is not the caller's answers as one that does not exist; a conflicting or stale fact, a late member of a finished run, and a record that cannot be read or decodes badly are refused and left exactly as they were, never repaired and never read as empty; a module that is not running answers unavailable.",
      uncertainty:
        "A member written before its child whose id never arrived is a diagnostic, not an empty ledger, because the child may or may not exist. The reconcile of runs left running by a stopped Backend is not built before M07 step 28. The ledger holds run facts only; no child state is copied from M05. Checked on macOS only; Linux is not run.",
      stateOwner: "backend-workflows-state",
    },
  };
}
