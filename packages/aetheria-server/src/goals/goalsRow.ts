// AETHERIA M07 Plan step 14 — the Backend `goals-backend` module as data: its ids and its manifest row. No runtime import of the pinned archive, so the composition (composition.ts) and the
// outer digest tests load it as data; the registration is registration.ts and the join to the archive is factory.ts.
import { GOALS_PINNED_ARTIFACT } from "../artifact.ts";

export const GOALS_BACKEND_ID = "goals-backend";
export const GOALS_BACKEND_ENTRY = "aetheria:goals-backend";

/**
 * The manifest row (schema v1, raw) that selects this module on the Backend host. The outer manifest.yml carries the same row; the two copies must give the same digest. `stamp` defaults to the
 * goals archive this build carries, so a row copied from here is never stale. The row requires the two modules whose direct calls it uses, so they start first and drain after it.
 */
export function goalsBackendModuleRow(
  options: { readonly stamp?: string } = {},
): Record<string, unknown> {
  return {
    id: GOALS_BACKEND_ID,
    host: "backend",
    entry: GOALS_BACKEND_ENTRY,
    required: true,
    mutatesToolInput: false,
    requires: { modules: ["human-control-backend", "orchestration-backend"] },
    owns: ["backend-goals-state"],
    compat: {
      artifacts: {
        [GOALS_PINNED_ARTIFACT.package]: { stamp: options.stamp ?? GOALS_PINNED_ARTIFACT.stamp },
      },
    },
    contract: {
      consumer:
        "T3's recovery pass, through the goal-round guard it consults for each main thread; the Agent host's goal tools, through the three XC-6 operations goals.get, goals.create and goals.update; M10's goal view and its Re-arm, through the aetheria.goal.* and aetheria.workflow.* client RPCs, which reach the same goals service.",
      success:
        "One root's goal is a conditional journal under the state root: a person's approved card or client-only re-arm is the only way a goal becomes armed, arming lives in memory only, each round is reserved, admitted once through M05 under one key and counted once, and a restart starts disarmed and sends nothing; the module drains once.",
      failure:
        "A store that cannot be listed refuses the Backend start; a root whose journal is corrupt or unreadable is reported and left exactly as it was, never repaired and never read as empty; without M05's admission, M06's interaction or T3's receipt every dependent step answers unavailable and nothing is resent; a module that is not running answers unavailable.",
      uncertainty:
        "A round whose admission reply was lost stays reserved and its root cannot be re-armed until an explicit later read of M05's key and T3's receipt succeeds. Until that reconcile, and while a cut round's record exists, T3's recovery pass treats the thread as in flight and does not continue it. The round and block limits are unaccepted test values until M12. A person's queued message is not yet read as a pending human. Checked on macOS only; Linux is not run.",
      stateOwner: "backend-goals-state",
    },
  };
}
