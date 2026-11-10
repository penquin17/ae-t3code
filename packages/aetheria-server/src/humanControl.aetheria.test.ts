// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
// AETHERIA M06 Plan step 6 — the Backend `human-control-backend` module: registration, the XC-6 operations, the single shared service.
//
// Boundary: the real Backend service (owner lock, composition validation, ordered start, reverse drain, XC-7 report) with the module selected by the
// real composition and its real manifest row. The ONLY double is the interaction service: until the step-5 archive is repacked the module is
// built against the announced service API (humanControl.ts `HumanControlService`) and an in-test fake implements it. So this shows the wiring —
// strict argument decoding, identity taken from the operation context only, one service, start after the owner lock, drain before joining — and
// does NOT show the real store, state machine or delivery (those are the step-5 suites and the apps/server real-intake suite).
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { Xc6OperationContext } from "@t3tools/aetheria-contracts";

import { BACKEND_ENTRY_ALLOWLIST, backendManifest } from "./composition.ts";
import {
  HUMAN_CONTROL_BACKEND_ENTRY,
  HUMAN_CONTROL_BACKEND_ID,
  humanControlBackendModuleRow,
} from "./humanControlRow.ts";
import type { AuditPort, HumanControlService } from "./humanControl.ts";
import { createAetheriaBackendService } from "./service.ts";

const SHA = "a".repeat(64);
const record = (overrides: Record<string, unknown> = {}) => ({
  interactionId: "int-1",
  kind: "question",
  state: "pending",
  revision: SHA,
  rootSessionId: "root-1",
  sessionId: "session-1",
  askCallId: "call-1",
  createdAt: "2026-11-10T12:00:00.000Z",
  held: false,
  content: { questions: [{ id: "q1", question: "Which?" }] },
  ...overrides,
});

const emptyDrain = { released: [], stopped: [], transferred: [], stillLive: [] };

interface FakeOptions {
  readonly startResult?: Awaited<ReturnType<HumanControlService["start"]>>;
  readonly awaitSegment?: HumanControlService["awaitSegment"];
  readonly publishTasks?: HumanControlService["publishTasks"];
}
const makeFake = (options: FakeOptions = {}) => {
  const calls: Array<{ readonly method: string; readonly args: readonly unknown[] }> = [];
  const note = (method: string, ...args: unknown[]) => calls.push({ method, args });
  const service: HumanControlService = {
    start: async () => {
      note("start");
      return options.startResult ?? { ok: true, value: { continued: [] } };
    },
    create: async (who, args) => {
      note("create", who, args);
      return { ok: true, value: record() as never };
    },
    awaitSegment:
      options.awaitSegment ??
      (async (who, args, opts) => {
        note("awaitSegment", who, args, opts);
        return { ok: true, value: record() as never };
      }),
    release: async (who, args) => {
      note("release", who, args);
      return { ok: true, value: record({ state: "continued" }) as never };
    },
    snapshot: async (rootSessionId) => {
      note("snapshot", rootSessionId);
      return { ok: true, value: { rootSessionId, version: 1, interactions: [] } };
    },
    answer: async (who, args) => {
      note("answer", who, args);
      return { ok: true, value: record({ state: "answered" }) as never };
    },
    cancel: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    hold: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    close: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    decidePlan: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    getPlanMode: async (sessionId) => {
      note("getPlanMode", sessionId);
      return { ok: true, value: { sessionId, active: false, modeRevision: 0 } };
    },
    publishTasks: async (who, args) => {
      note("publishTasks", who, args);
      if (options.publishTasks !== undefined) return options.publishTasks(who, args);
      return {
        ok: true,
        value: {
          sessionId: who.sessionId,
          rootSessionId: who.rootSessionId,
          entryId: args.entryId,
          seq: args.seq,
          todos: args.list,
          publishedAt: "2026-11-10T12:00:00.000Z",
          state: "current",
        },
      };
    },
    getTasks: async (sessionId) => {
      note("getTasks", sessionId);
      return { ok: true, value: null };
    },
    setPlanMode: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    grant: async () => ({ ok: false, code: "INTERACTION_UNAVAILABLE" }) as never,
    verifyHumanOrigin: async (originId, expect) => {
      note("verifyHumanOrigin", originId, expect);
      return originId === "org-unreadable"
        ? { ok: false, code: "INTERACTION_UNAVAILABLE" }
        : { verified: false, code: "ORIGIN_NOT_FOUND" };
    },
    canAccess: () => true,
    reconcileWaits: async (sessionId) => {
      note("reconcileWaits", sessionId);
      return { ok: true, value: { continued: [] } };
    },
    redeliver: async (sessionId) => {
      note("redeliver", sessionId);
      return { ok: true, value: { delivered: [], failed: [], pending: [] } };
    },
    onChange: () => () => {},
    drain: async () => {
      note("drain");
      return { ...emptyDrain, released: ["backend-interactions.wait:int-1"] };
    },
  };
  return { service, calls };
};

