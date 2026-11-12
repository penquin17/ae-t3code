// The T3 adapter of the running indicator: T3's thread structure in, the indicator's facts out.
// The stop state is T3's own presentRunStop; nothing here decides stopping, and nothing is written back.

import { presentRunStop } from "@t3tools/client-runtime/state/thread-execution";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";

import { isActiveRunStatus, type RunFacts, type RunItem } from "./status";

type Projection = Pick<ThreadStructure, "runs" | "turnItems">;

export function runFactsOf(projection: Projection): RunFacts {
  // The active run is the highest-ordinal run still going. Queued runs never ran and hold nothing.
  let active: Projection["runs"][number] | null = null;
  for (const run of projection.runs) {
    if (isActiveRunStatus(run.status) && run.ordinal > (active?.ordinal ?? -1)) active = run;
  }
  const items: RunItem[] = projection.turnItems.map((item) => {
    const loose = item as {
      readonly toolName?: string | null;
      readonly streaming?: boolean;
    };
    return {
      type: item.type,
      status: item.status,
      ordinal: item.ordinal,
      runId: item.runId,
      ...(loose.toolName === undefined ? {} : { toolName: loose.toolName }),
      ...(loose.streaming === undefined ? {} : { streaming: loose.streaming }),
    };
  });
  return {
    runStatus: active?.status ?? null,
    activeRunId: active?.id ?? null,
    stop: presentRunStop(projection)?.state ?? null,
    items,
  };
}
