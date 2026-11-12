// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M05 Plan step 9 (C2, C10) — the `orchestrationFactory` join over the INSTALLED orchestration archive.
//
// Boundary: the factory, the real children service of `@aetheria/orchestration/backend`, the real orchestration store and M03's real identity store (writer
// `managed-work`) in a scratch state root. SCRIPTED: T3 (the ChildThreadPort), the spawn authorizer's verdict, M06's inheritPlanMode and the caller-context port.
// Shows: spawn through the real service creates, binds, stages, activates, informs plan mode and releases once, in that order, and reports no id when a step
// fails; the caller comes from the context port and never from an argument; children.status's three-valued ownership; the fifteen unbuilt operations answer
// unavailable and touch nothing; boot closes crash residue, never closes a child whose route record proves a bound session, and never re-releases;
// parallel admission counts attempts in flight; drain ends the watchers and frees the store. Does NOT show real T3 services, Pi, or the Backend wiring (the
// native slice and aetheriaBackend tests do), and it is the same-process double case only: no process restart.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { ORCHESTRATION_OPERATIONS, type Xc6OperationContext } from "@t3tools/aetheria-contracts";

import { ORCHESTRATION_PINNED_ARTIFACT } from "./artifact.ts";
import { openOrchestrationStore, nodeStoreDeps } from "./library.ts";
import {
  createOrchestrationBackendRegistration,
  type OrchestrationOperation,
  type OrchestrationOutcome,
  type OrchestrationServiceDeps,
} from "./orchestration.ts";
import { createOrchestrationFactory, type CallerContextPort } from "./orchestrationFactory.ts";
import type {
  ChildLineageThread,
  ChildThreadPort,
  ChildTurnCompletedEvent,
} from "./orchestrationPorts.ts";
import type { SpawnAuthorization } from "./spawnAuthorizer.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});
const scratch = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m05-factory-"));
  roots.push(root);
  return root;
};

const MAIN = "main-session";
const CALLER_THREAD = "thread-main";
const ROOT_THREAD = "thread-root";

interface Fake {
  readonly port: ChildThreadPort;
  readonly calls: string[];
  readonly created: Array<Record<string, unknown>>;
  readonly closed: string[];
  readonly releases: string[];
  readonly activity: Map<string, "running" | "idle" | "unknown">;
  readonly subscriptions: Set<unknown>;
  emit(event: ChildTurnCompletedEvent): void;
  readonly requestedSessionIds: string[];
  readonly suppressed: string[];
  readonly forked: Array<{
    parentThreadId: string;
    sourcePoint: unknown;
    targetThreadId: string;
    piSessionId: string;
  }>;
  /** The Pi session a fork thread holds once its first turn has started (T3 makes the copy then, under the requested id). */
  readonly forkSessions: Map<string, string>;
  readonly lastRuns: Map<
    string,
    {
      runId: string;
      outcome: "completed" | "failed" | "interrupted" | "active";
      settledAt: string | null;
      errorText: string | null;
    }
  >;
  readonly results: Map<string, { status: "completed" | "failed" | "interrupted"; text: string }>;
  readonly turns: Array<{ threadId: string; content: string; delivery: string; messageId: string }>;
  failNext: { create?: boolean; release?: boolean; bindAs?: (chosen: string) => string };
}
function fakeThreads(): Fake {
  let counter = 0;
  const calls: string[] = [];
  const created: Array<Record<string, unknown>> = [];
  const closed: string[] = [];
  const releases: string[] = [];
  const activity = new Map<string, "running" | "idle" | "unknown">();
  const subscriptions = new Set<{
    scope: unknown;
    handler: (event: ChildTurnCompletedEvent) => void;
  }>();
  const failNext: Fake["failNext"] = {};
  const requestedSessionIds: string[] = [];
  const suppressed: string[] = [];
  const forked: Fake["forked"] = [];
  const forkSessions = new Map<string, string>();
  const lastRuns: Fake["lastRuns"] = new Map();
  const results = new Map<
    string,
    { status: "completed" | "failed" | "interrupted"; text: string }
  >();
  const turns: Array<{ threadId: string; content: string; delivery: string; messageId: string }> =
    [];
  const port: ChildThreadPort = {
    createChildThread: async (input) => {
      calls.push("create");
      if (failNext.create === true) return { ok: false, reason: "create-failed" };
      counter += 1;
      const threadId = `thread-child-${counter}`;
      created.push({ ...input, threadId });
      activity.set(threadId, "running");
      return {
        ok: true,
        threadId,
        lineage: {
          parentThreadId: input.parentThreadId,
          rootThreadId: ROOT_THREAD,
          relationshipToParent: "subagent",
        },
        heldMessageId: `held-${counter}`,
      };
    },
    // Pi opens the session with the id it was asked for; `bindAs` scripts a Pi that does not.
    bindChildSession: async ({ piSessionId }) => {
      calls.push("bind");
      requestedSessionIds.push(piSessionId);
      return { ok: true, piSessionId: failNext.bindAs?.(piSessionId) ?? piSessionId };
    },
    releaseFirstTurn: async ({ threadId }) => {
      calls.push("release");
      if (failNext.release === true) return { ok: false, reason: "delivery-unavailable" };
      releases.push(threadId);
      return { ok: true, accepted: true };
    },
    forkThread: async ({ parentThreadId, sourcePoint, targetThreadId, piSessionId }) => {
      calls.push("fork");
      forked.push({ parentThreadId, sourcePoint, targetThreadId, piSessionId });
      activity.set(targetThreadId, "idle");
      return { ok: true, threadId: targetThreadId };
    },
    withdrawForkRequest: async () => ({ ok: true, released: true }),
    startTurn: async ({ threadId, content, delivery, messageId }) => {
      calls.push("startTurn");
      // The fork thread's first turn makes the Pi session copy under the id the Backend asked for.
      const asked = forked.find((f) => f.targetThreadId === threadId);
      if (asked !== undefined) forkSessions.set(threadId, asked.piSessionId);
      turns.push({ threadId, content, delivery, messageId });
      return { ok: true, accepted: true, messageId };
    },
    interrupt: async ({ threadId }) => {
      calls.push("interrupt");
      if (activity.has(threadId)) activity.set(threadId, "idle");
      return { ok: true, accepted: true };
    },
    status: async ({ threadId }) => ({
      ok: true,
      status: { activity: activity.get(threadId) ?? "unknown", queued: 0, resident: true },
    }),
    subscribeTurnCompleted: (scope, handler) => {
      const entry = { scope, handler };
      subscriptions.add(entry);
      return { unsubscribe: () => void subscriptions.delete(entry) };
    },
    readDelegatedCompletion: async () => ({ ok: false, reason: "unavailable" }),
    readRestartNotes: async () => ({ ok: true, notes: [] }),
    readLastRun: async ({ threadId }) => ({ ok: true, run: lastRuns.get(threadId) ?? null }),
    // T3's receipt: found when a turn was accepted for this thread under this message id.
    readMessageReceipt: async ({ threadId, messageId }) => ({
      ok: true,
      found: turns.some((turn) => turn.threadId === threadId && turn.messageId === messageId),
    }),
    suppressCompletionDelivery: async ({ threadId }) => {
      calls.push("suppress");
      suppressed.push(threadId);
      return { ok: true, suppressed: true };
    },
    readChildResult: async ({ threadId }) => {
      const recorded = results.get(threadId);
      return recorded === undefined
        ? { ok: false, reason: "not-terminal" }
        : { ok: true, ...recorded };
    },
    close: async ({ threadId }) => {
      calls.push("close");
      closed.push(threadId);
      return { ok: true, closed: true };
    },
  };
  return {
    port,
    calls,
    created,
    closed,
    releases,
    activity,
    subscriptions,
    failNext,
    requestedSessionIds,
    suppressed,
    forked,
    forkSessions,
    lastRuns,
    results,
    turns,
    emit: (event) => {
      for (const entry of subscriptions) entry.handler(event);
    },
  };
}

