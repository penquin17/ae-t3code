// The one Backend call the usage panel makes, as a supplied capability (M10 Plan step 18, D14, D20, XC-11). The transport interface is this panel's own. The production default is the real T3 RPC
// command (`aetheria.usage.read`, backed by M09's `routeStates(routes, 'display')` and usage; `commands.ts`), whose reply is turned into `{ routes, readings, notes? }`, the shapes in `usage/model.ts`;
// a host or test supplies another through `UsageTransportContext`. `UNAVAILABLE_USAGE` is the transport of a panel with no connection: it answers `USAGE_UNAVAILABLE` in words that say so, so the panel never
// shows a route as out or a usage as 0 for a call that was never made. The call only reads, rejects when no reply arrived, and is never retried here.
import { createContext, use } from "react";

import type { Reply } from "../jobs/reply";
import { useT3UsageTransport } from "./commands";

export interface UsageTarget {
  readonly environmentId: string;
  readonly rootThreadId: string;
}
export interface UsageTransport {
  readonly read: (request: UsageTarget) => Promise<Reply<unknown>>;
}

const USAGE_NOT_CONNECTED = "Route availability and usage are not connected yet (M09 read).";

/** A transport for a panel with no connection: nothing is read, and nothing is claimed about any route or provider. */
export const UNAVAILABLE_USAGE: UsageTransport = {
  read: () =>
    Promise.resolve({ ok: false, code: "USAGE_UNAVAILABLE", detail: USAGE_NOT_CONNECTED }),
};

/** Absent in production, where the real command is used; a host or test provides another here. */
export const UsageTransportContext = createContext<UsageTransport | null>(null);
/** The provided transport, else the real one. Both always run, so the order of hooks never changes. */
export const useUsageTransport = (): UsageTransport => {
  const real = useT3UsageTransport();
  return use(UsageTransportContext) ?? real;
};
