// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
// AETHERIA M05 review 10 (named verification gap) — a boot that failed while its own cleanup did not end keeps the Backend's owner lock, through the REAL orchestration factory composed
// into the Backend the way service.ts composes it.
//
// Boundary: the real Backend service (owner lock, ordered start, the runtime's rollback of a failed start, the real thread index) over the real `createOrchestrationFactory`, the real
// children service, jobs store and job wakes of the installed orchestration archive, and a job completion that an earlier Backend left pending in a scratch state root. SCRIPTED: T3 (a
// port that answers unavailable), the caller-context port, the host process probe, and two faults the test injects through `./library.ts`: the child service's root watch throws (the boot
// failure, after boot scheduled the pending completion's wake) and the wake drain never settles until the test lets it end. Fake timers cover only setTimeout/clearTimeout (the factory's 5 s bound).
// Shows: the lock stays, a successor over the same root is refused as `state-root-owned`, and a dispose while the work is stalled is unclean and keeps the lock. The last contract (once the stalled
// work ends, a later dispose releases the lock) does NOT hold in the composition: it is an `it.fails` below, with the evidence. It does NOT show a separate process (the successor is in this process; the owner check is the live-pid check the scripted service test also uses), T3's real services, or the apps/server wrapper.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ChildLineageThread, ChildThreadPort } from "./orchestrationPorts.ts";
import { createOrchestrationFactory, type CallerContextPort } from "./orchestrationFactory.ts";
import { OWNER_LOCK_FILE } from "./ownerLock.ts";
import { createAetheriaBackendService } from "./service.ts";
import type { OrchestrationOutcome } from "./orchestration.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});
const scratch = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m05-failed-boot-lock-"));
  roots.push(root);
  return root;
};
const lockOf = (root: string): string => NodePath.join(root, OWNER_LOCK_FILE);

const MAIN = "main-session";
const CALLER_THREAD = "thread-main";
const ROOT_THREAD = "thread-root";
const RUN = "0197d3c0-aaaa-4000-8000-00000000d15d";
const who = { sessionId: MAIN, rootSessionId: MAIN, kind: "main" };
const NEVER = () => new Promise<never>(() => undefined);

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
const host = () => ({
  startTime: async () => "T",
  probeGroup: () => ({ state: "live" as const }),
  inspectRun: async () => ({ ok: true as const }),
});
// T3 as a port that knows nothing: every read is unavailable, so boot can fail only where the test makes it.
const unavailable = async () => ({ ok: false as const, reason: "unavailable" });
const silentThreads = (): ChildThreadPort =>
  ({
    createChildThread: async () => ({ ok: false, reason: "create-failed" }),
    bindChildSession: async () => ({ ok: false, reason: "bind-failed" }),
    releaseFirstTurn: async () => ({ ok: false, reason: "delivery-unavailable" }),
    forkThread: async () => ({ ok: false, reason: "unavailable" }),
    withdrawForkRequest: unavailable,
    startTurn: async () => ({ ok: false, reason: "delivery-unavailable" }),
    interrupt: unavailable,
    status: unavailable,
    subscribeTurnCompleted: () => ({ unsubscribe: () => undefined }),
    readDelegatedCompletion: unavailable,
    readRestartNotes: unavailable,
    suppressCompletionDelivery: unavailable,
    readChildResult: unavailable,
    readLastRun: unavailable,
    readMessageReceipt: unavailable,
    readLastHumanMessage: unavailable,
    close: unavailable,
  }) as ChildThreadPort;
const lineageOfOneChild: ChildLineageThread[] = [
  {
    threadId: "thread-child-1",
    parentThreadId: CALLER_THREAD,
    rootThreadId: ROOT_THREAD,
    relationshipToParent: "subagent",
    sessionId: "pi-thread-child-1",
    closed: false,
  },
];

type FactoryOf = typeof createOrchestrationFactory;
const backendOver = (
  stateRoot: string,
  factory: ReturnType<FactoryOf>,
  childLineage?: { listChildThreads: () => Promise<unknown> },
) => {
  const made = createAetheriaBackendService({
    stateRoot,
    credentialOf: () => undefined,
    projectRootOf: (folder) => folder,
    childThreads: silentThreads(),
    orchestrationFactory: factory,
    ...(childLineage === undefined ? {} : { childLineage: childLineage as never }),
  });
  if (made.outcome !== "prepared") throw new Error(`refused: ${JSON.stringify(made.faults)}`);
  return made.service;
};
const successorOver = (stateRoot: string) => {
  const made = createAetheriaBackendService({
    stateRoot,
    credentialOf: () => undefined,
    projectRootOf: (folder) => folder,
  });
  if (made.outcome !== "prepared") throw new Error("must prepare");
  return made.service;
};
const value = (outcome: OrchestrationOutcome): Record<string, unknown> => {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  return (outcome as { value: Record<string, unknown> }).value;
};

