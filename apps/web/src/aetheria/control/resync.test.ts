import { describe, expect, it } from "vite-plus/test";

import {
  classifySnapshot,
  disconnected,
  initialInteractions,
  pushArrived,
  reconnected,
  snapshotArrived,
  snapshotFailed,
  streamEnded,
  viewOf,
  type InteractionsState,
} from "./resync";
import type { InteractionRecord, InteractionsSnapshot, TransportResult } from "./types";

const ROOT = "root-1";
const record = (id: string, extra: Partial<InteractionRecord> = {}): InteractionRecord =>
  ({
    interactionId: id,
    state: "pending",
    revision: "b".repeat(64),
    rootSessionId: ROOT,
    sessionId: ROOT,
    createdAt: "2026-01-01T00:00:00Z",
    held: false,
    kind: "question",
    content: { questions: [{ id: "q", question: "Which?" }] },
    ...extra,
  }) as InteractionRecord;
const snapshot = (version: number, ...ids: string[]): InteractionsSnapshot => ({
  rootSessionId: ROOT,
  version,
  interactions: ids.map((id) => record(id)),
});
const change = (version: number, rootSessionId = ROOT) => ({ rootSessionId, version });

/** Applies a baseline and returns the state. */
const withBaseline = (version: number, ...ids: string[]): InteractionsState =>
  snapshotArrived(initialInteractions(), snapshot(version, ...ids)).state;

describe("the interactions view over a change stream and a snapshot read", () => {
  it("shows waiting, never an empty list, before the first baseline", () => {
    expect(viewOf(initialInteractions())).toMatchObject({ status: "waiting" });
  });

  it("a push that arrives before the baseline is kept, and a baseline behind it asks for another read", () => {
    const afterPush = pushArrived(initialInteractions(), ROOT, change(5));
    expect(afterPush.read).toBe(false); // the first read is already due; do not start a second one
    const behind = snapshotArrived(afterPush.state, snapshot(3, "i-1"));
    expect(behind.read).toBe(true);
    expect(viewOf(behind.state)).toMatchObject({ status: "live", version: 3 });
    const caught = snapshotArrived(behind.state, snapshot(5, "i-1", "i-2"));
    expect(caught.read).toBe(false);
    expect(viewOf(caught.state)).toMatchObject({ status: "live", version: 5 });
  });

  it("a baseline that already includes the push needs no further read", () => {
    const afterPush = pushArrived(initialInteractions(), ROOT, change(4));
    expect(snapshotArrived(afterPush.state, snapshot(4, "i-1")).read).toBe(false);
  });

  it("a newer push asks for a read and changes no record itself", () => {
    const state = withBaseline(2, "i-1");
    const pushed = pushArrived(state, ROOT, change(3));
    expect(pushed.read).toBe(true);
    expect(viewOf(pushed.state)).toMatchObject({ status: "live", version: 2 });
  });

  it("a duplicate or older push is dropped", () => {
    const state = withBaseline(4, "i-1");
    expect(pushArrived(state, ROOT, change(4)).read).toBe(false);
    expect(pushArrived(state, ROOT, change(2)).read).toBe(false);
    expect(pushArrived(state, ROOT, change(4)).state).toEqual(state);
  });

  it("a version gap forces a fresh baseline", () => {
    const state = withBaseline(2, "i-1");
    const gap = pushArrived(state, ROOT, change(7));
    expect(gap.read).toBe(true);
    expect(gap.state.projection).toMatchObject({ phase: "live", needsBaseline: true });
    const healed = snapshotArrived(gap.state, snapshot(7, "i-1"));
    expect(healed.state.projection).toMatchObject({ phase: "live", needsBaseline: false });
  });

  it("an id that leaves a later read is named as vanished, never as completed", () => {
    const first = withBaseline(1, "i-1", "i-2");
    expect(viewOf(first)).toMatchObject({ status: "live", vanished: [] });
    const next = snapshotArrived(first, snapshot(2, "i-2")).state;
    expect(viewOf(next)).toMatchObject({ status: "live", vanished: ["i-1"] });
    // An older read changes nothing, so it cannot add or remove a disappearance.
    expect(snapshotArrived(next, snapshot(1, "i-1", "i-2")).state).toEqual(next);
  });

  it("a push for another root is ignored", () => {
    const state = withBaseline(2, "i-1");
    expect(pushArrived(state, ROOT, change(9, "other-root"))).toEqual({ state, read: false });
  });

  it("an older baseline never replaces a newer one", () => {
    const state = withBaseline(6, "i-1", "i-2");
    const late = snapshotArrived(state, snapshot(3, "i-1"));
    expect(late.read).toBe(false);
    expect(viewOf(late.state)).toMatchObject({ status: "live", version: 6 });
  });

  it("a disconnect keeps the last value marked stale and a reconnect re-baselines", () => {
    const state = disconnected(withBaseline(4, "i-1"));
    const view = viewOf(state);
    expect(view).toMatchObject({ status: "stale", version: 4 });
    expect(view.status === "stale" && view.interactions.map((r) => r.interactionId)).toEqual([
      "i-1",
    ]);
    const back = reconnected(state);
    expect(back.read).toBe(true);
    const fresh = snapshotArrived(back.state, snapshot(5, "i-1"));
    expect(viewOf(fresh.state)).toMatchObject({ status: "live", version: 5 });
  });

  it("a stream that ended shows unavailable, never an empty list", () => {
    expect(viewOf(streamEnded(withBaseline(4, "i-1"), "the Backend was disposed"))).toEqual({
      status: "unavailable",
      reason: "the Backend was disposed",
    });
    expect(viewOf(streamEnded(initialInteractions(), "closed")).status).toBe("unavailable");
  });

  it("a failed read with no baseline is unavailable; with a baseline it keeps the value stale", () => {
    expect(viewOf(snapshotFailed(initialInteractions(), "session unknown"))).toEqual({
      status: "unavailable",
      reason: "session unknown",
    });
    const view = viewOf(snapshotFailed(withBaseline(2, "i-1"), "the read failed"));
    expect(view).toMatchObject({ status: "stale", version: 2, reason: "the read failed" });
  });
});

describe("a snapshot reply is read as it is", () => {
  const reply = (value: unknown): TransportResult => ({ tag: "reply", reply: value });

  it("an accepted snapshot is carried whole", () => {
    expect(classifySnapshot(reply({ ok: true, value: snapshot(3, "i-1") }), ROOT)).toEqual({
      tag: "ok",
      snapshot: snapshot(3, "i-1"),
    });
  });

  it("a snapshot for another root is not this root's", () => {
    const other = { ...snapshot(3, "i-1"), rootSessionId: "other" };
    expect(classifySnapshot(reply({ ok: true, value: other }), ROOT).tag).toBe("failed");
  });

  it.each([
    ["a coded failure", reply({ ok: false, code: "INTERACTION_UNAVAILABLE", detail: "closed" })],
    ["a malformed value", reply({ ok: true, value: { version: "x" } })],
    ["a lost reply", { tag: "lost" } as TransportResult],
    ["a T3 failure", { tag: "failed", message: "scope" } as TransportResult],
  ])("%s is a failed read, never an empty list", (_name, input) => {
    expect(classifySnapshot(input, ROOT).tag).toBe("failed");
  });

  it("a coded failure keeps the Backend's code and words", () => {
    expect(
      classifySnapshot(
        reply({ ok: false, code: "INTERACTION_NOT_FOUND", detail: "no such root" }),
        ROOT,
      ),
    ).toEqual({ tag: "failed", reason: "no such root", code: "INTERACTION_NOT_FOUND" });
  });
});