const allowed: SpawnAuthorization = {
  ok: true,
  parent: { sessionId: MAIN, rootSessionId: MAIN, parentChain: [] },
  child: { authoritySource: "role", role: "reader", roleOrigin: "checkout", roleDigest: null },
  routes: [{ provider: "p1", model: "m1" }],
  runtimeMode: "full-access",
  interactionMode: "default",
};

interface World {
  readonly stateRoot: string;
  readonly fake: Fake;
  readonly deps: OrchestrationServiceDeps;
  readonly lineage: { threads: ChildLineageThread[]; unavailable: boolean };
  readonly planModeCalls: string[];
  readonly authorizerSeen: Array<{ callerSessionId: string; workingFolder: string }>;
  readonly options: { planModeFails: boolean; verdict: SpawnAuthorization };
  readonly identityAtCreate: string[][];
}
function world(stateRoot = scratch()): World {
  const fake = fakeThreads();
  const lineage = { threads: [] as ChildLineageThread[], unavailable: false };
  const planModeCalls: string[] = [];
  const authorizerSeen: World["authorizerSeen"] = [];
  const options = { planModeFails: false, verdict: allowed };
  // What the identity folder held when each thread was created: the child's record must already be there.
  const identityAtCreate: string[][] = [];
  const create = fake.port.createChildThread;
  fake.port.createChildThread = async (input) => {
    const folder = NodePath.join(stateRoot, "identity");
    identityAtCreate.push(
      NodeFS.existsSync(folder)
        ? NodeFS.readdirSync(folder).filter((name) => name.endsWith(".json"))
        : [],
    );
    return create(input);
  };
  const deps: OrchestrationServiceDeps = {
    stateRoot,
    now: () => 1_700_000_000_000,
    threads: fake.port,
    planMode: {
      inheritPlanMode: async (parent, child, kind) => {
        planModeCalls.push(`${parent}>${child}:${kind}`);
        return options.planModeFails
          ? { ok: false, code: "INTERACTION_UNAVAILABLE" }
          : { ok: true };
      },
    },
    resume: { resumed: async () => undefined },
    sessionOfThread: (threadId) =>
      threadId === CALLER_THREAD
        ? MAIN
        : threadId.startsWith("thread-fork")
          ? fake.forkSessions.get(threadId)
          : threadId.startsWith("thread-child")
            ? `pi-${threadId}`
            : undefined,
    threadOfSession: (sessionId) =>
      sessionId === MAIN
        ? CALLER_THREAD
        : ([...fake.forkSessions].find(([, session]) => session === sessionId)?.[0] ??
          (sessionId.startsWith("pi-") ? sessionId.slice(3) : undefined)),
    lineageSessionOf: () => "unknown",
    spawnAuthorizer: {
      authorize: async (input) => {
        authorizerSeen.push({
          callerSessionId: input.callerSessionId,
          workingFolder: input.workingFolder,
        });
        return options.verdict;
      },
      authorizeFork: async (input) => {
        authorizerSeen.push({
          callerSessionId: input.callerSessionId,
          workingFolder: input.workingFolder,
        });
        if (!options.verdict.ok) return options.verdict;
        return {
          ...options.verdict,
          child: {
            authoritySource: "spawn-explicit" as const,
            role: null,
            roleOrigin: null,
            roleDigest: null,
            explicitAllow: [...input.allow],
          },
        };
      },
    },
    lineage: {
      listChildThreads: async () =>
        lineage.unavailable
          ? { ok: false, reason: "unavailable" }
          : { ok: true, threads: lineage.threads },
    },
  };
  return {
    stateRoot,
    fake,
    deps,
    lineage,
    planModeCalls,
    authorizerSeen,
    options,
    identityAtCreate,
  };
}

const callerOk: CallerContextPort = async (sessionId) =>
  sessionId === MAIN
    ? {
        ok: true,
        threadId: CALLER_THREAD,
        runId: "run-active",
        nodeId: "node-active",
        workingFolder: "/work/project",
      }
    : { ok: false, detail: "the session is not bound to a thread" };

const who = { sessionId: MAIN, rootSessionId: MAIN, kind: "main" };
const SPAWN = { role: "reader", prompt: "do the task", mode: "one-shot" } as const;

async function started(
  w: World,
  callerContext: CallerContextPort = callerOk,
  extra: Partial<Parameters<typeof createOrchestrationFactory>[0]> = {},
) {
  const boots: unknown[] = [];
  let n = 0;
  let m = 0;
  const service = createOrchestrationFactory({
    callerContext,
    ...extra,
    onBoot: (report) => boots.push(report),
    newAttemptId: () => `attempt-${++n}`,
    newSessionId: () => `pi-thread-child-${++m}`,
  })(w.deps);
  const result = await service.start();
  expect(result).toEqual({ ok: true });
  return { service, boots };
}
const ok = (outcome: OrchestrationOutcome) => {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  return (outcome as { value: Record<string, unknown> }).value;
};

