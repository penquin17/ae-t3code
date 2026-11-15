// Where the goal view gets its transport (M07 Plan step 18): the real T3 commands in production; a host or test supplies another through `GoalsTransportContext`, the same seam the jobs panel uses.
import { createContext, use } from "react";

import { useT3GoalsTransport } from "./commands";
import type { GoalsTransport } from "./types";

/** Absent in production, where the real commands are used; a host or test provides another here. */
export const GoalsTransportContext = createContext<GoalsTransport | null>(null);

/** The provided transport, else the real one. Both always run, so the order of hooks never changes. */
export const useGoalsTransport = (): GoalsTransport => {
  const real = useT3GoalsTransport();
  return use(GoalsTransportContext) ?? real;
};