// An earlier Backend over the root adopts a job, the job exits, and the Backend drains: the completion notice is left pending in the job record, as a restart finds it.
async function leavePendingCompletion(stateRoot: string): Promise<void> {
  const first = backendOver(
    stateRoot,
    createOrchestrationFactory({
      callerContext: callerOk,
      hostProcess: host(),
      newJobId: () => "job-wake",
      wakeCoalesceMs: 60_000,
      wakeSchedule: () => () => undefined,
    }),
  );
  expect((await first.start()).outcome).toBe("started");
  const orchestration = first.orchestration();
  if (orchestration === undefined) throw new Error("the children service must run");
  const jobId = value(
    await orchestration.handle("jobs.reserve", who, {
      runKey: RUN,
      label: "npm test",
      mode: "background",
    }),
  ).jobId as string;
  const folder = NodePath.join(stateRoot, "shell", "runs", RUN);
  NodeFS.mkdirSync(folder, { recursive: true, mode: 0o700 });
  NodeFS.writeFileSync(NodePath.join(folder, "stdout"), "");
  NodeFS.writeFileSync(NodePath.join(folder, "stderr"), "");
  value(
    await orchestration.handle("jobs.attach", who, {
      jobId,
      pid: 4242,
      pgid: 4242,
      startIdentity: { pid: 4242, startTime: "T" },
    }),
  );
  value(await orchestration.handle("jobs.adopted", who, { jobId, via: "background" }));
  value(await orchestration.handle("jobs.exited", who, { jobId, exit: { code: 0, signal: null } }));
  expect((await first.dispose("seed done")).ok).toBe(true);
  expect(NodeFS.existsSync(lockOf(stateRoot))).toBe(false);
}

