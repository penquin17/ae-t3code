// AETHERIA — the Backend host's own composition (`aetheria-backend`) as data, validated by the same shared validator an Agent host uses.
// The outer manifest.yml carries the same row; the two copies must give the same digest, and a drifting copy is refused by the digest comparison.
// This file holds no digest rule and imports nothing from the pinned archive.
import {
  AGENT_AWARENESS_BACKEND_ID,
  BACKEND_ENTRY_ALLOWLIST,
  agentAwarenessBackendModuleRow,
} from "./agentAwareness.ts";

export const BACKEND_COMPOSITION_ID = "aetheria-backend";

export { BACKEND_ENTRY_ALLOWLIST };

/** The raw schema-v1 manifest the Backend validates: its one module row and its root composition (no Pi pin: the Backend has no Pi). */
export function backendManifest() {
  return {
    schema: 1,
    modules: [agentAwarenessBackendModuleRow()],
    compositions: [
      {
        id: BACKEND_COMPOSITION_ID,
        identity: {
          name: "Aetheria Backend",
          description:
            "The composition T3's server runs as the Aetheria Backend host. Its digest is published beside the server version and compared with the expected Backend digest of the same pinned build.",
          order: 2,
        },
        modules: [AGENT_AWARENESS_BACKEND_ID],
      },
    ],
  };
}
