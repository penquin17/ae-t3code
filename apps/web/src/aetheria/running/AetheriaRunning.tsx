import type { ScopedThreadRef } from "@t3tools/contracts";

import { useQuietThreadProjection } from "../../state/entities";
import { RunningIndicator } from "./RunningIndicator";
import { runningShapeOf } from "./status";
import { runFactsOf } from "./t3Running";

/**
 * The running indicator for a thread, fed only by T3's own facts: the thread structure's runs and
 * items, and T3's stop presentation. `createdAt` is the backend's turn start. With no projection
 * yet the indicator claims nothing and says "Working".
 */
export function AetheriaRunning({
  createdAt,
  threadRef,
}: {
  readonly createdAt: string | null;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const thread = useQuietThreadProjection(threadRef);
  const shape = runningShapeOf(thread === null ? null : runFactsOf(thread.projection));
  return <RunningIndicator shape={shape} createdAt={createdAt} />;
}