describe("children.spawn through the real children service", () => {
  it("creates, binds, stages, activates, informs plan mode and releases once, in that order, for the carrier's caller", async () => {
    const w = world();
    const { service } = await started(w);
    const value = ok(await service.handle("children.spawn", who, SPAWN));
    expect(value).toMatchObject({ childId: "thread-child-1", route: 1, allRoutesOut: false });
    expect(w.fake.calls).toEqual(["create", "bind", "release"]);
    // The identity is already active under the chosen id when the thread is created (native round 3), and Pi is asked to open the session with that id.
    expect(w.identityAtCreate).toEqual([["pi-thread-child-1.json"]]);
    expect(w.fake.requestedSessionIds).toEqual(["pi-thread-child-1"]);
    expect(w.planModeCalls).toEqual([`${MAIN}>pi-thread-child-1:spawn`]);
    // The parent run and node and the working folder come from the context port, never from the arguments.
    expect(w.fake.created[0]).toMatchObject({
      parentThreadId: CALLER_THREAD,
      parentRunId: "run-active",
      parentNodeId: "node-active",
      workingFolder: "/work/project",
      task: "do the task",
      completionWake: "always",
    });
    expect(w.authorizerSeen).toEqual([{ callerSessionId: MAIN, workingFolder: "/work/project" }]);
    // The identity is M03's, active, a child of the caller's root, and the route state says the spawn was accepted.
    const identityFile = NodePath.join(w.stateRoot, "identity", "pi-thread-child-1.json");
    expect(NodeFS.existsSync(identityFile)).toBe(true);
    const envelope = JSON.parse(NodeFS.readFileSync(identityFile, "utf8"));
    expect(envelope).toMatchObject({
      state: "active",
      writer: "managed-work",
      acceptedPrompt: true,
      record: {
        sessionId: "pi-thread-child-1",
        kind: "child",
        rootSessionId: MAIN,
        role: "reader",
      },
    });
    expect(NodeFS.existsSync(NodePath.join(w.stateRoot, "orchestration"))).toBe(true);
    await service.drain();
    const reopened = openOrchestrationStore(nodeStoreDeps(), { stateRoot: w.stateRoot });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const record = reopened.store.readChild("thread-child-1");
    expect(record).toMatchObject({ status: "ok", record: { phase: "accepted", closed: false } });
    reopened.store.close();
  });

  it("answers unavailable and creates nothing when the caller's context cannot be read", async () => {
    const w = world();
    const { service } = await started(w);
    const stranger = { sessionId: "stranger", rootSessionId: "stranger", kind: "main" };
    const outcome = await service.handle("children.spawn", stranger, SPAWN);
    expect(outcome).toMatchObject({ ok: false, code: "ORCHESTRATION_UNAVAILABLE" });
    expect(w.fake.calls).toEqual([]);
    const throwing = await started(world(), async () => {
      throw new Error("projection unreadable");
    });
    expect(await throwing.service.handle("children.spawn", who, SPAWN)).toMatchObject({
      ok: false,
      code: "ORCHESTRATION_UNAVAILABLE",
    });
  });

  it("returns the authorizer's refusal code unchanged and creates nothing", async () => {
    const w = world();
    w.options.verdict = { ok: false, code: "AUTH_TOOL_NOT_ALLOWED", reason: "not allowed" };
    const { service } = await started(w);
    expect(await service.handle("children.spawn", who, SPAWN)).toMatchObject({
      ok: false,
      code: "AUTH_TOOL_NOT_ALLOWED",
    });
    expect(w.fake.calls).toEqual([]);
  });

  it("a plan-mode failure before release leaves no id, no prompt, a closed thread and a retired identity", async () => {
    const w = world();
    w.options.planModeFails = true;
    const { service } = await started(w);
    const outcome = await service.handle("children.spawn", who, SPAWN);
    expect(outcome).toMatchObject({ ok: false, code: "CHILD_START_FAILED" });
    expect(outcome).not.toHaveProperty("value");
    expect(w.fake.calls).toEqual(["create", "bind", "close"]);
    expect(w.fake.releases).toEqual([]);
    expect(w.fake.closed).toEqual(["thread-child-1"]);
    const envelope = JSON.parse(
      NodeFS.readFileSync(NodePath.join(w.stateRoot, "identity", "pi-thread-child-1.json"), "utf8"),
    );
    expect(envelope.state).toBe("retired");
    expect(envelope.acceptedPrompt).toBe(false);
  });

  it("a refused release is rolled back too: no id, the thread closed", async () => {
    const w = world();
    w.fake.failNext.release = true;
    const { service } = await started(w);
    expect(await service.handle("children.spawn", who, SPAWN)).toMatchObject({
      ok: false,
      code: "CHILD_START_FAILED",
      cause: "release-failed",
    });
    expect(w.fake.releases).toEqual([]);
    expect(w.fake.closed).toEqual(["thread-child-1"]);
  });

  it("a Pi that opens another session than the one asked for is rolled back: thread closed, the chosen record retired, no release, no identity for the other id", async () => {
    const w = world();
    w.fake.failNext.bindAs = () => "pi-some-other-session";
    const { service } = await started(w);
    const outcome = await service.handle("children.spawn", who, SPAWN);
    expect(outcome).toMatchObject({
      ok: false,
      code: "CHILD_START_FAILED",
      cause: "session-id-mismatch",
    });
    expect(w.fake.releases).toEqual([]);
    expect(w.fake.closed).toEqual(["thread-child-1"]);
    const read = (id: string) =>
      JSON.parse(NodeFS.readFileSync(NodePath.join(w.stateRoot, "identity", `${id}.json`), "utf8"));
    expect(read("pi-thread-child-1").state).toBe("retired");
    expect(
      NodeFS.existsSync(NodePath.join(w.stateRoot, "identity", "pi-some-other-session.json")),
    ).toBe(false);
  });

  it("parallel attempts see each other: the admission limit is exact and nothing queues", async () => {
    const w = world();
    const { service } = await started(w);
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => service.handle("children.spawn", who, SPAWN)),
    );
    const accepted = outcomes.filter((outcome) => outcome.ok);
    const limited = outcomes.filter((outcome) => !outcome.ok && outcome.code === "CHILD_LIMIT");
    expect(accepted).toHaveLength(4);
    expect(limited).toHaveLength(2);
    expect(w.fake.releases).toHaveLength(4);
    expect(new Set(w.fake.created.map((input) => input.threadId)).size).toBe(4);
  });

  it("settles a child from T3's terminal run once, whatever the number of deliveries", async () => {
    const w = world();
    const { service } = await started(w);
    ok(await service.handle("children.spawn", who, SPAWN));
    expect(w.fake.subscriptions.size).toBe(1);
    const event: ChildTurnCompletedEvent = {
      threadId: "thread-child-1",
      turnId: "run-child-1",
      outcome: "completed",
      settledAt: "2026-11-12T10:00:00.000Z",
    };
    w.fake.emit(event);
    w.fake.emit(event);
    await service.drain();
    const reopened = openOrchestrationStore(nodeStoreDeps(), { stateRoot: w.stateRoot });
    if (!reopened.ok) throw new Error("store did not reopen");
    const read = reopened.store.readChild("thread-child-1");
    expect(read).toMatchObject({
      status: "ok",
      record: { settle: { settleSeq: 1, status: "completed", lastTurnId: "run-child-1" } },
    });
    reopened.store.close();
  });
});

