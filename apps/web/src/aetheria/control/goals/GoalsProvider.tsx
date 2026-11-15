// The one owner of a root's goal view and Re-arm (M07 Plan step 18, D24): the control page mounts it for the known (environment, root) and keys it on both, so the goal card and any authorization card that
// is tied to the goal's Re-arm read the same last read and the same in-flight action. Without a provider (a card shown alone) a card has no goal and offers no Re-arm.
import { createContext, use, type ReactNode } from "react";

import { useGoalsTransport } from "./transport";
import { useGoals, type GoalsHandle } from "./useGoals";

const GoalsContext = createContext<GoalsHandle | null>(null);

export function GoalsProvider(props: {
  readonly environmentId: string;
  /** The Backend's Pi session id of the root, never a T3 thread id. */
  readonly rootSessionId: string;
  readonly children: ReactNode;
}) {
  const transport = useGoalsTransport();
  const handle = useGoals(transport, props.environmentId, props.rootSessionId);
  return <GoalsContext value={handle}>{props.children}</GoalsContext>;
}

/** The mounted goal view, or null when this page has none (no identity known, or a card shown alone). */
export const useGoalsHandle = (): GoalsHandle | null => use(GoalsContext);
