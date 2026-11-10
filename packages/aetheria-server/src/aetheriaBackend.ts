// AETHERIA M04 Plan step 15 (B5) — prepare the Backend over its own composition. The assembly step 16 provides at the server layer graph calls this.
import { prepareBackend, type BackendFacts, type PrepareResult } from "./adapter.ts";
import { createAgentAwarenessBackendRegistration } from "./agentAwareness.ts";
import type { BackendRegistration } from "./adapter.ts";
import { BACKEND_COMPOSITION_ID, BACKEND_ENTRY_ALLOWLIST, backendManifest } from "./composition.ts";
import { createHumanControlBackendRegistration } from "./humanControl.ts";
import { createProvidersBackendRegistration } from "./providers.ts";

export interface AetheriaBackendOptions {
  /** Default: the fork's own `backendManifest()`. A test may pass another to prove it is refused. */
  readonly manifest?: unknown;
  /** The composition to prepare. Default: the production `aetheria-backend`. Another id is a scripted test composition built from the same rows. */
  readonly composition?: string;
  /** Default: the agent-awareness registration with no operations, the providers registration in production mode and the unconfigured human-control registration (digest only). */
  readonly registrations?: readonly BackendRegistration[];
  readonly facts?: BackendFacts;
}

export function prepareAetheriaBackend(options: AetheriaBackendOptions = {}): PrepareResult {
  const composition = options.composition ?? BACKEND_COMPOSITION_ID;
  return prepareBackend({
    manifest: options.manifest ?? backendManifest({ composition }),
    composition,
    allowlist: BACKEND_ENTRY_ALLOWLIST,
    registrations: options.registrations ?? [
      createAgentAwarenessBackendRegistration(),
      createProvidersBackendRegistration({ composition }),
      createHumanControlBackendRegistration({}),
    ],
    ...(options.facts === undefined ? {} : { facts: options.facts }),
  });
}
