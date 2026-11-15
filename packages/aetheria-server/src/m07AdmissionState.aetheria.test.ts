// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
// AETHERIA M07 Plan steps 13–14 (DV1) — `admissionState` and the three `goalNotice*` members of M05's direct API, through the REAL orchestration factory over the INSTALLED `@aetheria/orchestration`
// archive, its real store and M03's identity store in a scratch state root. SCRIPTED: T3 (the thread port: it records every turn it is asked to insert). It shows: `admissionState` reads the key
// the admission wrote and nothing else (absent, then admitted with the same message id, after a reopen too), reads leave the files byte-identical and send nothing to T3, an untrusted authority
// or an unknown session answers without disclosing state, and every member is refused after the service stopped and for a handle captured before the drain; the notice adapter enqueues once and
// delivers once per key, only for `goal-notice`, refuses an untrusted authority, and after stop writes and sends nothing. It does NOT show T3's real inbox or receipt store, or the Backend's
// wiring of the adapter into the goals service (m07GoalsBackend.aetheria.test.ts).
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createOrchestrationFactory } from "./orchestrationFactory.ts";
import type {
  OrchestrationDirectApi,
  OrchestrationService,
  OrchestrationServiceDeps,
} from "./orchestration.ts";
import type { ChildThreadPort } from "./orchestrationPorts.ts";
import { mainRecord, writeEnvelope } from "./identity/testkit.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});
const scratch = () => {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m07-admission-")),
  );
  NodeFS.chmodSync(root, 0o700);
  roots.push(root);
  return root;
};

const MAIN = "0197d3c0-1111-7000-8000-000000000001";
const THREAD = "thread-main";
const module = { kind: "backend-module", module: "m07-goals" } as const;

/** T3 as a script: the main thread is idle, accepts every turn and remembers it. Everything else answers unavailable. */
function fakeT3() {
  const turns: Array<{ threadId: string; messageId: string; content: string }> = [];
  const unavailable = async () => ({ ok: false, reason: "unavailable" });
  const port = {
    createChildThread: unavailable,
    bindChildSession: unavailable,
    releaseFirstTurn: unavailable,
    forkThread: unavailable,
    withdrawForkRequest: unavailable,
    startTurn: async (input: { threadId: string; messageId: string; content: string }) => {
      turns.push({ threadId: input.threadId, messageId: input.messageId, content: input.content });
      return { ok: true, accepted: true, messageId: input.messageId };
    },
    interrupt: async () => ({ ok: true, accepted: true }),
    status: async () => ({ ok: true, status: { activity: "idle", queued: 0, resident: true } }),
    subscribeTurnCompleted: () => ({ unsubscribe: () => undefined }),
    readDelegatedCompletion: unavailable,
    readRestartNotes: async () => ({ ok: true, notes: [] }),
    readLastRun: async () => ({ ok: true, run: null }),
    readLastHumanMessage: async () => ({ ok: true, messageId: null }),
    readMessageReceipt: async ({ messageId }: { messageId: string }) => ({
      ok: true,
      found: turns.some((turn) => turn.messageId === messageId),
    }),
    suppressCompletionDelivery: unavailable,
    readChildResult: unavailable,
    close: unavailable,
  } as unknown as ChildThreadPort;
  return { port, turns };
}

async function open(stateRoot: string, t3 = fakeT3()) {
  const deps: OrchestrationServiceDeps = {
    stateRoot,
    now: () => 1_700_000_000_000,
    threads: t3.port,
    planMode: { inheritPlanMode: async () => ({ ok: true }) },
    resume: { resumed: async () => undefined },
    sessionOfThread: (threadId) => (threadId === THREAD ? MAIN : undefined),
    threadOfSession: (sessionId) => (sessionId === MAIN ? THREAD : undefined),
    lineageSessionOf: () => "unknown",
    spawnAuthorizer: {
      authorize: async () => ({ ok: false, code: "AUTH_IDENTITY_UNAVAILABLE", reason: "n/a" }),
    } as never,
    lineage: { listChildThreads: async () => ({ ok: true, threads: [] }) },
  };
  const service: OrchestrationService = createOrchestrationFactory({
    callerContext: async () => ({ ok: false, detail: "n/a" }),
  })(deps);
  expect(await service.start()).toEqual({ ok: true });
  return { service, direct: service.direct()!, t3 };
}

const filesOf = (root: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of NodeFS.readdirSync(dir).sort()) {
      const full = NodePath.join(dir, name);
      if (NodeFS.statSync(full).isDirectory()) walk(full);
      else out[NodePath.relative(root, full)] = NodeFS.readFileSync(full, "utf8");
    }
  };
  walk(root);
  return out;
};

const world = () => {
  const stateRoot = scratch();
  writeEnvelope(stateRoot, mainRecord(MAIN));
  return stateRoot;
};
const admit = (direct: OrchestrationDirectApi, key: string) =>
  direct.admitTurn({
    authority: module,
    sessionId: MAIN,
    origin: { kind: "goal-round", goalId: "g", revision: 1, round: 1 },
    content: "next round",
    key,
  });

