// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
// AETHERIA M06 Plan steps 13-14 (D5, D17) — a session's resume reaches the interaction service, and an unclean drain keeps the owner lock.
//
// Boundary: (1) the real identity feed and the real resume signal over a real thread index; (2) the real Backend service (owner lock, ordered start,
// reverse drain) with the interaction service replaced by a recording fake, driven with stored events shaped like T3's `provider-session.attached`
// and `provider-thread.updated`. It shows: which T3 event counts as a resume (an attach after the replay horizon, on a bound thread), that history
// and unbound threads never trigger one, that a failing service call never reaches the feed, and that a drain that throws or leaves a waiter live is
// not a clean release (the lock file stays). It does NOT show that real T3 emits `provider-session.attached` on a resume (apps/server's native run
// does), nor the real interaction core's reconcile and redeliver rules (the archive suites).
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";

import type { HumanControlService } from "./humanControl.ts";
import { createIdentityFeed, type StoredEventLike } from "./identity/feed.ts";
import { createLifecycleTracker } from "./identity/lifecycle.ts";
import { createResumeSignal } from "./identity/resume.ts";
import { createThreadIndex } from "./identity/threadIndex.ts";
import {
  FOLDER,
  SESSION,
  THREAD,
  THREAD_B,
  mainRecord,
  rootOf,
  sessionFileOf,
  writeEnvelope,
} from "./identity/testkit.ts";
import { OWNER_LOCK_FILE } from "./ownerLock.ts";
import { createAetheriaBackendService } from "./service.ts";

const RUNTIME = "provider-session:provider-instance:pi:thread:t:abc";
let sequence = 1000;
const sessionEvent = (
  type: "provider-session.updated" | "provider-session.attached",
  threadId: string,
  status = "ready",
  at = ++sequence,
): StoredEventLike => ({
  sequence: at,
  event: {
    type,
    threadId,
    payload: { id: RUNTIME, providerInstanceId: "pi", status, cwd: FOLDER },
  },
});
const threadEvent = (threadId: string, sessionId: string): StoredEventLike => ({
  sequence: ++sequence,
  event: {
    type: "provider-thread.updated",
    threadId,
    payload: {
      driver: "pi",
      providerInstanceId: "pi",
      providerSessionId: RUNTIME,
      appThreadId: threadId,
      nativeThreadRef: { nativeId: sessionFileOf(sessionId) },
    },
  },
});

describe("the feed names a thread's attach to a provider session", () => {
  const build = () => {
    const stateRoot = rootOf();
    const index = createThreadIndex({ stateRoot, projectRootOf: (folder) => folder });
    const tracker = createLifecycleTracker({ index });
    const seen: Array<{ threadId: string; sequence: number }> = [];
    const feed = createIdentityFeed({
      index,
      tracker,
      credentialOf: () => "cred-1",
      onThreadAttached: (event) => seen.push(event),
    });
    return { feed, seen };
  };

  it("reports an attach with its thread and sequence, and nothing for an update, a stop or an error", async () => {
    const { feed, seen } = build();
    await feed.ingest(sessionEvent("provider-session.updated", THREAD));
    await feed.ingest(sessionEvent("provider-session.attached", THREAD, "stopped"));
    await feed.ingest(sessionEvent("provider-session.attached", THREAD, "error"));
    expect(seen).toEqual([]);
    await feed.ingest(sessionEvent("provider-session.attached", THREAD, "ready", 4242));
    expect(seen).toEqual([{ threadId: THREAD, sequence: 4242 }]);
  });

  it("is optional: a feed without the hook still maps an attach", async () => {
    const stateRoot = rootOf();
    const index = createThreadIndex({ stateRoot, projectRootOf: (folder) => folder });
    const feed = createIdentityFeed({
      index,
      tracker: createLifecycleTracker({ index }),
      credentialOf: () => "cred-1",
    });
    await expect(feed.ingest(sessionEvent("provider-session.attached", THREAD))).resolves.toEqual(
      [],
    );
  });
});

