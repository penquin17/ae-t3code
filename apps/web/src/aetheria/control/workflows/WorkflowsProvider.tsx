// The one owner of a root's workflow runs view and Cancels (M07 Plan step 29): the control page mounts it inside the goal view for the known (environment, root), so the runs the goal card shows are one last
// read with one set of in-flight Cancels. Without a provider (a card shown alone) the card has no runs and offers no Cancel.
import { createContext, use, type ReactNode } from "react";

import { useWorkflowsTransport } from "./transport";
import { useWorkflows, type WorkflowsHandle } from "./useWorkflows";

const WorkflowsContext = createContext<WorkflowsHandle | null>(null);

export function WorkflowsProvider(props: {
  readonly environmentId: string;
  /** The Backend's Pi session id of the root, never a T3 thread id. */
  readonly rootSessionId: string;
  /** How often the runs are read while the page is visible; a test shortens it. */
  readonly pollMs?: number;
  readonly children: ReactNode;
}) {
  const transport = useWorkflowsTransport();
  const handle = useWorkflows(transport, props.environmentId, props.rootSessionId, props.pollMs);
  return <WorkflowsContext value={handle}>{props.children}</WorkflowsContext>;
}

/** The mounted runs view, or null when this page has none (no identity known, or a card shown alone). */
export const useWorkflowsHandle = (): WorkflowsHandle | null => use(WorkflowsContext);
