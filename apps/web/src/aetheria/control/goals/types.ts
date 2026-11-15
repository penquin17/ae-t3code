// The seam between the goal view and the Backend (M07 Plan step 18, D24, XC-23): the three calls the view makes, each settled as a `TransportResult` (the Backend's reply, a reply that never came, or T3's own
// failure message). Production implements it over T3's RPC commands (`commands.ts`); tests supply scripted ones. No call retries, and nothing here resends: a caller that reads again is the only follower of
// an uncertain call. Plain TypeScript: no DOM, no T3 import.
import type { GoalRearmPayload } from "@t3tools/aetheria-contracts";

import type { GrantPayload, TransportResult } from "../types";

export interface GoalsTransport {
  snapshot(environmentId: string, rootSessionId: string): Promise<TransportResult>;
  /** M06's client-only `aetheria.authorization.grant`: the origin it returns goes to `rearm` and nowhere else. */
  grant(environmentId: string, payload: GrantPayload): Promise<TransportResult>;
  /** XC-23's client-only `aetheria.goal.rearm`, the one call that carries an origin id. */
  rearm(environmentId: string, payload: GoalRearmPayload): Promise<TransportResult>;
}
