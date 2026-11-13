// The seam to the Backend's group store. The production transport is the real one: `aetheria.groups.read` and `aetheria.groups.apply` over T3's RPC (commands.ts, which also owns the hook that
// picks between it and a provided one). A host or a test may supply another transport through the provider; `unavailableTransport` answers honestly that nothing is connected. The reply value
// is `unknown` on purpose: record.ts reads it strictly, so a transport can never hand the views an unchecked record.
import { createContext, useContext } from "react";

import type { GroupBody } from "./operations";

export type GroupsReply =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: string; readonly detail?: string };

export interface GroupsTransport {
  /** Reads the Backend's whole group record. */
  read(): Promise<GroupsReply>;
  /** Applies one change and answers the confirmed record. Called once per action, never repeated. A rejection means the reply never came. */
  apply(body: GroupBody): Promise<GroupsReply>;
}

export const GROUPS_UNAVAILABLE = "GROUPS_UNAVAILABLE";
export const GROUPS_UNAVAILABLE_REASON = "The groups store is not connected";

const notConnected = async (): Promise<GroupsReply> => ({
  ok: false,
  code: GROUPS_UNAVAILABLE,
  detail: GROUPS_UNAVAILABLE_REASON,
});

export const unavailableTransport: GroupsTransport = { read: notConnected, apply: notConnected };

/** Absent in production, where T3's commands are used; a test or host provides another here. */
const GroupsTransportContext = createContext<GroupsTransport | null>(null);

export const GroupsTransportProvider = GroupsTransportContext.Provider;
/** The transport a host or test provided, or null. Views use `useGroupsTransport` (commands.ts), which falls back to the real one. */
export const useProvidedGroupsTransport = (): GroupsTransport | null =>
  useContext(GroupsTransportContext);
