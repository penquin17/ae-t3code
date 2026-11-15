// Where the workflow runs view gets its transport (M07 Plan step 29): the real T3 commands in production; a host or test supplies another through `WorkflowsTransportContext`, the same seam the goal card uses.
import { createContext, use } from "react";

import { useT3WorkflowsTransport } from "./commands";
import type { WorkflowsTransport } from "./types";

/** Absent in production, where the real commands are used; a host or test provides another here. */
export const WorkflowsTransportContext = createContext<WorkflowsTransport | null>(null);

/** The provided transport, else the real one. Both always run, so the order of hooks never changes. */
export const useWorkflowsTransport = (): WorkflowsTransport => {
  const real = useT3WorkflowsTransport();
  return use(WorkflowsTransportContext) ?? real;
};