describe("children.status", () => {
  it("is owned and live for the caller's own child, owned false for another root's child, false for a session without a record", async () => {
    const w = world();
    const { service } = await started(w);
    ok(await service.handle("children.spawn", who, SPAWN));
    expect(
      ok(await service.handle("children.status", who, { childSessionId: "pi-thread-child-1" })),
    ).toEqual({ owned: true, state: "running" });
    w.fake.activity.set("thread-child-1", "idle");
    expect(
      ok(await service.handle("children.status", who, { childSessionId: "pi-thread-child-1" })),
    ).toEqual({ owned: true, state: "idle" });
    w.fake.activity.set("thread-child-1", "unknown");
    expect(
      ok(await service.handle("children.status", who, { childSessionId: "pi-thread-child-1" })),
    ).toEqual({ owned: true, state: "unknown" });
    const other = { sessionId: "other-main", rootSessionId: "other-main", kind: "main" };
    expect(
      ok(await service.handle("children.status", other, { childSessionId: "pi-thread-child-1" })),
    ).toEqual({ owned: false, state: "unknown" });
    expect(
      ok(await service.handle("children.status", who, { childSessionId: "pi-no-such-session" })),
    ).toEqual({ owned: false, state: "unknown" });
  });

  it("is unknown, never false, when the identity record cannot be read, and unknown state when the thread is not bound", async () => {
    const w = world();
    const { service } = await started(w);
    ok(await service.handle("children.spawn", who, SPAWN));
    const file = NodePath.join(w.stateRoot, "identity", "pi-thread-child-1.json");
    NodeFS.writeFileSync(file, "{ damaged");
    expect(
      ok(await service.handle("children.status", who, { childSessionId: "pi-thread-child-1" })),
    ).toEqual({ owned: "unknown", state: "unknown" });
  });
});

describe("the operations that are not built", () => {
  const built = [
    "children.spawn",
    "children.status",
    "children.message",
    "children.list",
    "children.interrupt",
    "children.close",
    "children.await-report",
    "children.cancel",
    "children.fork",
    "jobs.reserve",
    "jobs.attach",
    "jobs.adopted",
    "jobs.exited",
  ];
  const unbuilt = ORCHESTRATION_OPERATIONS.filter((name) => !built.includes(name));
  it("are four (the jobs operations of steps 17 and 18) and each answers ORCHESTRATION_UNAVAILABLE without touching T3", async () => {
    expect(unbuilt).toHaveLength(4);
    const w = world();
    const { service } = await started(w);
    for (const name of unbuilt) {
      const outcome = await service.handle(name as OrchestrationOperation, who, {});
      expect(outcome, name).toMatchObject({ ok: false, code: "ORCHESTRATION_UNAVAILABLE" });
    }
    expect(w.fake.calls).toEqual([]);
  });

  it("reach the wire as the XC-6 `unavailable` reply, and spawn as `done`", async () => {
    const w = world();
    const registration = createOrchestrationBackendRegistration({
      create: () => createOrchestrationFactory({ callerContext: callerOk })(w.deps),
    });
    await registration.activation.start({ id: "orchestration-backend" });
    const context = (args: Record<string, unknown>): Xc6OperationContext => ({
      caller: { threadId: CALLER_THREAD, providerSessionId: "cred", providerInstanceId: "pi" },
      sessionId: MAIN,
      kind: "main",
      rootSessionId: MAIN,
      args,
    });
    const operations = registration.operations ?? {};
    expect(await operations["jobs.list"]!(context({ scope: "own" }))).toMatchObject({
      status: "unavailable",
      code: "ORCHESTRATION_UNAVAILABLE",
    });
    expect(await operations["children.spawn"]!(context({ ...SPAWN }))).toMatchObject({
      status: "done",
    });
    await registration.activation.drain("test");
  });
});

