// AETHERIA M04 Plan step 15 (B5) — prepare the Backend over its own composition. The assembly step 16 provides at the server layer graph calls this.
import { prepareBackend, type BackendFacts, type PrepareResult } from "./adapter.ts";
import { createAgentAwarenessBackendRegistration } from "./agentAwareness.ts";
import type { BackendRegistration } from "./adapter.ts";
import { BACKEND_COMPOSITION_ID, BACKEND_ENTRY_ALLOWLIST, backendManifest } from "./composition.ts";

export interface AetheriaBackendOptions {
  /** Default: the fork's own `backendManifest()`. A test may pass another to prove it is refused. */
  readonly manifest?: unknown;
  /** Default: the agent-awareness registration with no operations. */
  readonly registrations?: readonly BackendRegistration[];
  readonly facts?: BackendFacts;
}

export function prepareAetheriaBackend(options: AetheriaBackendOptions = {}): PrepareResult {
  return prepareBackend({
    manifest: options.manifest ?? backendManifest(),
    composition: BACKEND_COMPOSITION_ID,
    allowlist: BACKEND_ENTRY_ALLOWLIST,
    registrations: options.registrations ?? [createAgentAwarenessBackendRegistration()],
    ...(options.facts === undefined ? {} : { facts: options.facts }),
  });
}
