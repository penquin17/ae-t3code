// AETHERIA — the Backend host's own composition (`aetheria-backend`) as data, validated by the same shared validator an Agent host uses.
// The outer manifest.yml carries the same rows; the two copies must give the same digest, and a drifting copy is refused by the digest comparison.
// This file holds no digest rule and imports nothing from the pinned archives.
import {
  AGENT_AWARENESS_BACKEND_ENTRY,
  AGENT_AWARENESS_BACKEND_ID,
  agentAwarenessBackendModuleRow,
} from "./agentAwareness.ts";
import { BACKEND_COMPOSITION_ID } from "./compositionId.ts";
import {
  PROVIDERS_BACKEND_ENTRY,
  PROVIDERS_BACKEND_ID,
  providersBackendModuleRow,
} from "./providersRow.ts";

export { BACKEND_COMPOSITION_ID };

/** The build-time allowlist of Backend module entries. A registration or manifest entry outside it is refused. */
export const BACKEND_ENTRY_ALLOWLIST: readonly string[] = Object.freeze([
  AGENT_AWARENESS_BACKEND_ENTRY,
  PROVIDERS_BACKEND_ENTRY,
]);

/**
 * The raw schema-v1 manifest the Backend validates: its module rows and its root composition (no Pi pin: the Backend has no Pi).
 * `composition` names another composition built from the SAME rows, for a scripted test composition; the default is the production one.
 */
export function backendManifest(options: { readonly composition?: string } = {}) {
  return {
    schema: 1,
    modules: [agentAwarenessBackendModuleRow(), providersBackendModuleRow()],
    compositions: [
      {
        id: options.composition ?? BACKEND_COMPOSITION_ID,
        identity: {
          name: "Aetheria Backend",
          description:
            "The composition T3's server runs as the Aetheria Backend host. Its digest is published beside the server version and compared with the expected Backend digest of the same pinned build.",
          order: 2,
        },
        modules: [AGENT_AWARENESS_BACKEND_ID, PROVIDERS_BACKEND_ID],
      },
    ],
  };
}