describe("the job lifecycle operations (step 16)", () => {
  const RUN = "0197d3c0-aaaa-4000-8000-00000000beef";
  const host = (over: Record<string, unknown> = {}) => ({
    startTime: async () => "Thu Nov 12 10:00:00 2026",
    probeGroup: () => ({ state: "live" as const }),
    inspectRun: async () => ({ ok: true as const }),
    ...over,
  });
  const identity = { pid: 4242, startTime: "Thu Nov 12 10:00:00 2026" };

  it("carries reserve, attach, adopted and exited for the carrier's caller, writes jobs/<id>/record.json, and records one completion entry", async () => {
    const w = world();
    let n = 0;
    const { service } = await started(w, callerOk, {
      hostProcess: host(),
      newJobId: () => `job-${++n}`,
    });
    const reserved = ok(
      await service.handle("jobs.reserve", who, {
        runKey: RUN,
        label: "npm test",
        mode: "background",
      }),
    );
    expect(reserved).toEqual({ jobId: "job-1", state: "starting" });
    const file = NodePath.join(w.stateRoot, "jobs", "job-1", "record.json");
    expect(JSON.parse(NodeFS.readFileSync(file, "utf8"))).toMatchObject({
      ownerSessionId: MAIN,
      rootSessionId: MAIN,
      runKey: RUN,
      output: RUN,
      state: "starting",
      pid: null,
    });
    expect(
      ok(
        await service.handle("jobs.attach", who, {
          jobId: "job-1",
          pid: 4242,
          pgid: 4242,
          startIdentity: identity,
        }),
      ),
    ).toEqual({ jobId: "job-1", attached: true });
    expect(JSON.parse(NodeFS.readFileSync(file, "utf8"))).toMatchObject({
      state: "running",
      pid: 4242,
    });
    expect(
      ok(await service.handle("jobs.adopted", who, { jobId: "job-1", via: "background" })),
    ).toEqual({ jobId: "job-1", confirmation: "adopted:job-1" });
    expect(
      ok(
        await service.handle("jobs.exited", who, {
          jobId: "job-1",
          exit: { code: 0, signal: null },
        }),
      ),
    ).toEqual({ jobId: "job-1", recorded: true, supplemental: false });
    const record = JSON.parse(NodeFS.readFileSync(file, "utf8"));
    expect(record).toMatchObject({ state: "exited", exit: { code: 0, signal: null } });
    expect(record.outbox.map((e: { key: string; state: string }) => [e.key, e.state])).toEqual([
      ["job:job-1:completion", "pending"],
    ]);
    expect(w.fake.calls).toEqual([]);
    await service.drain();
  });

  it("answers a foreign owner as not found, a mismatching attach as an identity mismatch, and leaves the file unchanged", async () => {
    const w = world();
    const { service } = await started(w, callerOk, {
      hostProcess: host({ startTime: async () => "Fri Nov 13 00:00:00 2026" }),
      newJobId: () => "job-1",
    });
    ok(await service.handle("jobs.reserve", who, { runKey: RUN, label: "x", mode: "foreground" }));
    const file = NodePath.join(w.stateRoot, "jobs", "job-1", "record.json");
    const bytes = NodeFS.readFileSync(file, "utf8");
    const mismatch = await service.handle("jobs.attach", who, {
      jobId: "job-1",
      pid: 4242,
      pgid: 4242,
      startIdentity: identity,
    });
    expect(mismatch).toMatchObject({ ok: false, code: "JOB_IDENTITY_MISMATCH" });
    const stranger = { sessionId: "other-session", rootSessionId: "other-session", kind: "main" };
    const foreign = await service.handle("jobs.adopted", stranger, {
      jobId: "job-1",
      via: "background",
    });
    expect(foreign).toMatchObject({ ok: false, code: "JOB_NOT_FOUND" });
    expect(NodeFS.readFileSync(file, "utf8")).toBe(bytes);
    await service.drain();
  });

  it("a store that cannot be written answers ORCHESTRATION_UNAVAILABLE for a reserve and records nothing", async () => {
    const w = world();
    const { service } = await started(w, callerOk, { hostProcess: host() });
    NodeFS.chmodSync(NodePath.join(w.stateRoot, "jobs"), 0o500);
    try {
      expect(
        await service.handle("jobs.reserve", who, { runKey: RUN, label: "x", mode: "background" }),
      ).toMatchObject({ ok: false, code: "ORCHESTRATION_UNAVAILABLE" });
    } finally {
      NodeFS.chmodSync(NodePath.join(w.stateRoot, "jobs"), 0o700);
    }
    expect(
      NodeFS.readdirSync(NodePath.join(w.stateRoot, "jobs")).filter((name) => name !== "FORMAT"),
    ).toEqual([]);
    await service.drain();
  });
});

/** M03's `main` record as the Agent host writes it for the caller's session: the control operations read the caller's own identity too. */
const writeMainRecord = (stateRoot: string, sessionId: string) => {
  NodeFS.mkdirSync(NodePath.join(stateRoot, "identity"), { recursive: true, mode: 0o700 });
  NodeFS.writeFileSync(
    NodePath.join(stateRoot, "identity", `${sessionId}.json`),
    JSON.stringify({
      formatVersion: 1,
      state: "active",
      attemptId: `main-${sessionId}`,
      writer: "agent-host",
      acceptedPrompt: true,
      record: {
        sessionId,
        kind: "main",
        rootSessionId: sessionId,
        parentChain: [],
        role: null,
        roleOrigin: null,
        roleDigest: null,
        authoritySource: "main",
      },
    }),
    { mode: 0o600 },
  );
};

