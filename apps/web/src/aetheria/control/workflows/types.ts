// The seam between the workflow runs view and the Backend (M07 Plan step 29, M10 run controls): the two calls the view makes, each settled as a `TransportResult` (the Backend's reply, a reply that never came,
// or T3's own failure message). Production implements it over T3's RPC commands (`commands.ts`); tests supply scripted ones. No call retries, and nothing here resends: a caller that reads again is the only
// follower of an uncertain call. Plain TypeScript: no DOM, no T3 import.
import type { TransportResult } from "../types";

export interface WorkflowsTransport {
  /** `aetheria.workflow.runs` (read scope): the root's runs, newest first, with a version and a count of unreadable records. */
  runs(environmentId: string, rootSessionId: string): Promise<TransportResult>;
  /** `aetheria.workflow.cancel` (operate scope): asks for exactly one run's cancel. Sent at most once per click; an uncertain reply is read back, never resent. */
  cancel(environmentId: string, rootSessionId: string, runId: string): Promise<TransportResult>;
}
