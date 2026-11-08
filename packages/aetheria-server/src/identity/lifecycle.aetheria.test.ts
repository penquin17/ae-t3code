// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M04 Plan step 13 — T3 lifecycle observations fed to M03's sweep (the existing retire ownership path).
//
// Boundary: the real tracker over the real thread index. The sweep itself is M03's `store.sweep`, which this package cannot import
// (the pinned Backend entry exports no store, by design); `storeSweep` below is a TEST DOUBLE that applies the same decision table as
// store.ts:284-317 to the observation this module gives it. So these tests show what the tracker answers, per session, in each case; they do
// not show that the real store retires. That is shown by the one-off scratch run in the step report, which drives the real store with this
// module's real observer. Does not show: T3 event delivery (step 16), liveness (step 14).
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { createLifecycleTracker, type LifecycleObserver, type SweepReport } from "./lifecycle.ts";
import { createThreadIndex } from "./threadIndex.ts";
import {
  FOLDER,
  SESSION,
  SESSION_B,
  THREAD,
  THREAD_B,
  mainRecord,
  rootOf,
  sessionFileOf,
  snapshot,
  writeEnvelope,
} from "./testkit.ts";

const STRAY = "0197d3c0-9999-7000-8000-000000000009";

/** The store's sweep decision table (store.ts:284-317) over the identity folder, retiring nothing on disk: it reports. */
const storeSweep =
  (stateRoot: string) =>
  (observer: LifecycleObserver | undefined): SweepReport => {
    const report: {
      removedPending: string[];
      retired: string[];
      retained: { id: string; why: string }[];
      problems: string[];
    } = { removedPending: [], retired: [], retained: [], problems: [] };
    const dir = NodePath.join(stateRoot, "identity");
    for (const name of NodeFS.readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort()) {
      const id = name.slice(0, -5);
      const envelope = JSON.parse(NodeFS.readFileSync(NodePath.join(dir, name), "utf8"));
      if (envelope.state === "retired") continue;
      const seen = observer?.session?.(id);
      const tri = (v: unknown) => v === null || typeof v === "boolean";
      if (
        seen === undefined ||
        !tri(seen.exists) ||
        !tri(seen.closed) ||
        !tri(seen.acceptedPrompt)
      ) {
        report.retained.push({ id, why: "no usable lifecycle observation" });
        continue;
      }
      const accepted = envelope.acceptedPrompt ? true : seen.acceptedPrompt;
      if (seen.exists === false || (seen.closed === true && accepted === false))
        report.retired.push(id);
      else report.retained.push({ id, why: "the session is alive or its state is unclear" });
    }
    return report;
  };

function world() {
  const stateRoot = rootOf();
  const index = createThreadIndex({ stateRoot, projectRootOf: (folder) => folder });
  const tracker = createLifecycleTracker({ index });
  const bind = (threadId: string, sessionId: string) => {
    const result = index.bind({
      threadId,
      providerSessionId: `prov-${threadId.slice(-4)}`,
      providerInstanceId: "pi",
      sessionFile: sessionFileOf(sessionId),
      workingFolder: FOLDER,
    });
    if (!result.ok) throw new Error(result.code);
  };
  writeEnvelope(stateRoot, mainRecord(SESSION));
  writeEnvelope(stateRoot, mainRecord(SESSION_B));
  bind(THREAD, SESSION);
  bind(THREAD_B, SESSION_B);
  return { stateRoot, index, tracker, bind };
}

describe("what T3 observations say about a session", () => {
  it("is unknown for everything until something is observed", () => {
    const { tracker } = world();
    expect(tracker.observer().session?.(SESSION)).toEqual({
      exists: null,
      closed: null,
      acceptedPrompt: null,
    });
  });

  it("maps running, settled, accepted, closed and deleted onto M03's three answers", () => {
    const { tracker } = world();
    const seen = () => tracker.observer().session?.(SESSION);
    expect(tracker.record({ kind: "running", threadId: THREAD })).toBe(true);
    expect(seen()).toEqual({ exists: true, closed: false, acceptedPrompt: null });
    tracker.record({ kind: "accepted", threadId: THREAD });
    expect(seen()).toEqual({ exists: true, closed: false, acceptedPrompt: true });
    tracker.record({ kind: "settled", threadId: THREAD });
    expect(seen()).toEqual({ exists: true, closed: false, acceptedPrompt: true });
    tracker.record({ kind: "closed", threadId: THREAD, acceptedPrompt: null });
    expect(seen()).toEqual({ exists: true, closed: true, acceptedPrompt: true });
    tracker.record({ kind: "deleted", threadId: THREAD });
    expect(seen()).toMatchObject({ exists: false });
  });

  it("never turns an accepted prompt back into 'not accepted', and a later unknown forgets only what is perishable", () => {
    const { tracker } = world();
    tracker.record({ kind: "accepted", threadId: THREAD });
    tracker.record({ kind: "closed", threadId: THREAD, acceptedPrompt: false });
    expect(tracker.observer().session?.(SESSION)).toEqual({
      exists: true,
      closed: true,
      acceptedPrompt: true,
    });
    tracker.record({ kind: "unknown", threadId: THREAD });
    expect(tracker.observer().session?.(SESSION)).toEqual({
      exists: null,
      closed: null,
      acceptedPrompt: true,
    });
  });

  it("takes 'never accepted' only from a closure that says so", () => {
    const { tracker } = world();
    tracker.record({ kind: "closed", threadId: THREAD, acceptedPrompt: false });
    tracker.record({ kind: "closed", threadId: THREAD_B, acceptedPrompt: null });
    expect(tracker.observer().session?.(SESSION)).toEqual({
      exists: true,
      closed: true,
      acceptedPrompt: false,
    });
    expect(tracker.observer().session?.(SESSION_B)).toEqual({
      exists: true,
      closed: true,
      acceptedPrompt: null,
    });
  });

  it("answers unknown for a session no thread is bound to, and for one two threads claim", () => {
    const { tracker } = world();
    tracker.record({ kind: "deleted", threadId: "mcp:never-bound" });
    expect(tracker.observer().session?.(STRAY)).toEqual({
      exists: null,
      closed: null,
      acceptedPrompt: null,
    });
  });

  it("ignores an event that is malformed rather than guessing", () => {
    const { tracker } = world();
    for (const bad of [
      null,
      {},
      { kind: "closed" },
      { kind: "closed", threadId: "" },
      { kind: "exploded", threadId: THREAD },
      { kind: "closed", threadId: THREAD, acceptedPrompt: "no" },
      { kind: "deleted", threadId: 3 },
    ]) {
      expect(tracker.record(bad as never)).toBe(false);
    }
    expect(tracker.observer().session?.(SESSION)).toEqual({
      exists: null,
      closed: null,
      acceptedPrompt: null,
    });
  });

  it("offers an observer that can only be asked, and cannot be edited", () => {
    const { tracker } = world();
    const observer = tracker.observer();
    expect(Object.keys(observer).sort()).toEqual(["session"]);
    expect(Object.isFrozen(observer)).toBe(true);
    const answer = observer.session?.(SESSION);
    expect(Object.isFrozen(answer)).toBe(true);
  });
});

