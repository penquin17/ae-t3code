// AETHERIA M10 Plan step 13 — the Backend `deliverables-backend` module as data: its ids and its manifest row. No runtime import, so the composition (composition.ts) and the outer digest tests load
// it as data; the module that serves the store is deliverables.ts. The module's code is this fork package's own source, not a packed archive, so its row names no artifact (`compat` is optional).
export const DELIVERABLES_BACKEND_ID = "deliverables-backend";
export const DELIVERABLES_BACKEND_ENTRY = "aetheria:deliverables-backend";

/**
 * The manifest row (schema v1, raw) that selects this module on the Backend host. The outer manifest.yml carries the same row; the two copies must give the same digest.
 * It serves the Agent host's `present` tool over two XC-6 operations and, in process, the client reads and the authorised download route of M10 steps 14 and 16.
 */
export function deliverablesBackendModuleRow(): Record<string, unknown> {
  return {
    id: DELIVERABLES_BACKEND_ID,
    host: "backend",
    entry: DELIVERABLES_BACKEND_ENTRY,
    required: true,
    mutatesToolInput: false,
    owns: ["backend-deliverables-state"],
    contract: {
      consumer:
        "The Agent host's present tool (M10), through the XC-6 operations deliverables.declare and deliverables.attach-snapshot, after attachments.store-snapshot; T3's authenticated clients, through the client reads and the download route that read this store in process. No client or Agent host writes it any other way.",
      success:
        "A declaration is recorded only for the carrier-verified session, in the one run that is active for it, after the file is shown to be a regular, readable file inside that session's working folder and its digest is computed; its as-delivered snapshot settles once, only for a snapshot this Backend's own store opens for that session with the declared digest; a retry of either call with the same request or declaration id writes nothing; every change replaces the whole store file in its folder; the module drains once after the change in flight.",
      failure:
        "An argument outside the strict contract, including any session, root, turn, kind, digest or actor field, throws before the store is read; a missing, irregular, linked, unreadable or outside file, an unknown turn, a conflicting request id and a snapshot that does not match are refused with a code and leave the store as it was; a store file that cannot be read, is corrupt or is of a newer format is refused on every call and left exactly as it was, never repaired and never read as empty; a module that is not running answers unavailable.",
      uncertainty:
        "A reply lost after a write leaves the outcome unknown to the caller, which repeats the same call and is told the record exists. The store is read and written by one Backend owner; a second writer to the file is outside this module's guarantee. A file may change between the declaration and a later read; the record holds the digest at declaration and says nothing about the file now. The turn is the one run T3's projection shows active when the call arrives. Checked on macOS only; Linux is not run.",
      stateOwner: "backend-deliverables-state",
    },
  };
}