describe("the control operations (step 10) through the factory", () => {
  const childRow = (): ChildLineageThread => ({
    threadId: "thread-child-1",
    parentThreadId: CALLER_THREAD,
    rootThreadId: ROOT_THREAD,
    relationshipToParent: "subagent",
    sessionId: "pi-thread-child-1",
    closed: false,
  });

  it("message, list, interrupt and status run in the real service with the carrier's caller only", async () => {
    const w = world();
    writeMainRecord(w.stateRoot, MAIN);
    const { service } = await started(w);
    ok(
      await service.handle("children.spawn", who, { ...SPAWN, mode: "continuable", label: "scan" }),
    );
    w.lineage.threads = [childRow()];
    w.fake.activity.set("thread-child-1", "idle");

    const listed = ok(await service.handle("children.list", who, { scope: "children" }));
    expect(listed).toEqual({
      rows: [
        {
          childId: "thread-child-1",
          parentId: CALLER_THREAD,
          depth: 1,
          role: "reader",
          mode: "continuable",
          label: "scan",
          state: "idle",
          lastOutcome: null,
          route: 1,
        },
      ],
      diagnostics: [],
    });

    const sent = ok(
      await service.handle("children.message", who, { target: "thread-child-1", content: "next" }),
    );
    expect(w.fake.turns).toEqual([
      {
        threadId: "thread-child-1",
        content: "next",
        delivery: "queue",
        messageId: sent["messageId"],
      },
    ]);
    w.fake.activity.set("thread-child-1", "running");
    ok(
      await service.handle("children.message", who, { target: "thread-child-1", content: "more" }),
    );
    expect(w.fake.turns.at(-1)?.delivery).toBe("steer");

    expect(
      ok(await service.handle("children.interrupt", who, { target: "thread-child-1" })),
    ).toEqual({
      accepted: true,
    });
    expect(
      ok(await service.handle("children.status", who, { childSessionId: "pi-thread-child-1" })),
    ).toEqual({ owned: true, state: "idle" });
  });

  it("a record-only child is suppressed before release, its report is stored when it settles and awaited through the factory; children.cancel ends only that wait", async () => {
    const w = world();
    writeMainRecord(w.stateRoot, MAIN);
    const { service } = await started(w);
    ok(
      await service.handle("children.spawn", who, {
        ...SPAWN,
        mode: "one-shot",
        delivery: "record-only",
      }),
    );
    expect(w.fake.suppressed).toEqual(["thread-child-1"]);
    expect(w.fake.calls).toEqual(["create", "suppress", "bind", "release"]);
    const controller = new AbortController();
    const waiting = service.handle(
      "children.await-report",
      who,
      { target: "thread-child-1", requestId: "r1" },
      { signal: controller.signal },
    );
    const cancelled = service.handle("children.await-report", who, {
      target: "thread-child-1",
      requestId: "r2",
    });
    expect(await service.handle("children.cancel", who, { requestId: "r2" })).toEqual({
      ok: true,
      value: { accepted: true },
    });
    expect(await cancelled).toMatchObject({ ok: false, code: "ABORTED" });
    w.fake.results.set("thread-child-1", { status: "completed", text: "the report" });
    w.fake.emit({
      threadId: "thread-child-1",
      turnId: "run-1",
      outcome: "completed",
      settledAt: "2026-11-12T10:00:00.000Z",
    });
    // Settles reach the service through the watch the factory makes on the child's root.
    expect(await waiting).toEqual({
      ok: true,
      value: { status: "completed", text: "the report", route: 1 },
    });
    expect(
      await service.handle("children.await-report", who, { target: "thread-child-1" }),
    ).toEqual({ ok: true, value: { status: "completed", text: "the report", route: 1 } });
    const stranger = { sessionId: "other-main", rootSessionId: "other-main", kind: "main" };
    expect(
      await service.handle("children.await-report", stranger, { target: "thread-child-1" }),
    ).toMatchObject({ ok: false, code: "ORCHESTRATION_UNAVAILABLE" });
    controller.abort();
  });

  it("children.close stops that one thread through T3, closes the record, is idempotent and refuses a stranger", async () => {
    const w = world();
    writeMainRecord(w.stateRoot, MAIN);
    writeMainRecord(w.stateRoot, "other-main");
    const { service } = await started(w);
    ok(await service.handle("children.spawn", who, { ...SPAWN, mode: "continuable" }));
    w.lineage.threads = [childRow()];
    const other = { sessionId: "other-main", rootSessionId: "other-main", kind: "main" };
    expect(
      await service.handle("children.close", other, { target: "thread-child-1" }),
    ).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    expect(w.fake.closed).toEqual([]);
    const closed = ok(await service.handle("children.close", who, { target: "thread-child-1" }));
    expect(closed).toEqual({ closed: true, killedJobs: [] });
    expect(w.fake.closed).toEqual(["thread-child-1"]);
    expect(ok(await service.handle("children.close", who, { target: "thread-child-1" }))).toEqual(
      closed,
    );
    expect(w.fake.closed).toEqual(["thread-child-1"]);
    expect(
      await service.handle("children.message", who, { target: "thread-child-1", content: "x" }),
    ).toMatchObject({ ok: false, code: "CHILD_NOT_RESUMABLE" });
    expect(
      ok(await service.handle("children.status", who, { childSessionId: "pi-thread-child-1" })),
    ).toEqual({ owned: true, state: "closed" });
  });

  it("a stranger session and a forged target get the refusals, and the arguments can name no caller", async () => {
    const w = world();
    writeMainRecord(w.stateRoot, MAIN);
    writeMainRecord(w.stateRoot, "other-main");
    const { service } = await started(w);
    ok(await service.handle("children.spawn", who, SPAWN));
    w.fake.activity.set("thread-child-1", "idle");
    const other = { sessionId: "other-main", rootSessionId: "other-main", kind: "main" };
    expect(
      await service.handle("children.message", other, { target: "thread-child-1", content: "x" }),
    ).toMatchObject({ ok: false, code: "CHILD_NOT_OWNED" });
    expect(
      await service.handle("children.interrupt", other, { target: "thread-child-1" }),
    ).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    expect(w.fake.turns).toEqual([]);
    // The module's strict decoders refuse caller-claiming keys before the service runs (orchestration.aetheria.test.ts); through the wire a forged `sessionId` throws.
    await service.drain();
    const registration = createOrchestrationBackendRegistration({
      create: () => createOrchestrationFactory({ callerContext: callerOk })(w.deps),
    });
    await registration.activation.start({ id: "orchestration-backend" });
    expect(() =>
      registration.operations?.["children.message"]?.({
        caller: { threadId: CALLER_THREAD, providerSessionId: "c", providerInstanceId: "pi" },
        sessionId: MAIN,
        kind: "main",
        rootSessionId: MAIN,
        args: { target: "thread-child-1", content: "x", sessionId: "other-main" },
      }),
    ).toThrow();
    await registration.activation.drain("test");
  });
});

describe("the direct Backend API (step 14)", () => {
  const module = { kind: "backend-module", module: "m07-goals" } as const;

  it("is available only while the service runs, admits a turn to an idle main session once per key, and is not an XC-6 operation", async () => {
    const w = world();
    writeMainRecord(w.stateRoot, MAIN);
    const { service } = await started(w);
    const direct = service.direct();
    expect(direct).toBeDefined();
    expect(ORCHESTRATION_OPERATIONS.some((name) => /admit|settled/i.test(name))).toBe(false);
    w.fake.activity.set(CALLER_THREAD, "idle");
    const request = {
      authority: module,
      sessionId: MAIN,
      origin: { kind: "goal-round" },
      content: "next",
      key: "k1",
    };
    const first = await direct!.admitTurn(request);
    expect(first).toMatchObject({ status: "admitted" });
    w.fake.activity.set(CALLER_THREAD, "idle");
    expect(await direct!.admitTurn(request)).toEqual(first);
    expect(w.fake.turns.filter((t) => t.threadId === CALLER_THREAD)).toHaveLength(1);
    expect(
      await direct!.admitTurn({ ...request, authority: { kind: "model" }, key: "k2" }),
    ).toEqual({ status: "refused", reason: "unauthorized" });
    const events: unknown[] = [];
    const sub = direct!.subscribeSettled({
      authority: module,
      scope: { sessionId: MAIN },
      handler: (event) => void events.push(event),
    });
    expect(sub.status).toBe("subscribed");
    w.fake.emit({
      threadId: CALLER_THREAD,
      turnId: "run-1",
      outcome: "completed",
      settledAt: "2026-11-12T10:00:00.000Z",
    });
    expect(events).toMatchObject([
      { sessionId: MAIN, settleSeq: 1, runId: "run-1", outcome: "completed" },
    ]);
    await service.drain();
    expect(service.direct()).toBeUndefined();
  });
});

