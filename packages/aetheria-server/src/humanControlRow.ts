// AETHERIA M06 Plan step 6 — the Backend `human-control` module as data: its ids and its manifest row. No runtime import of a pinned archive, so the
// composition (composition.ts) and the outer digest tests can load it as data; the registration that serves the operations is humanControl.ts.
import { INTERACTION_PINNED_ARTIFACT } from "./artifact.ts";

export const HUMAN_CONTROL_BACKEND_ID = "human-control-backend";
export const HUMAN_CONTROL_BACKEND_ENTRY = "aetheria:human-control-backend";

/**
 * The manifest row (schema v1, raw) that selects this module on the Backend host. The outer manifest.yml carries the same row; the two copies
 * must give the same digest. `stamp` defaults to the interaction archive this build carries, so a row copied from here is never stale.
 */
export function humanControlBackendModuleRow(
  options: { readonly stamp?: string } = {},
): Record<string, unknown> {
  return {
    id: HUMAN_CONTROL_BACKEND_ID,
    host: "backend",
    entry: HUMAN_CONTROL_BACKEND_ENTRY,
    required: true,
    mutatesToolInput: false,
    owns: ["backend-interactions-state"],
    compat: {
      artifacts: {
        [INTERACTION_PINNED_ARTIFACT.package]: {
          stamp: options.stamp ?? INTERACTION_PINNED_ARTIFACT.stamp,
        },
      },
    },
    contract: {
      consumer:
        "The Agent host's question and plan tools (M06 scenario stacks until M10; the task and audit tools in the local stack), through the XC-6 operations interaction.create, interaction.await, interaction.release, tasks.publish, plan-mode.get, audit.history and origin.verify; T3's authenticated clients, through the XC-18 client RPCs; the Backend's own late-answer delivery, in process into T3's message dispatch.",
      success:
        "A question is stored before any reply, waited on in segments of at most 5000 ms that never leave an XC-6 pending entry, and settled at most once by an authenticated client session; a late answer reaches the asker's thread as one accepted T3 command; the module drains once, recording every live wait as lost to a host stop.",
      failure:
        "An argument outside the strict contract, including any caller, actor, root or repository field, throws before the service runs and the carrier reports an error; a store that cannot be read or whose declaration is unsupported refuses the Backend start; a module that is not running answers unavailable, never a stale answer.",
      uncertainty:
        "Production exposes create, await, release and the client snapshot and answer actions. The other XC-6 operations (tasks.publish, plan-mode.get, audit.history, origin.verify) and the other client actions answer INTERACTION_UNAVAILABLE until their steps; none answers success it did not produce. An answer whose write may have landed is reported as an unknown outcome, never as a definite non-execution.",
      stateOwner: "backend-interactions-state",
    },
  };
}
