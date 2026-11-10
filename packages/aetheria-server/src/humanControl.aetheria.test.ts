// @effect-diagnostics nodeBuiltinImport:off
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
import type { HumanControlService } from "./humanControl.ts";
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
    redeliver: async (sessionId) => {
      note("redeliver", sessionId);
      return { ok: true, value: { delivered: 0, failed: 0, pending: 0 } };
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

const prepare = (fake: ReturnType<typeof makeFake>, root = stateRoot()) => {
  const factory = vi.fn(() => fake.service);
  const made = createAetheriaBackendService({
    stateRoot: root,
    credentialOf: () => undefined,
    interactionFactory: factory,
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
  ];
  const valid: Record<(typeof SEVEN)[number], Record<string, unknown>> = {
    "interaction.create": {
      kind: "question",
      callId: "call-1",
      questions: [{ id: "q1", question: "Which?" }],
    },
    "interaction.await": { interactionId: "int-1" },
    "interaction.release": { interactionId: "int-1", cause: "abort" },
    "tasks.publish": { entryId: "e1", seq: 1, list: [] },
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
    const who = { sessionId: "session-1", rootSessionId: "root-1" };
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

  it("answers unavailable, never a success, for the operations whose steps are not built", async () => {
    const fake = makeFake();
    const { service } = prepare(fake);
    await service.start();
    for (const name of [
      "tasks.publish",
      "plan-mode.get",
      "audit.history",
      "origin.verify",
    ] as const)
      expect(await service.operations()[name]!(context(valid[name]))).toEqual({
        status: "unavailable",
        code: "INTERACTION_UNAVAILABLE",
      });
    expect(fake.calls.map((c) => c.method)).toEqual(["start"]);
    await service.dispose("test");
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
