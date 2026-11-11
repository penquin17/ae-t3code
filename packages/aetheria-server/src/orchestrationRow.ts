// AETHERIA M05 steps 6 and 9: the Backend `orchestration` module as data (ids and manifest row); the registration is orchestration.ts.
// The row names the fifth archive (`@aetheria/orchestration`) this build carries, as humanControlRow.ts names the interaction archive.
import { ORCHESTRATION_PINNED_ARTIFACT } from "./artifact.ts";

export const ORCHESTRATION_BACKEND_ID = "orchestration-backend";
export const ORCHESTRATION_BACKEND_ENTRY = "aetheria:orchestration-backend";

/**
 * The manifest row (schema v1, raw) that selects this module on the Backend host. The outer manifest.yml carries the same row; the two copies must give
 * the same digest. `stamp` defaults to the orchestration archive this build carries, so a row copied from here is never stale.
 */
export function orchestrationBackendModuleRow(
  options: { readonly stamp?: string } = {},
): Record<string, unknown> {
  return {
    id: ORCHESTRATION_BACKEND_ID,
    host: "backend",
    entry: ORCHESTRATION_BACKEND_ENTRY,
    required: true,
    mutatesToolInput: false,
    owns: ["backend-orchestration-state"],
    compat: {
      artifacts: {
        [ORCHESTRATION_PINNED_ARTIFACT.package]: {
          stamp: options.stamp ?? ORCHESTRATION_PINNED_ARTIFACT.stamp,
        },
      },
    },
    contract: {
      consumer:
        "The Agent host's managed-work tools (role and generic spawn, fork, message, list, interrupt, close, report and job tools), through the XC-6 operations children.spawn, children.fork, children.message, children.list, children.interrupt, children.close, children.await-report, children.status, children.cancel, jobs.output, jobs.list, jobs.kill and jobs.cancel; the shell runner, through the data-only lifecycle operations jobs.reserve, jobs.attach, jobs.adopted and jobs.exited; the coordination board, through the owned-child status (XC-10); M07 and M10, through the Backend's direct calls.",
      success:
        "An authorized caller's spawn creates a child whose first turn is held until its identity is active, then released once; the child's completion reaches its parent through T3's own delegated delivery; operations answer only while the module runs and the module drains once.",
      failure:
        "An argument outside the strict contract, including any caller, session, root, parent, authority or thread field, throws before the service runs and the carrier reports an error; an identity M03 does not authorize is refused with M03's code; a module whose service is not running, or whose reply is lost, answers unavailable, never success.",
      uncertainty:
        "Until the children service is injected the module answers unavailable for every operation. Child state that cannot be read is unknown, never idle or absent; a failed rollback names the leftover thread and leaves it without authority. The admission, wait and retention parameters are unaccepted test values until M12. Checked on macOS only; Linux is not run.",
      stateOwner: "backend-orchestration-state",
    },
  };
}