const roots: string[] = [];
const stateRoot = () => {
  const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  const root = NodeFS.mkdtempSync(NodePath.join(base, "m06-s06-hc-"));
  roots.push(root);
  return root;
};
afterEach(() => {
  vi.useRealTimers();
});

const prepare = (fake: ReturnType<typeof makeFake>, root = stateRoot(), auditPort?: AuditPort) => {
  const factory = vi.fn(() => fake.service);
  const made = createAetheriaBackendService({
    stateRoot: root,
    credentialOf: () => undefined,
    interactionFactory: factory,
    ...(auditPort === undefined ? {} : { auditPort }),
  });
  if (made.outcome !== "prepared") throw new Error(`must prepare: ${JSON.stringify(made.faults)}`);
  return { service: made.service, factory };
};

const context = (args: Record<string, unknown>): Xc6OperationContext => ({
  caller: { threadId: "thread-1", providerSessionId: "ps-1", providerInstanceId: "pi" },
  sessionId: "session-1",
  kind: "main",
  rootSessionId: "root-1",
  args,
});

const SEVEN = [
  "interaction.create",
  "interaction.await",
  "interaction.release",
  "tasks.publish",
  "plan-mode.get",
  "audit.history",
  "origin.verify",
] as const;

describe("the module's row and the composition", () => {
  it("is on the build-time allowlist and selected by the aetheria-backend composition", () => {
    expect(BACKEND_ENTRY_ALLOWLIST).toContain(HUMAN_CONTROL_BACKEND_ENTRY);
    const manifest = backendManifest();
    expect(manifest.modules.map((m) => m.id)).toContain(HUMAN_CONTROL_BACKEND_ID);
    expect(manifest.compositions[0]?.modules).toContain(HUMAN_CONTROL_BACKEND_ID);
    expect(humanControlBackendModuleRow()).toMatchObject({
      id: "human-control-backend",
      host: "backend",
      entry: "aetheria:human-control-backend",
      required: true,
      owns: ["backend-interactions-state"],
    });
  });

  it("registers exactly the seven XC-6 operations, and no decision operation", () => {
    const { service } = prepare(makeFake());
    const names = Object.keys(service.operations()).filter((name) =>
      /^(interaction|tasks|plan-mode|audit|origin)\./.test(name),
    );
    expect(names.sort()).toEqual([...SEVEN].sort());
    // D6: a human decision is a client RPC only; no XC-6 name decides, answers, grants or cancels an interaction.
    expect(
      Object.keys(service.operations()).filter((n) =>
        /^(interaction|plan|authorization)[.-].*(answer|decide|grant|cancel|approve)/.test(n),
      ),
    ).toEqual([]);
    expect(service.status().modules.map((m) => m.id)).toContain(HUMAN_CONTROL_BACKEND_ID);
  });
});

