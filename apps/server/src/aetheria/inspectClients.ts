// @effect-diagnostics globalTimers:off globalDate:off
// M11 steps 18–19: the server's one live-client wiring — the request-stream transport and the C5 resolver over the shared region registry. ws.ts's handlers and the Backend's inspect module must hold the same pair.
// It follows the registry: a fresh registry (a new Backend in this process) gets a fresh pair, so a drained resolver never serves the next Backend.
import { createClientQueries, type ClientQueries } from "@t3tools/aetheria-server";

import {
  createInspectClientTransport,
  type InspectClientTransport,
} from "./inspectClientTransport.ts";
import { getSharedRegionRegistry, type RegionRegistry } from "./regionsState.ts";

/** The Backend's one deadline D, provisional (record DV1); the Backend service must be built with the same number. */
const INSPECT_CLIENT_DEADLINE_MS = 10_000;

export interface SharedInspectClients {
  readonly transport: InspectClientTransport;
  readonly queries: ClientQueries;
}

let held: { readonly registry: RegionRegistry; readonly clients: SharedInspectClients } | undefined;

export function getSharedInspectClients(): SharedInspectClients {
  const registry = getSharedRegionRegistry();
  if (held?.registry === registry) return held.clients;
  const transport = createInspectClientTransport(registry);
  let sequence = 0;
  const queries = createClientQueries({
    port: transport.port,
    deadlineMs: INSPECT_CLIENT_DEADLINE_MS,
    schedule: (ms, fn) => {
      const timer = setTimeout(fn, ms);
      timer.unref();
      return () => clearTimeout(timer);
    },
    newId: () => `inspect-${Date.now().toString(36)}-${(sequence += 1)}`,
  });
  held = { registry, clients: { transport, queries } };
  return held.clients;
}