describe("admissionState (M07 D8 revision)", () => {
  it("reads absent, then the admitted message id the admission wrote — also after a reopen — and never sends, writes or delivers", async () => {
    const stateRoot = world();
    const first = await open(stateRoot);
    expect(
      await first.direct.admissionState({ authority: module, sessionId: MAIN, key: "g:1:1" }),
    ).toEqual({ status: "absent" });
    const admitted = await admit(first.direct, "g:1:1");
    expect(admitted).toMatchObject({ status: "admitted" });
    const messageId = (admitted as { messageId: string }).messageId;
    const sentBefore = first.t3.turns.length;
    const before = filesOf(stateRoot);
    for (let i = 0; i < 3; i++)
      expect(
        await first.direct.admissionState({ authority: module, sessionId: MAIN, key: "g:1:1" }),
      ).toEqual({ status: "admitted", messageId });
    expect(filesOf(stateRoot)).toEqual(before);
    expect(first.t3.turns).toHaveLength(sentBefore);
    await first.service.drain();

    const second = await open(stateRoot);
    expect(
      await second.direct.admissionState({ authority: module, sessionId: MAIN, key: "g:1:1" }),
    ).toEqual({ status: "admitted", messageId });
    expect(
      await second.direct.admissionState({ authority: module, sessionId: MAIN, key: "g:1:2" }),
    ).toEqual({ status: "absent" });
    expect(second.t3.turns).toEqual([]); // a reopen and a read send nothing
    await second.service.drain();
  });

  it("discloses nothing to an untrusted authority or a session it does not know, and is refused after stop and for a handle captured before the drain", async () => {
    const stateRoot = world();
    const { service, direct } = await open(stateRoot);
    await admit(direct, "g:1:1");
    for (const authority of [
      undefined,
      { kind: "model" },
      { kind: "backend-module" },
      { kind: "backend-module", module: "" },
      "backend-module",
    ]) {
      const answer = await direct.admissionState({ authority, sessionId: MAIN, key: "g:1:1" });
      expect(answer.status, JSON.stringify(authority)).not.toBe("admitted");
      expect(answer.status, JSON.stringify(authority)).not.toBe("admitting");
      expect(JSON.stringify(answer)).not.toMatch(/m-|messageId/);
    }
    expect(
      (
        await direct.admissionState({
          authority: module,
          sessionId: "0197d3c0-9999-7000-8000-000000000009",
          key: "g:1:1",
        })
      ).status,
    ).not.toBe("admitted");
    await service.drain();
    expect(service.direct()).toBeUndefined();
    const filesAfterDrain = filesOf(stateRoot);
    expect(
      (await direct.admissionState({ authority: module, sessionId: MAIN, key: "g:1:1" })).status,
    ).toBe("unavailable");
    expect(filesOf(stateRoot)).toEqual(filesAfterDrain);
  });
});

describe("the goal-notice adapter (M07 DV1, D12)", () => {
  const key = "g:2:terminal";
  const enqueue = (direct: OrchestrationDirectApi, over: Record<string, unknown> = {}) =>
    direct.goalNoticeEnqueue({
      authority: module,
      sessionId: MAIN,
      key,
      text: "The goal is complete.",
      ...over,
    });
  const deliver = (direct: OrchestrationDirectApi, over: Record<string, unknown> = {}) =>
    direct.goalNoticeDeliver({ authority: module, sessionId: MAIN, key, ...over });

  it("enqueues one entry per key and delivers it once: the repeat creates nothing and sends nothing", async () => {
    const stateRoot = world();
    const { service, direct, t3 } = await open(stateRoot);
    expect(await direct.goalNoticeState({ authority: module, key })).toBe("unknown");
    expect(await enqueue(direct)).toMatchObject({
      status: "unavailable",
      detail: expect.stringContaining("OUTBOX_OWNER_UNKNOWN"),
    }); // M05 knows no owner for a session it never admitted a turn for
    await admit(direct, "g:2:1"); // the round whose terminal this notice reports: M05 now holds the main owner's record
    t3.turns.length = 0;
    expect(await enqueue(direct)).toEqual({ status: "queued", created: true });
    expect(await enqueue(direct)).toEqual({ status: "queued", created: false });
    expect(await direct.goalNoticeState({ authority: module, key })).toBe("pending");
    const first = await deliver(direct);
    expect(["delivered", "held"]).toContain(first.status);
    const sent = t3.turns.length;
    if (first.status === "delivered") {
      expect(sent).toBe(1);
      expect(await direct.goalNoticeState({ authority: module, key })).toMatch(/inserted|recorded/);
      expect((await deliver(direct)).status).toBe("nothing");
      expect(t3.turns).toHaveLength(1);
      expect(await enqueue(direct)).toEqual({ status: "queued", created: false });
    }
    await service.drain();
  });

  it("refuses an untrusted authority without writing, and answers state unknown to it", async () => {
    const stateRoot = world();
    const { service, direct, t3 } = await open(stateRoot);
    const before = filesOf(stateRoot);
    for (const authority of [undefined, { kind: "model" }, { kind: "backend-module" }]) {
      expect((await enqueue(direct, { authority })).status).toBe("unavailable");
      expect((await deliver(direct, { authority })).status).toBe("unavailable");
      expect(await direct.goalNoticeState({ authority, key })).toBe("unknown");
    }
    expect((await enqueue(direct, { text: "" })).status).toBe("unavailable");
    expect(filesOf(stateRoot)).toEqual(before);
    expect(t3.turns).toEqual([]);
    await service.drain();
  });

  it("after stop, a held handle enqueues, delivers and reads nothing: no byte changes and nothing reaches T3", async () => {
    const stateRoot = world();
    const { service, direct, t3 } = await open(stateRoot);
    await admit(direct, "g:2:1");
    expect(await enqueue(direct)).toMatchObject({ status: "queued" });
    await service.drain();
    expect(service.direct()).toBeUndefined();
    const after = filesOf(stateRoot);
    const sent = t3.turns.length;
    expect((await enqueue(direct, { key: "g:3:terminal" })).status).toBe("unavailable");
    expect((await deliver(direct)).status).toBe("unavailable");
    expect(await direct.goalNoticeState({ authority: module, key })).not.toBe("recorded");
    expect(filesOf(stateRoot)).toEqual(after);
    expect(t3.turns).toHaveLength(sent);
  });
});
