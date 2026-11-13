// The Backend's group store as T3 RPC commands over the Aetheria group (M10 step 7, D3): `aetheria.groups.read` and `aetheria.groups.apply` are methods of the group T3 joins (IP-3), so T3's typed
// client, scope check and transport carry them; the tags are checked against the joined group (a misspelt or removed method does not compile). The transport below is the production `GroupsTransport`:
// the reply is the Backend's own value, a reply that never came is a rejection (the store reads it as lost and never resends), and T3's own refusal (a device without the operate scope) is the
// contract's GROUPS_NOT_AUTHORIZED with T3's words. Groups live in the Backend the app is served from, the primary environment: a session's id in a group is the scoped key the sidebar uses.
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useStableCallback } from "../../hooks/useStableCallback";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { sendResultFromCommand } from "../sessions/commandResult";
import type { GroupBody } from "./operations";
import {
  GROUPS_UNAVAILABLE,
  GROUPS_UNAVAILABLE_REASON,
  useProvidedGroupsTransport,
  type GroupsReply,
  type GroupsTransport,
} from "./transport";

const aetheriaGroups = {
  /** The whole record, as this connection may see it. */
  read: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:groups:read",
    tag: "aetheria.groups.read",
  }),
  /** One of the five operations; the Backend answers the confirmed record. */
  apply: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:groups:apply",
    tag: "aetheria.groups.apply",
  }),
} as const;

const NOT_CONNECTED: GroupsReply = {
  ok: false,
  code: GROUPS_UNAVAILABLE,
  detail: GROUPS_UNAVAILABLE_REASON,
};

/** The transport a view uses: the one a host or test provided, else the production one. Both hooks always run, so the order of hooks never changes. */
export const useGroupsTransport = (): GroupsTransport => {
  const real = useT3GroupsTransport();
  return useProvidedGroupsTransport() ?? real;
};

/**
 * The production transport over the primary environment's connection. A rejection means the reply never came. The store is built once and keeps this transport for the view's life, so each call
 * reads the primary environment id as it is when the call is made (not as it was at mount): a store made before the environment was known reads with its id once it is.
 */
function useT3GroupsTransport(): GroupsTransport {
  const environmentId = usePrimaryEnvironmentId();
  const readCommand = useAtomCommand(aetheriaGroups.read, { reportFailure: false });
  const applyCommand = useAtomCommand(aetheriaGroups.apply, { reportFailure: false });
  const settle = (sent: ReturnType<typeof sendResultFromCommand<unknown>>): GroupsReply => {
    if (sent.tag === "accepted") return sent.value as GroupsReply;
    if (sent.tag === "refused")
      return { ok: false, code: "GROUPS_NOT_AUTHORIZED", detail: sent.message };
    throw new Error("the group call's reply did not arrive");
  };
  const read = useStableCallback(async (): Promise<GroupsReply> => {
    if (environmentId === null) return NOT_CONNECTED;
    return settle(sendResultFromCommand(await readCommand({ environmentId, input: {} })));
  });
  const apply = useStableCallback(async (body: GroupBody): Promise<GroupsReply> => {
    if (environmentId === null) return NOT_CONNECTED;
    return settle(sendResultFromCommand(await applyCommand({ environmentId, input: body })));
  });
  const [transport] = useState<GroupsTransport>(() => ({ read, apply }));
  return transport;
}