describe("a failed boot whose cleanup does not end, through the real factory in the composed Backend (review 10)", () => {
  async function failedBootInBackend() {
    const stateRoot = scratch();
    await leavePendingCompletion(stateRoot);
    // The state-root files the second boot will find: the pending completion exists.
    expect(NodeFS.existsSync(NodePath.join(stateRoot, "jobs", "job-wake", "record.json"))).toBe(
      true,
    );
    const order: string[] = [];
    const wakeDrain = { stalled: true };
    vi.resetModules();
    vi.doMock("./library.ts", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./library.ts")>();
      return {
        ...actual,
        createJobWakes: (...args: Parameters<typeof actual.createJobWakes>) => {
          const wakes = actual.createJobWakes(...args);
          return {
            ...wakes,
            noticed(sessionId: string) {
              order.push("wakes.noticed");
              return wakes.noticed(sessionId);
            },
            drain() {
              order.push(wakeDrain.stalled ? "wakes.drain:stalled" : "wakes.drain");
              return wakeDrain.stalled ? NEVER() : wakes.drain();
            },
          };
        },
        createChildService: (...args: Parameters<typeof actual.createChildService>) => {
          const service = actual.createChildService(...args);
          return {
            ...service,
            watch: () => {
              throw new Error("the root watch could not be opened");
            },
          };
        },
      };
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { createOrchestrationFactory: isolatedFactory } =
      await import("./orchestrationFactory.ts");
    const service = backendOver(
      stateRoot,
      isolatedFactory({
        callerContext: callerOk,
        hostProcess: host(),
        wakeCoalesceMs: 60_000,
        wakeSchedule: () => () => undefined,
      }),
      { listChildThreads: async () => ({ ok: true, threads: lineageOfOneChild }) },
    );
    return { stateRoot, service, order, wakeDrain };
  }
  const stalledDrains = (order: readonly string[]): number =>
    order.filter((entry) => entry === "wakes.drain:stalled").length;
  const restore = () => {
    vi.useRealTimers();
    vi.doUnmock("./library.ts");
    vi.resetModules();
  };

  // Starts the Backend whose boot fails after scheduling the pending completion's wake and whose wake drain never settles; returns once the start is answered `failed`.
  async function refusedBoot(w: Awaited<ReturnType<typeof failedBootInBackend>>) {
    const starting = w.service.start();
    let result: Awaited<typeof starting> | undefined;
    void starting.then((r) => (result = r));
    // Real file work comes first (the lock, the stores); the bound's timer exists only once the boot's cleanup has reached the stalled wake drain.
    await vi.waitFor(() => expect(stalledDrains(w.order)).toBe(1));
    // Just inside the factory's bound the stalled wake drain still holds the failed boot; at the bound the boot is refused and its cleanup is reported unended.
    await vi.advanceTimersByTimeAsync(4999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    // The Backend's rollback then calls the module's own drain, which re-attempts the join under a bound of its own (the second stalled drain).
    await vi.waitFor(() => expect(stalledDrains(w.order)).toBe(2));
    await vi.advanceTimersByTimeAsync(5000);
    await starting;
    expect(result).toMatchObject({ outcome: "failed", cause: { module: expect.any(String) } });
    // The failure is the injected one, after the pending completion's wake was scheduled.
    expect(JSON.stringify(result)).toContain("BOOT_RECONCILIATION_FAILED");
    expect(JSON.stringify(result)).toContain("the root watch could not be opened");
    expect(w.order).toContain("wakes.noticed");
    expect(w.order).toContain("wakes.drain:stalled");
    expect(w.service.status().phase).toBe("failed");
    expect(w.service.status().disposal).toMatchObject({ ok: false, stillLive: 1 });
  }
  const expectSuccessorRefused = async (stateRoot: string) =>
    expect(await successorOver(stateRoot).start()).toMatchObject({
      outcome: "refused",
      faults: [{ code: "state-root-owned", subject: "state-root" }],
    });

  it("keeps the owner lock and refuses a successor over the same root as state-root-owned", async () => {
    const w = await failedBootInBackend();
    try {
      await refusedBoot(w);
      // The cleanup did not end, so the lock stays and a successor over the same root is refused, writing nothing.
      expect(NodeFS.existsSync(lockOf(w.stateRoot))).toBe(true);
      const before = NodeFS.readFileSync(lockOf(w.stateRoot), "utf8");
      await expectSuccessorRefused(w.stateRoot);
      expect(NodeFS.readFileSync(lockOf(w.stateRoot), "utf8")).toBe(before);
      // A dispose while the work is still stalled is not clean, and keeps the lock.
      expect((await w.service.dispose("teardown while stalled")).ok).toBe(false);
      expect(NodeFS.existsSync(lockOf(w.stateRoot))).toBe(true);
      await expectSuccessorRefused(w.stateRoot);
    } finally {
      restore();
    }
  });

  // KNOWN DEFECT (review 10 verification, reported to the caller; product code unchanged): the desired contract below does not hold in the composed Backend. The runtime caches the failed
  // start's rollback report as its one disposal (@aetheria/awareness lib/backend.js: `#begin` sets `#disposal`; a later `dispose` returns it), so the Backend's dispose never calls the
  // orchestration drain again and the factory's re-attempted join (orchestrationFactory.ts `failedBoot`) is unreachable through it. The lock then stays for the life of the process (fail
  // safe: a successor waits for the proven-dead takeover). `it.fails` keeps the contract visible and turns red the day it holds; delete it with the fix's own test.
  it.fails("releases the lock at the dispose that follows once the stalled drain has ended, and a successor then starts", async () => {
    const w = await failedBootInBackend();
    try {
      await refusedBoot(w);
      expect(NodeFS.existsSync(lockOf(w.stateRoot))).toBe(true);
      await expectSuccessorRefused(w.stateRoot);
      // The stalled work ends. The dispose joins it again, closes the stores, reports clean, and only then releases the lock.
      w.wakeDrain.stalled = false;
      const report = await w.service.dispose("teardown after the work ended");
      // Today: ok false, the lock stays, and the wake drain was not asked again (the report is the failed start's cached one).
      expect({
        ok: report.ok,
        rejoined: w.order.includes("wakes.drain"),
        lockHeld: NodeFS.existsSync(lockOf(w.stateRoot)),
      }).toEqual({ ok: true, rejoined: true, lockHeld: false });
    } finally {
      restore();
    }
    const next = successorOver(w.stateRoot);
    expect((await next.start()).outcome).toBe("started");
    await next.dispose("done");
    expect(NodeFS.existsSync(lockOf(w.stateRoot))).toBe(false);
  });
});