describe("start, one shared service, drain", () => {
  it("builds and starts the service once, only after the owner lock, and refuses a second owner without building one", async () => {
    const root = stateRoot();
    const first = prepare(makeFake(), root);
    const second = prepare(makeFake(), root);
    expect((await first.service.start()).outcome).toBe("started");
    expect(first.factory).toHaveBeenCalledTimes(1);
    const refused = await second.service.start();
    expect(refused.outcome).toBe("refused");
    expect(second.factory).not.toHaveBeenCalled();
    await first.service.dispose("test");
  });

  it("serves every operation and the client accessor from the one instance", async () => {
    const fake = makeFake();
    const { service, factory } = prepare(fake);
    expect(service.interactions()).toBeUndefined();
    await service.start();
    expect(service.interactions()).toBe(fake.service);
    const ops = service.operations();
    await ops["interaction.create"]!(
      context({
        kind: "question",
        callId: "call-1",
        questions: [{ id: "q1", question: "Which?" }],
      }),
    );
    await ops["interaction.release"]!(context({ interactionId: "int-1", cause: "abort" }));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.calls.map((c) => c.method)).toEqual(["start", "create", "release"]);
    await service.dispose("test");
    expect(service.interactions()).toBeUndefined();
  });

  it("refuses the Backend start when the store cannot be used, and records nothing as running", async () => {
    for (const code of ["INTERACTION_FORMAT_UNSUPPORTED", "INTERACTION_UNAVAILABLE"] as const) {
      const fake = makeFake({ startResult: { ok: false, code, detail: "no" } });
      const { service } = prepare(fake);
      const result = await service.start();
      expect(result.outcome).toBe("failed");
      expect(service.interactions()).toBeUndefined();
      expect((await service.operations()["interaction.create"]!(context({}))).status).toBe(
        "unavailable",
      );
      await service.dispose("test");
    }
  });

  it("drains the service before the module is joined and reports its waiters as released, not still live", async () => {
    const fake = makeFake();
    const { service } = prepare(fake);
    await service.start();
    const report = await service.dispose("server-teardown");
    expect(report.ok).toBe(true);
    expect(fake.calls.filter((c) => c.method === "drain")).toHaveLength(1);
    expect(JSON.stringify(report.released)).toContain("backend-interactions.wait:int-1");
    expect(report.stillLive).toEqual([]);
    await service.dispose("again");
    expect(fake.calls.filter((c) => c.method === "drain")).toHaveLength(1);
  });
});

