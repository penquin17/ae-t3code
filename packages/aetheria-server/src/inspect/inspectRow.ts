// AETHERIA M11 Plan step 7 — the Backend `inspect-backend` module as data: its ids and its manifest row. No runtime import, so the composition (composition.ts) and the outer digest tests load
// it as data; the operations that serve it are a later step. The row names no artifact yet: the `@aetheria/inspect` stamp is added to this row and to the outer manifest row at once when that archive is packed.
export const INSPECT_BACKEND_ID = "inspect-backend";
export const INSPECT_BACKEND_ENTRY = "aetheria:inspect-backend";

/**
 * The manifest row (schema v1, raw) that selects this module on the Backend host. The outer manifest.yml carries the same row; the two copies must give the same digest.
 * It serves the Agent host's inspect tools over two XC-6 operations, inspect.list and inspect.query, and declares the deployment's one XC-4 value policy, `showValues`.
 */
export function inspectBackendModuleRow(): Record<string, unknown> {
  return {
    id: INSPECT_BACKEND_ID,
    host: "backend",
    entry: INSPECT_BACKEND_ENTRY,
    required: true,
    mutatesToolInput: false,
    provides: {
      services: [
        "inspect.backend-services",
        "inspect.client-regions",
        "inspect.compositions",
        "inspect.config",
        "inspect.modules",
      ],
    },
    owns: ["backend-inspect-state"],
    config: {
      fields: { showValues: { type: "string-list", required: false, secret: false } },
      values: { showValues: [] },
    },
    contract: {
      consumer:
        "The Agent host's inspect tools, through the XC-6 operations inspect.list and inspect.query, for a caller whose M03 identity is available and whose authority allows the tool asked about.",
      success:
        "An authorized call is answered once, held to the Backend's single deadline, as done with an outcome; every answer is projected by the one projector, bounded by the page and result caps, and shows a configuration value only for a module.field pair the deployment lists in showValues whose field is not secret; the module lists itself and every other module with honest states.",
      failure:
        "An unknown operation or selector that could write, call or invoke is refused as INSPECT_READONLY; an identity M03 does not authorize is refused with M03's code before any provider runs; with inspect.enabled off both operations answer unavailable and no provider is queried; a provider that fails or answers with anything but plain data is unavailable or refused, never a partial success; no inspect call answers pending.",
      uncertainty:
        "Authorization applies spawn authorization's main-session rule, so a Builder main session cannot be told from an Aetheria one here; Builder-only is enforced by the Agent's tools. A client query reaches only pages viewing the caller's thread, and another signed-in viewer of that thread can be asked. Shapes only by default, so values stay off while showValues is empty. Checked on macOS only; Linux is not run.",
      stateOwner: "backend-inspect-state",
    },
  };
}