describe("the resume signal", () => {
  const target = () => {
    const calls: string[] = [];
    return {
      calls,
      value: {
        reconcileWaits: async (sessionId: string) => {
          calls.push(`reconcile:${sessionId}`);
        },
        redeliver: async (sessionId: string) => {
          calls.push(`redeliver:${sessionId}`);
        },
      },
    };
  };
  const signal = (
    options: {
      horizon?: number | undefined;
      sessionOf?: (threadId: string) => string | undefined;
      target?: ReturnType<typeof target>["value"] | undefined;
    } = {},
  ) =>
    createResumeSignal({
      sessionOf: options.sessionOf ?? ((threadId) => (threadId === THREAD ? SESSION : undefined)),
      target: () => options.target,
      horizon: () => ("horizon" in options ? options.horizon : 10),
    });

  it("reconciles the waits of the thread's Pi session, then redelivers to it, once per attach after the horizon", async () => {
    const t = target();
    await signal({ target: t.value }).attached({ threadId: THREAD, sequence: 11 });
    expect(t.calls).toEqual([`reconcile:${SESSION}`, `redeliver:${SESSION}`]);
  });

  it("treats history as history: an attach at or before the replay horizon, or before it is known, does nothing", async () => {
    const t = target();
    await signal({ target: t.value }).attached({ threadId: THREAD, sequence: 10 });
    await signal({ target: t.value }).attached({ threadId: THREAD, sequence: 3 });
    await signal({ target: t.value, horizon: undefined }).attached({
      threadId: THREAD,
      sequence: 11,
    });
    expect(t.calls).toEqual([]);
  });

  it("does nothing for a thread with no bound session, and while no service is running", async () => {
    const t = target();
    await signal({ target: t.value }).attached({ threadId: THREAD_B, sequence: 11 });
    await signal({ target: undefined }).attached({ threadId: THREAD, sequence: 11 });
    expect(t.calls).toEqual([]);
  });

  it("never throws: a failing reconcile does not stop the redelivery, and a failing redelivery is swallowed", async () => {
    const calls: string[] = [];
    const failing = {
      reconcileWaits: async () => {
        calls.push("reconcile");
        throw new Error("boom");
      },
      redeliver: async () => {
        calls.push("redeliver");
        throw new Error("boom");
      },
    };
    await expect(
      signal({ target: failing }).attached({ threadId: THREAD, sequence: 11 }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual(["reconcile", "redeliver"]);
  });
});

const fakeService = (overrides: Partial<HumanControlService> = {}) => {
  const calls: string[] = [];
  const service: HumanControlService = {
    start: async () => ({ ok: true, value: { continued: [] } }),
    create: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    verifyHumanOrigin: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }),
    awaitSegment: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    release: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    snapshot: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    answer: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    cancel: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    hold: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    close: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    decidePlan: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    getPlanMode: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    setPlanMode: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    grant: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    inheritPlanMode: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    createAuthorization: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    awaitInteraction: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    publishTasks: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    getTasks: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    canAccess: () => false,
    reconcileWaits: async (sessionId) => {
      calls.push(`reconcile:${sessionId}`);
      return { ok: true, value: { continued: [] } };
    },
    redeliver: async (sessionId) => {
      calls.push(`redeliver:${sessionId}`);
      return { ok: true, value: { delivered: [], failed: [], pending: [] } };
    },
    onChange: () => () => {},
    drain: async () => ({ released: [], stopped: [], transferred: [], stillLive: [] }),
    ...overrides,
  };
  return { service, calls };
};

const backend = (fake: HumanControlService) => {
  const stateRoot = rootOf();
  writeEnvelope(stateRoot, mainRecord(SESSION));
  const made = createAetheriaBackendService({
    stateRoot,
    credentialOf: () => "cred-1",
    projectRootOf: (folder) => folder,
    interactionFactory: () => fake,
  });
  if (made.outcome !== "prepared") throw new Error(`refused: ${JSON.stringify(made.faults)}`);
  return { stateRoot, service: made.service };
};

