// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M07 Plan step 3 (fork half) — probe: how the composed Backend lends M05's notice outbox to a trusted module, and what a captured reference does after the drain.
//
// Boundary: the real children service of the installed orchestration archive, built by the fork's own `createOrchestrationFactory` and fenced by its own `fenceDirectApi`, over the real
// orchestration store and M03's real identity files in a scratch state root. SCRIPTED: T3's ChildThreadPort (a Proxy: only `status` and `startTurn` answer; any other member throws, so a
// probe that touched more would fail loudly). It shows: (1) the declared direct API type omits `outbox` — reading it needs a cast, which the compiler refuses without one; (2) at run time the
// fence's spread nevertheless passes the service's raw `outbox` through, unfenced and untracked; (3) while the Backend runs that object can enqueue a `goal-notice` once per key and deliver it
// through T3's start-turn; (4) after `drain()` the fenced members answer unavailable but the captured raw object's behaviour is recorded here — the fence is NOT what refuses it. So a raw
// untracked outbox reference is not lifecycle-safe proof; the existing path is a cast of an untyped property. It does NOT show Backend composition (composition.ts is shared), T3 itself, or
// the owned fix (a fenced goal-notice adapter would be a proposed additive change returned to the caller as a decision).
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createOrchestrationFactory } from "./orchestrationFactory.ts";
import type { OrchestrationDirectApi, OrchestrationServiceDeps } from "./orchestration.ts";
import { mainRecord, writeEnvelope } from "./identity/testkit.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});
const MAIN = "0197d3c0-1111-7000-8000-000000000001";
const MAIN_THREAD = "thread-main";

// A plain object (the factory spreads the port, which a Proxy would not survive): only `status` and `startTurn` exist; any other member is undefined, so a probe that needed more fails loudly.
const thread = {
  status: async () => ({ ok: true, status: { activity: "idle", queued: 0, resident: true } }),
  startTurn: async () => ({ ok: true }),
} as never;

async function started() {
  const stateRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m07-cleanup-"));
  roots.push(stateRoot);
  writeEnvelope(stateRoot, mainRecord(MAIN));
  const deps: OrchestrationServiceDeps = {
    stateRoot,
    now: () => 1_700_000_000_000,
    threads: thread,
    planMode: { inheritPlanMode: async () => ({ ok: true }) },
    resume: { resumed: async () => undefined },
    sessionOfThread: (id) => (id === MAIN_THREAD ? MAIN : undefined),
    threadOfSession: (id) => (id === MAIN ? MAIN_THREAD : undefined),
    lineageSessionOf: () => "unknown",
    spawnAuthorizer: {
      authorize: async () => ({ ok: false, code: "AUTH_TOOL_NOT_ALLOWED" }) as never,
      authorizeFork: async () => ({ ok: false, code: "AUTH_TOOL_NOT_ALLOWED" }) as never,
    },
    lineage: { listChildThreads: async () => ({ ok: true, threads: [] }) },
  };
  const service = createOrchestrationFactory({
    callerContext: async () => ({ ok: false, detail: "not used by this probe" }),
  })(deps);
  expect(await service.start()).toEqual({ ok: true });
  return { service, stateRoot };
}

interface RawOutbox {
  enqueue(owner: unknown, spec: unknown): { ok: boolean; created?: boolean; code?: string };
  deliver(owner: unknown, keys?: readonly string[]): Promise<{ status: string }>;
  state(key: string): string;
}
const MODULE = { kind: "backend-module", module: "m07-probe" } as const;

describe("probe 3: the notice outbox as the composed Backend lends it", () => {
  it("the declared direct type omits `outbox`, yet the fenced object carries the raw service outbox, which enqueues and delivers a goal-notice once per key while the Backend runs", async () => {
    const { service } = await started();
    const direct = service.direct() as OrchestrationDirectApi;
    // @ts-expect-error — `outbox` is not in OrchestrationDirectApi's declared Pick (orchestration.ts); reading it needs a cast
    const typedRead: unknown = direct.outbox;
    expect(typedRead).toBeDefined(); // present at run time: the fence passes nonfunction properties through (orchestrationDirect.ts)
    const raw = (direct as unknown as { outbox: RawOutbox }).outbox;
    expect(typeof raw.enqueue).toBe("function");
    // The main session's record is made by M05 on first admission.
    const admitted = await direct.admitTurn({
      authority: MODULE,
      sessionId: MAIN,
      origin: { kind: "goal-round" },
      content: "round",
      key: "k",
    });
    expect(JSON.stringify(admitted)).toContain('"admitted"');
    const owner = { kind: "main", sessionId: MAIN };
    const spec = {
      kind: "goal-notice",
      key: "g:1:terminal",
      targetSessionId: MAIN,
      volatile: false,
      text: "Goal complete.",
    };
    expect(raw.enqueue(owner, spec)).toEqual({ ok: true, created: true });
    expect(raw.enqueue(owner, spec)).toEqual({ ok: true, created: false });
    expect((await raw.deliver(owner, [spec.key])).status).toBe("inserted");
    expect(raw.state(spec.key)).toBe("inserted");
    await service.drain();
  });

  it("after drain the fenced members refuse, `direct()` is gone, and the captured raw outbox is NOT stopped by the fence (its answer is recorded, never assumed)", async () => {
    const { service } = await started();
    const direct = service.direct() as OrchestrationDirectApi;
    const raw = (direct as unknown as { outbox: RawOutbox }).outbox;
    await direct.admitTurn({
      authority: MODULE,
      sessionId: MAIN,
      origin: { kind: "goal-round" },
      content: "round",
      key: "k",
    });
    await service.drain();
    expect(service.direct()).toBeUndefined();
    expect(
      await direct.admitTurn({
        authority: MODULE,
        sessionId: MAIN,
        origin: { kind: "goal-round" },
        content: "again",
        key: "k2",
      }),
    ).toMatchObject({ status: "unavailable" });
    let captured: unknown;
    try {
      captured = raw.enqueue(
        { kind: "main", sessionId: MAIN },
        {
          kind: "goal-notice",
          key: "g:9:terminal",
          targetSessionId: MAIN,
          volatile: false,
          text: "late",
        },
      );
    } catch (error) {
      captured = { thrown: String(error) };
    }
    // The captured object's own answer after the drain. If this is `ok: true` the notice was written past the drain; if it fails, the store (closed by the drain), not the fence, refused it.
    expect(JSON.stringify(captured)).toMatch(/"ok":false|thrown/);
  });
});
