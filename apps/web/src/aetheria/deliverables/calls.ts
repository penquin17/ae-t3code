// The two Backend reads the deliverables page makes, as supplied capabilities (M10 Plan step 16, C5): `aetheria.deliverables.list` and `aetheria.deliverables.offeredPaths` are methods of the group
// T3 joins (IP-3), so T3's own typed client, scope check and transport carry them. Each call is one settled `SendResult`; a lost reply is `lost` and a read is simply read again, never resent
// by anything here. A test supplies fakes through the context.
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { createContext } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import type { SendResult } from "../core/outcome";
import { sendResultFromCommand } from "../sessions/commandResult";

export interface RootTarget {
  readonly environmentId: EnvironmentId;
  readonly rootThreadId: string;
}

export interface DeliverablesCalls {
  readonly list: (target: RootTarget) => Promise<SendResult<unknown>>;
  readonly offeredPaths: (target: RootTarget) => Promise<SendResult<unknown>>;
}

const aetheriaDeliverables = {
  list: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:deliverables:list",
    tag: "aetheria.deliverables.list",
  }),
  offeredPaths: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:deliverables:offered-paths",
    tag: "aetheria.deliverables.offeredPaths",
  }),
} as const;

/** Absent in production, where T3's commands are used; a test provides fakes here. */
export const DeliverablesCallsContext = createContext<DeliverablesCalls | null>(null);

export function useT3DeliverablesCalls(): DeliverablesCalls {
  const list = useAtomCommand(aetheriaDeliverables.list, { reportFailure: false });
  const offeredPaths = useAtomCommand(aetheriaDeliverables.offeredPaths, { reportFailure: false });
  return {
    list: async ({ environmentId, rootThreadId }) =>
      sendResultFromCommand(await list({ environmentId, input: { rootThreadId } })),
    offeredPaths: async ({ environmentId, rootThreadId }) =>
      sendResultFromCommand(await offeredPaths({ environmentId, input: { rootThreadId } })),
  };
}
