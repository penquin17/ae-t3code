// AETHERIA — the Backend half of the `agent-awareness` module: its manifest row and its registration.
//
// The Agent half (readiness and guarded write/edit) lives in the Pi adapter outside the fork. This half is the Backend's seat for the
// coordination board: it owns the operation-registration seam; the service registers board and awareness operations here.
import type { Xc6Operation } from "@t3tools/aetheria-contracts";

import type { BackendRegistration } from "./adapter.ts";
import { PINNED_ARTIFACT } from "./artifact.ts";

export const AGENT_AWARENESS_BACKEND_ID = "agent-awareness-backend";
export const AGENT_AWARENESS_BACKEND_ENTRY = "aetheria:agent-awareness-backend";

// The build-time allowlist of Backend module entries lives in composition.ts, where every Backend module's entry is named.

/**
 * The manifest row (schema v1, raw) that selects this module on the Backend host. The outer manifest copies it into a Backend
 * composition; `stamp` defaults to the artifact this build carries, so a row copied from here is never stale by construction.
 */
export function agentAwarenessBackendModuleRow(
  options: { readonly stamp?: string } = {},
): Record<string, unknown> {
  return {
    id: AGENT_AWARENESS_BACKEND_ID,
    host: "backend",
    entry: AGENT_AWARENESS_BACKEND_ENTRY,
    required: true,
    mutatesToolInput: false,
    owns: ["backend-awareness-state"],
    compat: {
      artifacts: { [PINNED_ARTIFACT.package]: { stamp: options.stamp ?? PINNED_ARTIFACT.stamp } },
    },
    contract: {
      consumer:
        "The Agent host's coordination port, through XC-6 operations registered on this module, and the Backend status reader.",
      success:
        "The module starts in dependency order, holds the operation seam while the Backend runs, and drains exactly once on disposal with nothing left live.",
      failure:
        "A failed start rolls the Backend back and is reported in the disposal report; operations of a module that is not running answer unavailable, never a stale success.",
      uncertainty:
        "Only sessions this Backend has observed since its start count as live; earlier history is unknown. Production assign (XC-10) answers unavailable until M05; resolve (XC-8) decides only on M06's verified human answer evidence. Operations answer for module code that is trusted, not sandboxed.",
      stateOwner: "backend-awareness-state",
    },
  };
}

/**
 * The module's registration. Operations are declared here, once, and become reachable through the adapter only while the Backend runs.
 * Drain reports what the module holds: the seam it opened (released) and nothing live.
 */
export function createAgentAwarenessBackendRegistration(
  options: {
    readonly operations?: Readonly<Record<string, Xc6Operation>>;
    /** Drains what the module owns besides the seam (the boards); what it could not finish is reported still live. */
    readonly drainBoards?: () => Promise<{ released: string[]; stillLive: string[] }>;
  } = {},
): BackendRegistration {
  let opened = false;
  return {
    entry: AGENT_AWARENESS_BACKEND_ENTRY,
    activation: {
      start: () => {
        opened = true;
      },
      drain: async () => {
        const boards = (await options.drainBoards?.()) ?? { released: [], stillLive: [] };
        const released = [
          ...(opened ? ["backend-awareness.operation-seam"] : []),
          ...boards.released,
        ];
        opened = false;
        return { released, stopped: [], transferred: [], stillLive: boards.stillLive };
      },
    },
    ...(options.operations === undefined ? {} : { operations: options.operations }),
  };
}