describe("a resumed session reaches the interaction service through the Backend's own event feed", () => {
  it("reconciles and redelivers for the bound session on an attach after the replay horizon, and not for history", async () => {
    const fake = fakeService();
    const w = backend(fake.service);
    expect((await w.service.start()).outcome).toBe("started");
    await w.service.ingest(sessionEvent("provider-session.updated", THREAD));
    await w.service.ingest(threadEvent(THREAD, SESSION));
    w.service.setReplayHorizon(2000);
    // History (an attach the replay already contained) comes first; the live attach after the horizon is a resume. The service handles events in
    // order, so calls made for history would precede the live attach's: exactly one reconcile-redeliver pair proves history made none.
    await w.service.ingest(sessionEvent("provider-session.attached", THREAD, "ready", 1999));
    await w.service.ingest(sessionEvent("provider-session.attached", THREAD, "ready", 2001));
    await vi.waitFor(() => expect(fake.calls.length).toBeGreaterThanOrEqual(2));
    expect(fake.calls).toEqual([`reconcile:${SESSION}`, `redeliver:${SESSION}`]);
    await w.service.dispose("test");
  });

  it("does not let a failing service reach the feed or the next event", async () => {
    const fake = fakeService({
      reconcileWaits: async () => {
        throw new Error("store unreadable");
      },
    });
    const w = backend(fake.service);
    await w.service.start();
    await w.service.ingest(sessionEvent("provider-session.updated", THREAD));
    await w.service.ingest(threadEvent(THREAD, SESSION));
    w.service.setReplayHorizon(2000);
    await expect(
      w.service.ingest(sessionEvent("provider-session.attached", THREAD, "ready", 2001)),
    ).resolves.toBeUndefined();
    await vi.waitFor(() => expect(fake.calls).toEqual([`redeliver:${SESSION}`]));
    await w.service.dispose("test");
  });
});

describe("a drain that is not clean keeps the owner lock (service dispose)", () => {
  const lockOf = (root: string) => NodePath.join(root, OWNER_LOCK_FILE);

  it("keeps the lock when the interaction drain throws, so a successor waits for the proven-dead takeover", async () => {
    const fake = fakeService({
      drain: async () => {
        throw new Error("journal write failed");
      },
    });
    const w = backend(fake.service);
    expect((await w.service.start()).outcome).toBe("started");
    const report = await w.service.dispose("server-teardown");
    expect(report.ok).toBe(false);
    expect(NodeFS.existsSync(lockOf(w.stateRoot))).toBe(true);
    // The successor over the same root is refused, not given a second writer.
    const next = createAetheriaBackendService({ stateRoot: w.stateRoot, credentialOf: () => "x" });
    if (next.outcome !== "prepared") throw new Error("must prepare");
    expect(await next.service.start()).toMatchObject({
      outcome: "refused",
      faults: [{ code: "state-root-owned" }],
    });
  });

  it("keeps the lock when a waiter is still live after the drain, and reports it", async () => {
    const fake = fakeService({
      drain: async () => ({
        released: [],
        stopped: [],
        transferred: [],
        stillLive: ["backend-interactions.wait:int-1"],
      }),
    });
    const w = backend(fake.service);
    await w.service.start();
    const report = await w.service.dispose("server-teardown");
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report.stillLive)).toContain("int-1");
    expect(NodeFS.existsSync(lockOf(w.stateRoot))).toBe(true);
  });

  it("releases the lock after a clean drain and reports one result for a repeated dispose", async () => {
    const fake = fakeService();
    const w = backend(fake.service);
    await w.service.start();
    const first = await w.service.dispose("server-teardown");
    const second = await w.service.dispose("again");
    expect(first.ok).toBe(true);
    expect(second).toBe(first);
    expect(NodeFS.existsSync(lockOf(w.stateRoot))).toBe(false);
  });
});
