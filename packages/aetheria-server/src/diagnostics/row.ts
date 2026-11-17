// AETHERIA M12 Plan step 8 — the Backend `diagnostics-backend` module as data: its ids and its manifest row. No runtime import of the pinned archive, so the composition (composition.ts) and the outer
// digest tests load it as data; the registration is registration.ts, the store is sink.ts and the join to the archive is entry.ts.
import { DIAGNOSTICS_PINNED_ARTIFACT } from "../artifact.ts";

export const DIAGNOSTICS_BACKEND_ID = "diagnostics-backend";
export const DIAGNOSTICS_BACKEND_ENTRY = "aetheria:diagnostics-backend";

/**
 * The manifest row (schema v1, raw) that selects this module on the Backend host. The outer manifest.yml carries the same row; the two copies must give the same digest. `stamp` defaults to the
 * diagnostics archive this build carries, so a row copied from here is never stale. The module starts no child and no process, so the row requires no other module; it is appended last, so it drains first.
 */
export function diagnosticsBackendModuleRow(
  options: { readonly stamp?: string } = {},
): Record<string, unknown> {
  return {
    id: DIAGNOSTICS_BACKEND_ID,
    host: "backend",
    entry: DIAGNOSTICS_BACKEND_ENTRY,
    required: true,
    mutatesToolInput: false,
    owns: ["backend-diagnostics-state"],
    compat: {
      artifacts: {
        [DIAGNOSTICS_PINNED_ARTIFACT.package]: {
          stamp: options.stamp ?? DIAGNOSTICS_PINNED_ARTIFACT.stamp,
        },
      },
    },
    contract: {
      consumer:
        "The Agent host's diagnostics recorder, through the XC-6 operation diagnostics.append, for events about its own session; a session's own reader, through diagnostics.list and diagnostics.read, for that session's tool, route, error, cancel and refusal list; and the Backend's own channel and lifecycle observation, which records the outcome of every other XC-6 operation without changing it.",
      success:
        "An event is metadata only (the closed field list of the diagnostics archive): it is stored under the state root's aetheria-diagnostics folder by the one writer this module holds, after the archive's builder accepted it, and an append answers stored only when the store confirms the position; a read or list answers only for the carrier-verified session, whose access is still held, and only for sessions it owns; the store declares formatVersion 1; the module flushes and releases its writer once at drain.",
      failure:
        "An argument outside the strict contract, an event with a field the archive does not list or a session, root or host that names another caller, and a read of a session the caller does not own are refused and nothing is stored or returned; a store that cannot be opened, written or read, one of a newer format, and a module that is not running answer unavailable; a recorder fault is shown in health and never aborts, delays or changes the operation it observed.",
      uncertainty:
        "An append whose confirmation disagrees with the store, or whose call threw, is uncertain: it is counted apart from stored and from failed, and health shows the recorder unavailable until a later append is stored. Events are kept locally with no retention limit until the user sets one; nothing is exported. A crash may leave an unfinished last line, which makes the store unusable (refused, never repaired) until the user acts. Events from before a failed append are not re-sent. Checked on macOS only; Linux is not run.",
      stateOwner: "backend-diagnostics-state",
    },
  };
}