describe("children.fork through the factory (step 11)", () => {
  const forkArgs = { prefix: "all", prompt: "carry on from here", allow: ["read", "grep"] };
  const withThreads = (n: { value: number } = { value: 0 }) => ({
    newThreadId: () => `thread-fork-${++n.value}`,
  });

  it("registers the copy as an owned continuable child for the carrier's caller: copy, then identity, then plan mode, then the prompt", async () => {
    const w = world();
    writeMainRecord(w.stateRoot, MAIN);
    const { service } = await started(w, callerOk, withThreads());
    const value = ok(await service.handle("children.fork", who, forkArgs));
    expect(value).toEqual({ childId: "thread-fork-1" });
    expect(w.fake.forked).toEqual([
      {
        parentThreadId: CALLER_THREAD,
        sourcePoint: "latest_stable",
        targetThreadId: "thread-fork-1",
        piSessionId: expect.any(String),
      },
    ]);
    // The session id was chosen BEFORE the fork thread existed and handed to the port; the copy T3 makes at the first turn carries it.
    const chosen = w.fake.forked[0]!.piSessionId;
    expect(w.fake.forkSessions.get("thread-fork-1")).toBe(chosen);
    expect(w.fake.calls).toEqual(["fork", "startTurn"]);
    expect(w.planModeCalls).toEqual([`${MAIN}>${chosen}:fork`]);
    const identity = JSON.parse(
      NodeFS.readFileSync(NodePath.join(w.stateRoot, "identity", `${chosen}.json`), "utf8"),
    );
    expect(identity.record).toMatchObject({
      kind: "child",
      authoritySource: "spawn-explicit",
      role: null,
      explicitAllow: ["read", "grep"],
      parentChain: [MAIN],
    });
    expect(w.fake.turns.map((t) => [t.threadId, t.content])).toEqual([
      ["thread-fork-1", "carry on from here"],
    ]);
    expect(
      ok(await service.handle("children.status", who, { childSessionId: chosen })),
    ).toMatchObject({ owned: true });
  });

  it("a parent run id is the run source point; a widened list is refused before any copy; a failed first prompt is FORK_PARTIAL step 3 with the session named", async () => {
    const w = world();
    writeMainRecord(w.stateRoot, MAIN);
    const { service } = await started(w, callerOk, withThreads());
    ok(await service.handle("children.fork", who, { ...forkArgs, prefix: { runId: "run-3" } }));
    expect(w.fake.forked[0]?.sourcePoint).toEqual({ run: "run-3" });
    const before = w.fake.forked.length;
    expect(
      await service.handle("children.fork", who, { ...forkArgs, allow: ["read", "workflow"] }),
    ).toMatchObject({ ok: false, code: "AUTH_TOOL_NOT_ALLOWED" });
    expect(w.fake.forked).toHaveLength(before);
    const failing = world();
    writeMainRecord(failing.stateRoot, MAIN);
    failing.fake.port.startTurn = async () => ({ ok: false, reason: "delivery-unavailable" });
    const second = await started(failing, callerOk, withThreads());
    expect(await second.service.handle("children.fork", who, forkArgs)).toMatchObject({
      ok: false,
      code: "FORK_PARTIAL",
      forkSessionId: failing.fake.forked[0]?.piSessionId,
      registered: false,
      step: 3,
    });
    expect(failing.fake.closed).toEqual(["thread-fork-1"]);
  });
});

describe("restart reconciliation of a cut child (step 13)", () => {
  const childRow = (): ChildLineageThread => ({
    threadId: "thread-child-1",
    parentThreadId: CALLER_THREAD,
    rootThreadId: ROOT_THREAD,
    relationshipToParent: "subagent",
    sessionId: "pi-thread-child-1",
    closed: false,
  });

  it("a child whose run T3 cut is settled interrupted / backend-restarted at start, takes a message, and its notice is an OUTBOX entry: held while the parent cannot take it, then delivered once under its key", async () => {
    const w = world();
    writeMainRecord(w.stateRoot, MAIN);
    const first = await started(w);
    ok(await first.service.handle("children.spawn", who, { ...SPAWN, mode: "continuable" }));
    await first.service.drain();
    // The restart: T3 cut the run and went idle; the Backend starts again over the same state root. The parent's status cannot be read yet (unknown), so the notice is held.
    w.lineage.threads = [childRow()];
    w.fake.activity.set("thread-child-1", "idle");
    w.fake.lastRuns.set("thread-child-1", {
      runId: "run-7",
      outcome: "interrupted",
      settledAt: "2026-11-12T09:00:00.000Z",
      errorText: null,
    });
    const reports: Array<{
      interruptedByRestart: string[];
      notices: { sent: string[]; pending: string[] };
    }> = [];
    const second = await started(w, callerOk, { onRestart: (r) => void reports.push(r) });
    expect(reports[0]?.interruptedByRestart).toEqual(["thread-child-1"]);
    expect(reports[0]?.notices.pending).toHaveLength(1);
    expect(reports[0]?.notices.pending[0]).toMatch(/^child:thread-child-1:restart:\d+$/);
    expect(
      ok(await second.service.handle("children.list", who, { scope: "children" })),
    ).toMatchObject({
      rows: [{ state: "idle", lastOutcome: { status: "interrupted", cause: "backend-restarted" } }],
    });
    expect(
      ok(
        await second.service.handle("children.message", who, {
          target: "thread-child-1",
          content: "go on",
        }),
      ),
    ).toBeDefined();
    expect(w.fake.turns.map((t) => t.delivery)).toEqual(["queue"]);
    await second.service.drain();
    // Step 15 fills the seam with the outbox: the parent can take a message now, so the next start delivers the pending notice once, under the original key (child:<id>:restart:<epoch>).
    w.fake.activity.set(CALLER_THREAD, "idle");
    const key = reports[0]?.notices.pending[0] as string;
    const third = await started(w, callerOk, { onRestart: (r) => void reports.push(r) });
    expect(reports[1]?.notices.sent).toEqual([key]);
    const toParent = w.fake.turns.filter((t) => t.threadId === CALLER_THREAD);
    expect(toParent).toHaveLength(1);
    expect(toParent[0]?.content).toMatch(/restart/i);
    await third.service.drain();
    const fourth = await started(w, callerOk, { onRestart: (r) => void reports.push(r) });
    expect(reports[2]?.notices).toEqual({ sent: [], byT3: [], pending: [] });
    expect(w.fake.turns.filter((t) => t.threadId === CALLER_THREAD)).toHaveLength(1);
    await fourth.service.drain();
    // The seam can still be replaced: an explicit `notifyRestart` is used instead of the outbox.
    const delivered: string[] = [];
    const fifth = await started(w, callerOk, {
      notifyRestart: async (notice) => {
        delivered.push(notice.key);
        return { ok: true };
      },
    });
    expect(delivered).toEqual([]);
    await fifth.service.drain();
  });

  it("opens the job store beside the orchestration store (jobs/FORMAT declared) and closes both at drain", async () => {
    const w = world();
    writeMainRecord(w.stateRoot, MAIN);
    const { service } = await started(w);
    expect(
      JSON.parse(NodeFS.readFileSync(NodePath.join(w.stateRoot, "jobs", "FORMAT"), "utf8")),
    ).toEqual({ store: "aetheria-jobs", formatVersion: 1 });
    await service.drain();
    // Closed: a second Backend over the same root can open both writers again.
    const again = await started(w);
    await again.service.drain();
  });
});

