import { describe, expect, it } from "vite-plus/test";

import {
  elapsedText,
  formatRunDuration,
  runningShapeOf,
  wordsOf,
  type RunFacts,
  type RunItem,
} from "./status";

let ordinal = 0;
const item = (over: Partial<RunItem> & Pick<RunItem, "type">): RunItem => ({
  status: "running",
  ordinal: ordinal++,
  runId: "run-1",
  ...over,
});
const facts = (items: RunItem[], over: Partial<RunFacts> = {}): RunFacts => ({
  runStatus: "running",
  activeRunId: "run-1",
  stop: null,
  items,
  ...over,
});
const phase = (items: RunItem[], over: Partial<RunFacts> = {}) =>
  runningShapeOf(facts(items, over));

describe("phase precedence", () => {
  it("a running tool outranks any streaming assistant text or reasoning", () => {
    const shape = phase([
      item({ type: "assistant_message", streaming: true }),
      item({ type: "command_execution" }),
      item({ type: "reasoning", streaming: true }),
    ]);
    expect(shape).toEqual({ kind: "phase", phase: "gather" });
  });

  it("among running tools the latest decides, and a later tool wins a tie of kinds", () => {
    expect(phase([item({ type: "file_change" }), item({ type: "command_execution" })])).toEqual({
      kind: "phase",
      phase: "gather",
    });
    expect(phase([item({ type: "command_execution" }), item({ type: "file_change" })])).toEqual({
      kind: "phase",
      phase: "weave",
    });
  });

  it("maps tools: writes weave, asking connects, everything else named gathers", () => {
    const tool = (toolName: string | null) => phase([item({ type: "dynamic_tool", toolName })]);
    for (const name of ["edit", "apply_patch", "write"]) {
      expect(tool(name)).toEqual({ kind: "phase", phase: "weave" });
    }
    for (const name of ["ask_user_question", "request_user_input"]) {
      expect(tool(name)).toEqual({ kind: "phase", phase: "connect" });
    }
    for (const name of ["read", "grep", "web_fetch", "anything-new"]) {
      expect(tool(name)).toEqual({ kind: "phase", phase: "gather" });
    }
    expect(phase([item({ type: "file_search" })])).toEqual({ kind: "phase", phase: "gather" });
    expect(phase([item({ type: "web_search" })])).toEqual({ kind: "phase", phase: "gather" });
    expect(phase([item({ type: "subagent" })])).toEqual({ kind: "phase", phase: "gather" });
  });

  it("with no running tool the latest streaming step decides: reasoning connects, text weaves", () => {
    expect(phase([item({ type: "reasoning", streaming: true })])).toEqual({
      kind: "phase",
      phase: "connect",
    });
    expect(phase([item({ type: "assistant_message", streaming: true })])).toEqual({
      kind: "phase",
      phase: "weave",
    });
    expect(
      phase([
        item({ type: "assistant_message", streaming: true }),
        item({ type: "reasoning", streaming: true }),
      ]),
    ).toEqual({ kind: "phase", phase: "connect" });
  });

  it("with nothing running yet the phase is gather, the beginning of a turn", () => {
    expect(phase([])).toEqual({ kind: "phase", phase: "gather" });
    expect(phase([item({ type: "user_message", status: "completed" })])).toEqual({
      kind: "phase",
      phase: "gather",
    });
  });
});

describe("unknown tool identity", () => {
  it("a tool with no name, or a running item of a type this build does not know, shows the neutral Working", () => {
    expect(phase([item({ type: "dynamic_tool", toolName: null })])).toEqual({ kind: "working" });
    expect(phase([item({ type: "a_tool_from_the_future" })])).toEqual({ kind: "working" });
    expect(wordsOf({ kind: "working" })).toBe("Working");
  });
});

describe("contradictory or withdrawn facts never read as a phase or as idle", () => {
  it("no projection: the neutral Working", () => {
    expect(runningShapeOf(null)).toEqual({ kind: "working" });
  });

  it("an item that already settled does not count, however it is typed", () => {
    expect(phase([item({ type: "command_execution", status: "completed" })])).toEqual({
      kind: "phase",
      phase: "gather",
    });
    expect(phase([item({ type: "reasoning", streaming: true, status: "completed" })])).toEqual({
      kind: "phase",
      phase: "gather",
    });
  });

  it("items of another run are ignored", () => {
    expect(phase([item({ type: "file_change", runId: "run-0" })])).toEqual({
      kind: "phase",
      phase: "gather",
    });
  });

  it("the run is not active in the backend's runs although the row exists: Working, never idle or a phase", () => {
    for (const runStatus of [
      null,
      "completed",
      "failed",
      "interrupted",
      "idle",
      "cancelled",
      "teleporting",
    ]) {
      const shape = phase([item({ type: "file_change" })], { runStatus });
      expect(shape).toEqual({ kind: "working" });
    }
  });
});

describe("states the backend reports", () => {
  it("waiting comes from the run status", () => {
    expect(phase([item({ type: "file_change" })], { runStatus: "waiting" })).toEqual({
      kind: "waiting",
    });
    expect(wordsOf({ kind: "waiting" })).toBe("Waiting for you");
  });

  it("stopping and unresponsive come from the stop presentation and outrank a phase", () => {
    expect(phase([item({ type: "file_change" })], { stop: "stopping" })).toEqual({
      kind: "stopping",
    });
    expect(phase([item({ type: "file_change" })], { stop: "unresponsive" })).toEqual({
      kind: "unresponsive",
    });
    expect(wordsOf({ kind: "stopping" })).toBe("Stopping…");
    expect(wordsOf({ kind: "unresponsive" })).toBe("Not responding");
  });

  it("a stop outranks waiting too", () => {
    expect(phase([], { runStatus: "waiting", stop: "stopping" })).toEqual({ kind: "stopping" });
  });
});

describe("words", () => {
  it("the three phase phrases", () => {
    expect(wordsOf({ kind: "phase", phase: "gather" })).toBe("Gathering knowledge");
    expect(wordsOf({ kind: "phase", phase: "connect" })).toBe("Connecting ideas");
    expect(wordsOf({ kind: "phase", phase: "weave" })).toBe("Weaving knowledge");
  });
});

describe("elapsed time", () => {
  it.each([
    [0, "1s"],
    [999, "1s"],
    [1_000, "1s"],
    [12_345, "12s"],
    [59_999, "59s"],
    [60_000, "1m 0s"],
    [65_000, "1m 5s"],
    [3_599_000, "59m 59s"],
    [3_603_000, "1h 0m 3s"],
    [-5_000, "1s"],
  ])("%s ms reads %s", (ms, text) => {
    expect(formatRunDuration(ms)).toBe(text);
  });

  it("is measured from the backend's turn start, and absent when there is none", () => {
    const start = Date.parse("2026-11-12T10:00:00Z");
    expect(elapsedText("2026-11-12T10:00:00Z", start + 12_000)).toBe("12s");
    expect(elapsedText(null, start)).toBeUndefined();
    expect(elapsedText("not a time", start)).toBeUndefined();
  });
});
