import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { runFactsOf } from "./t3Running";

// The structural subset of T3's thread structure the adapter reads; cast once at the edge.
const run = (id: string, ordinal: number, status: string) => ({ id, ordinal, status });
function projection(over: Record<string, unknown> = {}) {
  return { runs: [], turnItems: [], ...over } as never;
}
const turnItem = (over: Record<string, unknown>) => ({
  type: "command_execution",
  status: "running",
  ordinal: 1,
  runId: "run-1",
  ...over,
});

describe("runFactsOf", () => {
  it("the active run is the highest-ordinal run still going, waiting included", () => {
    expect(
      runFactsOf(projection({ runs: [run("run-0", 0, "completed"), run("run-1", 1, "running")] })),
    ).toMatchObject({ activeRunId: "run-1", runStatus: "running" });
    expect(
      runFactsOf(projection({ runs: [run("run-1", 1, "waiting"), run("run-0", 0, "running")] })),
    ).toMatchObject({ activeRunId: "run-1", runStatus: "waiting" });
  });

  it("queued runs never ran and are not active; with no active run nothing is claimed", () => {
    expect(runFactsOf(projection({ runs: [run("run-2", 2, "queued")] }))).toMatchObject({
      activeRunId: null,
      runStatus: null,
    });
    expect(runFactsOf(projection({ runs: [run("run-0", 0, "completed")] }))).toMatchObject({
      activeRunId: null,
      runStatus: null,
    });
  });

  it("carries T3's own stop presentation: stopping, then unresponsive from unresponsiveAt", () => {
    const runs = [run("run-1", 1, "running")];
    const request = (extra: Record<string, unknown>) =>
      turnItem({
        type: "run_interrupt_request",
        status: "running",
        updatedAt: DateTime.makeUnsafe("2026-11-12T10:00:00Z"),
        ...extra,
      });
    expect(runFactsOf(projection({ runs, turnItems: [] })).stop).toBeNull();
    expect(runFactsOf(projection({ runs, turnItems: [request({})] })).stop).toBe("stopping");
    expect(
      runFactsOf(
        projection({
          runs,
          turnItems: [request({ unresponsiveAt: DateTime.makeUnsafe("2026-11-12T10:01:00Z") })],
        }),
      ).stop,
    ).toBe("unresponsive");
    // A result for the run ends the stop presentation.
    expect(
      runFactsOf(
        projection({
          runs,
          turnItems: [request({}), turnItem({ type: "run_interrupt_result", status: "completed" })],
        }),
      ).stop,
    ).toBeNull();
  });

  it("maps turn items to the policy's items, keeping streaming, tool name and run id", () => {
    const facts = runFactsOf(
      projection({
        runs: [run("run-1", 1, "running")],
        turnItems: [
          turnItem({ type: "dynamic_tool", toolName: "edit", ordinal: 3 }),
          turnItem({ type: "reasoning", streaming: true, ordinal: 4 }),
        ],
      }),
    );
    expect(facts.items).toEqual([
      { type: "dynamic_tool", status: "running", ordinal: 3, runId: "run-1", toolName: "edit" },
      { type: "reasoning", status: "running", ordinal: 4, runId: "run-1", streaming: true },
    ]);
  });
});