describe("the operations: strict arguments, identity from the context only", () => {
  const forged = [
    { sessionId: "session-VICTIM" },
    { rootSessionId: "root-VICTIM" },
    { actor: { clientSessionId: "c1" } },
    { repository: "/etc" },
    { caller: "x" },
    { repo: "/etc" },
    { path: "../../etc" },
    { root: "/etc" },
    { role: "reviewer" },
    { project: { root: "/etc" } },
  ];
  const valid: Record<(typeof SEVEN)[number], Record<string, unknown>> = {
    "interaction.create": {
      kind: "question",
      callId: "call-1",
      questions: [{ id: "q1", question: "Which?" }],
    },
    "interaction.await": { interactionId: "int-1" },
    "interaction.release": { interactionId: "int-1", cause: "abort" },
    "tasks.publish": {
      entryId: "e1",
      seq: 1,
      order: { lifecycle: "2026-11-10T12:00:00.000Z", n: 0 },
      list: [{ content: "write", status: "in_progress" }],
    },
    "plan-mode.get": {},
    "audit.history": { cycle: "v1p1-human-control" },
    "origin.verify": { originId: "org-1" },
  };

  it("rejects an extra key (a session, root, actor or repository claim) before the service runs, for every operation", async () => {
    const fake = makeFake();
    const { service } = prepare(fake);
    await service.start();
    const before = fake.calls.length;
    for (const name of SEVEN)
      for (const extra of forged)
        await expect(
          Promise.resolve().then(() =>
            service.operations()[name]!(context({ ...valid[name], ...extra })),
          ),
        ).rejects.toThrow();
    expect(fake.calls.length).toBe(before);
    await service.dispose("test");
  });

  it("passes the identity the carrier verified, and the decoded arguments, to create, await and release", async () => {
    const fake = makeFake();
    const { service } = prepare(fake);
    await service.start();
    const ops = service.operations();
    const created = await ops["interaction.create"]!(context(valid["interaction.create"]!));
    expect(created).toEqual({ status: "done", result: { ok: true, value: record() } });
    await ops["interaction.await"]!(context(valid["interaction.await"]!));
    await ops["interaction.release"]!(context(valid["interaction.release"]!));
    // The carrier's `kind` travels with the identity: only a main session may open a plan review, and the service refuses an absent kind.
    const who = { sessionId: "session-1", rootSessionId: "root-1", kind: "main" };
    expect(fake.calls.slice(1).map((c) => [c.method, c.args[0]])).toEqual([
      ["create", who],
      ["awaitSegment", who],
      ["release", who],
    ]);
    expect(fake.calls[1]?.args[1]).toEqual(valid["interaction.create"]);
    await service.dispose("test");
  });

  it("refuses a call whose verified identity is incomplete, without running the service", async () => {
    const fake = makeFake();
    const { service } = prepare(fake);
    await service.start();
    const bad = { ...context(valid["interaction.await"]!), rootSessionId: "" };
    expect(await service.operations()["interaction.await"]!(bad)).toEqual({
      status: "unavailable",
      code: "INTERACTION_UNAVAILABLE",
    });
    expect(fake.calls.map((c) => c.method)).toEqual(["start"]);
    await service.dispose("test");
  });

  describe("audit.history (step 23)", () => {
    const project = {
      root: "/work/project",
      place: "foreign" as const,
      settingsPaths: { cycles: "work/cycles/" },
      problems: ["settings: paths.bogus: unknown key"],
    };
    const evidence = { verdict: "unverified", reason: "the cycle has no record" };
    const makeAudit = (
      overrides: {
        access?: AuditPort["access"];
        history?: AuditPort["history"];
      } = {},
    ) => {
      const calls: Array<{ method: string; args: unknown[] }> = [];
      const port: AuditPort = {
        access:
          overrides.access ??
          (async (who) => {
            calls.push({ method: "access", args: [who] });
            return { ok: true, project, role: "reviewer" };
          }),
        history:
          overrides.history ??
          (async (input) => {
            calls.push({ method: "history", args: [input] });
            return evidence;
          }),
      };
      return { port, calls };
    };

    it("checks the carrier-verified caller first, then reads the evidence with THAT session's project and role, and answers it as done", async () => {
      const audit = makeAudit();
      const { service } = prepare(makeFake(), stateRoot(), audit.port);
      await service.start();
      const result = await service.operations()["audit.history"]!(context(valid["audit.history"]!));
      expect(result).toEqual({ status: "done", result: evidence });
      expect(audit.calls.map((c) => c.method)).toEqual(["access", "history"]);
      expect(audit.calls[0]?.args[0]).toEqual({
        sessionId: "session-1",
        rootSessionId: "root-1",
        kind: "main",
      });
      expect(audit.calls[1]?.args[0]).toMatchObject({
        cycle: "v1p1-human-control",
        project,
        role: "reviewer",
      });
      const read = audit.calls[1]?.args[0] as { signal: AbortSignal };
      expect(read.signal.aborted).toBe(false);
      await service.dispose("test");
    });

    it("answers a refused identity or role as XC-6 refused with M03's own code, and reads no evidence", async () => {
      for (const code of [
        "AUTH_IDENTITY_UNAVAILABLE",
        "AUTH_IDENTITY_INVALID",
        "AUTH_ROLE_REMOVED",
        "AUTH_TOOL_NOT_ALLOWED",
      ]) {
        const audit = makeAudit({ access: async () => ({ ok: false, code, reason: "no" }) });
        const { service } = prepare(makeFake(), stateRoot(), audit.port);
        await service.start();
        expect(
          await service.operations()["audit.history"]!(context(valid["audit.history"]!)),
        ).toEqual({ status: "refused", code });
        expect(audit.calls.filter((c) => c.method === "history")).toEqual([]);
        await service.dispose("test");
      }
    });

    it("answers unavailable, never a success, when the check or the evidence port fails", async () => {
      for (const audit of [
        makeAudit({
          access: async () => {
            throw new Error("boom");
          },
        }),
        makeAudit({
          history: async () => {
            throw new Error("boom");
          },
        }),
      ]) {
        const { service } = prepare(makeFake(), stateRoot(), audit.port);
        await service.start();
        expect(
          await service.operations()["audit.history"]!(context(valid["audit.history"]!)),
        ).toEqual({ status: "unavailable", code: "INTERACTION_UNAVAILABLE" });
        await service.dispose("test");
      }
    });

    it("refuses an incomplete verified identity before the check, and decodes strictly before any port runs", async () => {
      const audit = makeAudit();
      const { service } = prepare(makeFake(), stateRoot(), audit.port);
      await service.start();
      const audited = service.operations()["audit.history"]!;
      expect(await audited({ ...context(valid["audit.history"]!), sessionId: "" })).toEqual({
        status: "unavailable",
        code: "INTERACTION_UNAVAILABLE",
      });
      await expect(
        Promise.resolve().then(() => audited(context({ cycle: "c", repo: "/etc" }))),
      ).rejects.toThrow();
      await expect(Promise.resolve().then(() => audited(context({})))).rejects.toThrow();
      expect(audit.calls).toEqual([]);
      await service.dispose("test");
    });

    it("aborts a running read when the Backend drains", async () => {
      let reading!: (signal: AbortSignal) => void;
      const started = new Promise<AbortSignal>((resolve) => {
        reading = resolve;
      });
      const audit = makeAudit({
        history: (input) =>
          new Promise((resolve) => {
            reading(input.signal);
            input.signal.addEventListener("abort", () => resolve({ verdict: "unverified" }), {
              once: true,
            });
          }),
      });
      const { service } = prepare(makeFake(), stateRoot(), audit.port);
      await service.start();
      const running = service.operations()["audit.history"]!(context(valid["audit.history"]!));
      const signal = await started;
      expect(signal.aborted).toBe(false);
      await service.dispose("test");
      expect(signal.aborted).toBe(true);
      await running;
    });
  });

  describe("tasks.publish (step 21)", () => {
    it("passes the carrier-verified identity and the decoded arguments to the service and returns its view as given", async () => {
      const fake = makeFake();
      const { service } = prepare(fake);
      await service.start();
      const result = await service.operations()["tasks.publish"]!(context(valid["tasks.publish"]!));
      expect(result).toMatchObject({
        status: "done",
        result: {
          ok: true,
          value: {
            sessionId: "session-1",
            rootSessionId: "root-1",
            entryId: "e1",
            state: "current",
          },
        },
      });
      expect(fake.calls.slice(1)).toEqual([
        {
          method: "publishTasks",
          args: [
            { sessionId: "session-1", rootSessionId: "root-1", kind: "main" },
            valid["tasks.publish"],
          ],
        },
      ]);
      await service.dispose("test");
    });

    it("relays a stale or unknown answer and a refusal unchanged: nothing is upgraded to a success or to current", async () => {
      for (const reply of [
        { ok: true, value: { state: "unknown" } },
        { ok: true, value: { state: "stale" } },
        {
          ok: false,
          code: "INTERACTION_UNAVAILABLE",
          detail: "the task view could not be written",
        },
      ]) {
        const fake = makeFake({ publishTasks: async () => reply as never });
        const { service } = prepare(fake);
        await service.start();
        expect(
          await service.operations()["tasks.publish"]!(context(valid["tasks.publish"]!)),
        ).toEqual({ status: "done", result: reply });
        await service.dispose("test");
      }
    });

    it("answers unavailable, never throws, when the service fails, so a failed publication cannot fail the caller's write", async () => {
      const fake = makeFake({
        publishTasks: async () => {
          throw new Error("disk");
        },
      });
      const { service } = prepare(fake);
      await service.start();
      expect(
        await service.operations()["tasks.publish"]!(context(valid["tasks.publish"]!)),
      ).toEqual({
        status: "unavailable",
        code: "INTERACTION_UNAVAILABLE",
      });
      await service.dispose("test");
    });

    it("refuses an incomplete verified identity, a missing order and the old order-less shape without running the service", async () => {
      const fake = makeFake();
      const { service } = prepare(fake);
      await service.start();
      const publish = service.operations()["tasks.publish"]!;
      expect(await publish({ ...context(valid["tasks.publish"]!), sessionId: "" })).toEqual({
        status: "unavailable",
        code: "INTERACTION_UNAVAILABLE",
      });
      const { order: _order, ...orderless } = valid["tasks.publish"]!;
      await expect(Promise.resolve().then(() => publish(context(orderless)))).rejects.toThrow();
      await expect(
        Promise.resolve().then(() =>
          publish(
            context({
              ...valid["tasks.publish"],
              order: { lifecycle: "2026-11-10T12:00:00Z", n: 0 },
            }),
          ),
        ),
      ).rejects.toThrow();
      expect(fake.calls.map((c) => c.method)).toEqual(["start"]);
      await service.dispose("test");
    });

    it("answers unavailable while the module is not running", async () => {
      const { service } = prepare(makeFake());
      // Before the Backend starts, the carrier's own not-running answer applies: still unavailable, never done.
      expect(
        await service.operations()["tasks.publish"]!(context(valid["tasks.publish"]!)),
      ).toMatchObject({ status: "unavailable" });
    });
  });

  it("origin.verify is a read-only verdict from the service: the verdict as given, and an unreadable origin unavailable, never verified", async () => {
    const fake = makeFake();
    const { service } = prepare(fake);
    await service.start();
    const expect_ = { kind: "authorization" as const, sessionId: "session-1" };
    expect(
      await service.operations()["origin.verify"]!(context({ originId: "org-1", expect: expect_ })),
    ).toEqual({ status: "done", result: { verified: false, code: "ORIGIN_NOT_FOUND" } });
    expect(
      await service.operations()["origin.verify"]!(context({ originId: "org-unreadable" })),
    ).toEqual({ status: "unavailable", code: "INTERACTION_UNAVAILABLE" });
    expect(fake.calls.filter((c) => c.method === "verifyHumanOrigin")).toEqual([
      { method: "verifyHumanOrigin", args: ["org-1", expect_] },
      { method: "verifyHumanOrigin", args: ["org-unreadable", undefined] },
    ]);
    await service.dispose("test");
  });

  it("reads the plan mode of the transport's session, never of one named in the arguments", async () => {
    const fake = makeFake();
    const { service } = prepare(fake);
    await service.start();
    expect(await service.operations()["plan-mode.get"]!(context({}))).toEqual({
      status: "done",
      result: { ok: true, value: { sessionId: "session-1", active: false, modeRevision: 0 } },
    });
    expect(fake.calls.map((c) => [c.method, c.args[0]])).toEqual([
      ["start", undefined],
      ["getPlanMode", "session-1"],
    ]);
    await service.dispose("test");
  });

  it("lets a subscriber listen to the running service only, and ends it when the Backend drains", async () => {
    const fake = makeFake();
    const { service } = prepare(fake);
    expect(
      service.watchInteractions(
        () => {},
        () => {},
      ),
    ).toBeUndefined();
    await service.start();
    let ended = 0;
    const stop = service.watchInteractions(
      () => {},
      () => void (ended += 1),
    );
    expect(stop).toBeTypeOf("function");
    const unsubscribed = service.watchInteractions(
      () => {},
      () => void (ended += 10),
    );
    unsubscribed?.();
    await service.dispose("server-teardown");
    expect(ended).toBe(1); // the live subscriber was ended once; the unsubscribed one never
    expect(
      service.watchInteractions(
        () => {},
        () => {},
      ),
    ).toBeUndefined();
  });

  it("never returns an XC-6 pending result, and a segment that never settles still resolves done inside its bound", async () => {
    vi.useFakeTimers();
    const fake = makeFake({
      awaitSegment: (_who, _args, opts) =>
        new Promise((resolve) => {
          opts?.signal?.addEventListener("abort", () =>
            resolve({ ok: false, code: "INTERACTION_UNAVAILABLE", detail: "aborted" }),
          );
        }),
    });
    const { service } = prepare(fake);
    const started = service.start();
    await vi.advanceTimersByTimeAsync(0);
    await started;
    const settled = service.operations()["interaction.await"]!(
      context(valid["interaction.await"]!),
    );
    await vi.advanceTimersByTimeAsync(5600);
    const outcome = await settled;
    expect(outcome.status).toBe("done");
    expect(outcome).toMatchObject({ result: { ok: false, code: "INTERACTION_UNAVAILABLE" } });
    await service.dispose("test");
  });
});
