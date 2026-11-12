import { describe, expect, it } from "vite-plus/test";

import {
  applyBaseline,
  applyIncrement,
  awaitingBaseline,
  markDisconnected,
  readProjection,
} from "./resync";

type Count = { readonly n: number };
const add =
  (by: number) =>
  (value: Count): Count => ({ n: value.n + by });

describe("baseline, then increments", () => {
  it("before any baseline the projection is unknown and an increment changes nothing", () => {
    const start = awaitingBaseline<Count>();
    expect(readProjection(start)).toEqual({
      state: "unknown",
      reason: "waiting for the backend's baseline",
    });
    expect(applyIncrement(start, 1, add(1))).toBe(start);
  });

  it("applies increments in order after the baseline", () => {
    let state = applyBaseline(awaitingBaseline<Count>(), 10, { n: 0 });
    state = applyIncrement(state, 11, add(1));
    state = applyIncrement(state, 12, add(5));
    expect(readProjection(state)).toEqual({ state: "known", value: { n: 6 } });
  });

  it("ignores an increment older than or equal to the baseline", () => {
    let state = applyBaseline(awaitingBaseline<Count>(), 10, { n: 4 });
    state = applyIncrement(state, 9, add(100));
    state = applyIncrement(state, 10, add(100));
    expect(readProjection(state)).toEqual({ state: "known", value: { n: 4 } });
  });

  it("a duplicate increment counts once", () => {
    let state = applyBaseline(awaitingBaseline<Count>(), 10, { n: 0 });
    state = applyIncrement(state, 11, add(1));
    state = applyIncrement(state, 11, add(1));
    expect(readProjection(state)).toEqual({ state: "known", value: { n: 1 } });
  });

  it("a reordered increment (12 before 11) is not applied out of order: the view needs a fresh baseline", () => {
    let state = applyBaseline(awaitingBaseline<Count>(), 10, { n: 0 });
    state = applyIncrement(state, 12, add(5));
    expect(state.phase === "live" && state.needsBaseline).toBe(true);
    expect(readProjection(state)).toEqual({ state: "known", value: { n: 0 } });
    // The late 11 arrives, but a gap already asked for a new baseline: nothing is applied behind it.
    state = applyIncrement(state, 11, add(1));
    expect(readProjection(state)).toEqual({ state: "known", value: { n: 0 } });
    state = applyBaseline(state, 12, { n: 6 });
    expect(state.phase === "live" && state.needsBaseline).toBe(false);
    expect(readProjection(state)).toEqual({ state: "known", value: { n: 6 } });
  });

  it("a newer baseline replaces the value; an older baseline is ignored", () => {
    let state = applyBaseline(awaitingBaseline<Count>(), 10, { n: 1 });
    state = applyBaseline(state, 20, { n: 7 });
    state = applyBaseline(state, 15, { n: 99 });
    expect(readProjection(state)).toEqual({ state: "known", value: { n: 7 } });
  });
});

describe("disconnect and reconnect", () => {
  it("a disconnect keeps the last value but marks it stale and asks for a baseline; it cancels and sends nothing", () => {
    let state = applyBaseline(awaitingBaseline<Count>(), 10, { n: 3 });
    state = markDisconnected(state);
    expect(state.phase === "live" && state.stale).toBe(true);
    expect(state.phase === "live" && state.needsBaseline).toBe(true);
    // Increments that arrive on the old stream are not applied.
    expect(readProjection(applyIncrement(state, 11, add(1)))).toEqual({
      state: "known",
      value: { n: 3 },
    });
  });

  it("the reconnect baseline clears stale", () => {
    let state = markDisconnected(applyBaseline(awaitingBaseline<Count>(), 10, { n: 3 }));
    state = applyBaseline(state, 30, { n: 8 });
    expect(state.phase === "live" && state.stale).toBe(false);
    expect(readProjection(state)).toEqual({ state: "known", value: { n: 8 } });
  });

  it("a disconnect before any baseline leaves the projection unknown", () => {
    const state = markDisconnected(awaitingBaseline<Count>());
    expect(readProjection(state).state).toBe("unknown");
  });
});
