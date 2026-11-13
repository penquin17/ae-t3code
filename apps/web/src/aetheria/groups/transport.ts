// The seam to the Backend's group store. The methods `aetheria.groups.*` do not exist yet (phase 2b), so the
// web side is built against this interface and a fake. Production uses `unavailableTransport`, which answers
// honestly that nothing is connected; 2b replaces that default only. The reply value is `unknown` on purpose:
// record.ts reads it strictly, so a transport can never hand the views an unchecked record.
import { createContext, useContext } from "react";

import type { GroupBody } from "./operations";

export type GroupsReply =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: string; readonly detail?: string };

export interface GroupsTransport {
  /** Reads the Backend's whole group record. */
  read(): Promise<GroupsReply>;
  /** Applies one change and answers the confirmed record. Called once per action, never repeated. */
  apply(body: GroupBody): Promise<GroupsReply>;
}

export const GROUPS_UNAVAILABLE = "GROUPS_UNAVAILABLE";
export const GROUPS_UNAVAILABLE_REASON = "The groups store is not connected in this build yet";

const notConnected = async (): Promise<GroupsReply> => ({
  ok: false,
  code: GROUPS_UNAVAILABLE,
  detail: GROUPS_UNAVAILABLE_REASON,
});

export const unavailableTransport: GroupsTransport = { read: notConnected, apply: notConnected };

const GroupsTransportContext = createContext<GroupsTransport>(unavailableTransport);

export const GroupsTransportProvider = GroupsTransportContext.Provider;
export const useGroupsTransport = (): GroupsTransport => useContext(GroupsTransportContext);