describe("feeding the store's sweep", () => {
  it("retires a session that was closed and never accepted, and keeps one that was accepted", () => {
    const { tracker, stateRoot } = world();
    tracker.record({ kind: "closed", threadId: THREAD, acceptedPrompt: false });
    tracker.record({ kind: "closed", threadId: THREAD_B, acceptedPrompt: true });
    const outcome = tracker.sweep(storeSweep(stateRoot));
    expect(outcome.report?.retired).toEqual([SESSION]);
    expect(outcome.report?.retained.map((r) => r.id)).toEqual([SESSION_B]);
    expect(outcome.problems).toEqual([]);
  });

  it("retires a session whose thread no longer exists, unless the Agent host already marked a prompt accepted", () => {
    const { tracker, stateRoot } = world();
    writeEnvelope(stateRoot, mainRecord(SESSION_B), { acceptedPrompt: true });
    tracker.record({ kind: "deleted", threadId: THREAD });
    tracker.record({ kind: "closed", threadId: THREAD_B, acceptedPrompt: false });
    const outcome = tracker.sweep(storeSweep(stateRoot));
    expect(outcome.report?.retired).toEqual([SESSION]);
    expect(outcome.report?.retained.map((r) => r.id)).toEqual([SESSION_B]);
  });

  it("retains everything when nothing is observed or the observation is unknown (the boot sweep with no seed)", () => {
    const { tracker, stateRoot } = world();
    const outcome = tracker.sweep(storeSweep(stateRoot));
    expect(outcome.report?.retired).toEqual([]);
    expect(outcome.report?.retained.map((r) => r.id).sort()).toEqual([SESSION, SESSION_B].sort());
    tracker.record({ kind: "closed", threadId: THREAD, acceptedPrompt: false });
    tracker.record({ kind: "unknown", threadId: THREAD });
    expect(tracker.sweep(storeSweep(stateRoot)).report?.retired).toEqual([]);
  });

  it("retires on a boot sweep that is seeded with T3's current facts", () => {
    const { tracker, stateRoot } = world();
    for (const event of [
      { kind: "closed", threadId: THREAD, acceptedPrompt: false },
      { kind: "running", threadId: THREAD_B },
    ] as const)
      tracker.record(event);
    const outcome = tracker.sweep(storeSweep(stateRoot));
    expect(outcome.report?.retired).toEqual([SESSION]);
    expect(outcome.report?.retained.map((r) => r.id)).toEqual([SESSION_B]);
  });

  it("expects stray records of T3's short-lived discovery processes: unbound, retained, listed, and never resolvable", () => {
    const { tracker, stateRoot, index } = world();
    writeEnvelope(stateRoot, mainRecord(STRAY));
    tracker.record({ kind: "closed", threadId: THREAD, acceptedPrompt: false });
    const outcome = tracker.sweep(storeSweep(stateRoot));
    expect(outcome.report?.retired).toEqual([SESSION]);
    expect(outcome.unbound).toEqual([STRAY]);
    expect(outcome.report?.retained.map((r) => r.id)).toContain(STRAY);
    expect(index.threadsOf(STRAY)).toEqual([]);
  });

  it("does not touch identity bytes: the tracker has no writer, only an answer for the store to use", () => {
    const { tracker, stateRoot } = world();
    const before = snapshot(NodePath.join(stateRoot, "identity"));
    tracker.record({ kind: "closed", threadId: THREAD, acceptedPrompt: false });
    tracker.observer().session?.(SESSION);
    tracker.sweep(storeSweep(stateRoot));
    expect(snapshot(NodePath.join(stateRoot, "identity"))).toEqual(before);
  });

  it("reports a sweep that throws, or returns something else, as a problem and retires nothing", () => {
    const { tracker } = world();
    expect(
      tracker.sweep(() => {
        throw new Error("store gone");
      }),
    ).toMatchObject({ report: null, problems: ["the sweep failed: store gone"] });
    expect(tracker.sweep((() => 7) as never)).toMatchObject({
      report: null,
      problems: ["the sweep returned no report"],
    });
  });
});
