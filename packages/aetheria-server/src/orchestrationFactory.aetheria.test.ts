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
    forkThread: async () => ({ ok: false, reason: "fork-failed" }),
    startTurn: async () => ({ ok: false, reason: "delivery-unavailable" }),
    interrupt: async () => ({ ok: true, accepted: true }),
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
    readRestartNotes: async () => ({ ok: false, reason: "unavailable" }),
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
      threadId.startsWith("thread-child") ? `pi-${threadId}` : undefined,
    threadOfSession: (sessionId) => (sessionId.startsWith("pi-") ? sessionId.slice(3) : undefined),
    lineageSessionOf: () => "unknown",
    spawnAuthorizer: {
      authorize: async (input) => {
        authorizerSeen.push({
          callerSessionId: input.callerSessionId,
          workingFolder: input.workingFolder,
        });
        return options.verdict;
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

async function started(w: World, callerContext: CallerContextPort = callerOk) {
  const boots: unknown[] = [];
  let n = 0;
  let m = 0;
  const service = createOrchestrationFactory({
    callerContext,
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
  const unbuilt = ORCHESTRATION_OPERATIONS.filter(
    (name) => name !== "children.spawn" && name !== "children.status",
  );
  it("are fifteen and each answers ORCHESTRATION_UNAVAILABLE without touching T3", async () => {
    expect(unbuilt).toHaveLength(15);
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
    expect(await operations["children.list"]!(context({ scope: "children" }))).toMatchObject({
      status: "unavailable",
      code: "ORCHESTRATION_UNAVAILABLE",
    });
    expect(await operations["children.spawn"]!(context({ ...SPAWN }))).toMatchObject({
      status: "done",
    });
    await registration.activation.drain("test");
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