describe("boot reconciliation", () => {
  const residue = (threadId: string, sessionId: string | null | "unknown"): ChildLineageThread => ({
    threadId,
    parentThreadId: CALLER_THREAD,
    rootThreadId: ROOT_THREAD,
    relationshipToParent: "subagent",
    sessionId,
    closed: false,
  });

  it("closes a thread created before any session was bound, and does not rerun anything", async () => {
    const w = world();
    w.lineage.threads = [residue("thread-orphan", null)];
    const { service, boots } = await started(w);
    expect(w.fake.closed).toEqual(["thread-orphan"]);
    expect(w.fake.releases).toEqual([]);
    expect(boots).toHaveLength(1);
    expect(boots[0]).toMatchObject({ lineage: "ok", closed: ["thread-orphan"] });
    await service.drain();
  });

  it("does NOT close an accepted child the index has not re-ingested yet: a route record proves a session was bound", async () => {
    const first = world();
    const spawned = await started(first);
    ok(await spawned.service.handle("children.spawn", who, SPAWN));
    await spawned.service.drain();
    // A new Backend over the same state root; T3's lineage lists the child but the index answers "no session bound" (lag).
    const second = world(first.stateRoot);
    second.lineage.threads = [residue("thread-child-1", null)];
    const { service, boots } = await started(second);
    expect(second.fake.closed).toEqual([]);
    expect(second.fake.releases).toEqual([]);
    expect(boots[0]).toMatchObject({
      lineage: "ok",
      closed: [],
      unknown: [{ threadId: "thread-child-1", why: "session-unknown" }],
    });
    // The child is still owned and the settle subscription covers its root.
    expect(second.fake.subscriptions.size).toBe(1);
    await service.drain();
  });

  it("a thread whose session is unknown and a lineage that cannot be read are retained, never closed", async () => {
    const w = world();
    w.lineage.threads = [residue("thread-x", "unknown")];
    const a = await started(w);
    expect(w.fake.closed).toEqual([]);
    await a.service.drain();
    const unreadable = world();
    unreadable.lineage.unavailable = true;
    const b = await started(unreadable);
    expect(b.boots[0]).toMatchObject({ lineage: "unavailable" });
    expect(unreadable.fake.closed).toEqual([]);
    await b.service.drain();
  });

  it("refuses to start over a store it cannot declare (a nonempty folder with no FORMAT)", async () => {
    const w = world();
    NodeFS.mkdirSync(NodePath.join(w.stateRoot, "orchestration"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(w.stateRoot, "orchestration", "stray.txt"), "x");
    const service = createOrchestrationFactory({ callerContext: callerOk })(w.deps);
    const result = await service.start();
    expect(result).toMatchObject({ ok: false, code: "STORE_UNDECLARED" });
  });
});

describe("drain", () => {
  it("refuses new work, unsubscribes the watchers and frees the store for the next Backend", async () => {
    const w = world();
    const { service } = await started(w);
    ok(await service.handle("children.spawn", who, SPAWN));
    expect(w.fake.subscriptions.size).toBe(1);
    expect(await service.drain()).toEqual({ stopped: [], stillLive: [] });
    expect(w.fake.subscriptions.size).toBe(0);
    expect(await service.handle("children.spawn", who, SPAWN)).toMatchObject({
      ok: false,
      code: "ORCHESTRATION_UNAVAILABLE",
    });
    const next = await started(world(w.stateRoot));
    await next.service.drain();
  });
});

describe("the declared archive", () => {
  it("has the declared stamp as its independently computed SHA-256, and the sidecar agrees", () => {
    const pkgDir = NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
    const archive = NodeFS.readFileSync(
      NodePath.join(pkgDir, "artifacts/aetheria-orchestration-0.1.0.tgz"),
    );
    const computed = `sha256:${NodeCrypto.createHash("sha256").update(archive).digest("hex")}`;
    expect(ORCHESTRATION_PINNED_ARTIFACT).toEqual({
      package: "@aetheria/orchestration",
      version: "0.1.0",
      stamp: computed,
    });
    const sidecar = JSON.parse(
      NodeFS.readFileSync(
        NodePath.join(pkgDir, "artifacts/aetheria-orchestration.stamp.json"),
        "utf8",
      ),
    );
    expect(sidecar).toMatchObject({
      package: "@aetheria/orchestration",
      archive: "aetheria-orchestration-0.1.0.tgz",
      stamp: computed,
    });
  });
});
