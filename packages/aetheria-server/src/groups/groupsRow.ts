// AETHERIA M10 Plan step 7 — the Backend `groups-backend` module as data: its ids and its manifest row. No runtime import, so the composition (composition.ts) and the outer digest tests load it as
// data; the module that serves the store is groups.ts. The module's code is this fork package's own source, not a packed archive, so its row names no artifact (`compat` is optional).
export const GROUPS_BACKEND_ID = "groups-backend";
export const GROUPS_BACKEND_ENTRY = "aetheria:groups-backend";

/**
 * The manifest row (schema v1, raw) that selects this module on the Backend host. The outer manifest.yml carries the same row; the two copies must give the same digest.
 * It selects no Agent behaviour: the module serves the client's `aetheria.groups.*` methods, so its row declares no XC-6 operation.
 */
export function groupsBackendModuleRow(): Record<string, unknown> {
  return {
    id: GROUPS_BACKEND_ID,
    host: "backend",
    entry: GROUPS_BACKEND_ENTRY,
    required: true,
    mutatesToolInput: false,
    owns: ["backend-groups-state"],
    contract: {
      consumer:
        "T3's authenticated clients, through the client RPCs aetheria.groups.read and aetheria.groups.apply; the Aetheria web sidebar, which shows the groups and names it reads. No Agent host calls it and it registers no XC-6 operation.",
      success:
        "The one session-group record (version 2: links, dismissed pairs, saved names) is read and changed only through this module, one change at a time, each change replacing the whole file in the same folder; a change that alters nothing writes nothing; the module drains once after the change in flight.",
      failure:
        "A request outside the five exact shapes, over 8 KiB of UTF-8 or naming a session the device may not reach is refused before any file is read; a file that cannot be read or is not a valid version-1 or version-2 record is refused and left exactly as it was, never repaired and never read as empty; a module that is not running answers unavailable.",
      uncertainty:
        "A reply lost after a write leaves the outcome unknown: the client re-reads and never resends. The record is read and written by one Backend owner; a second writer to the file is outside this module's guarantee. A group name follows the group that overlaps its saved members most, a rule the client applies; the store only replaces names by overlap. Checked on macOS only; Linux is not run.",
      stateOwner: "backend-groups-state",
    },
  };
}
