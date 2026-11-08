// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M04 Plan step 12 — the Backend adapter, tested at its own boundary: registrations against a build-time allowlist, the whole
// composition validated by the shared runtime validator (from the pinned @aetheria/awareness archive) before any module is called,
// start in dependency order, reverse and idempotent drain, an honest XC-7 report, and observers that cannot act.
//
// What this shows: the adapter's behaviour with real runtime validation and lifecycle code from the real archive, and scripted
// activations. What it does not show: the join into T3's server layer graph (step 16), a real board or any real module's effects.
import { decodeAetheriaCompositionStatus, type Xc6Operation } from "@t3tools/aetheria-contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  prepareBackend,
  type BackendAdapter,
  type BackendEvent,
  type BackendRegistration,
  type PrepareOptions,
} from "./adapter.ts";

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  host: "backend",
  entry: `test:${id}`,
  required: true,
  mutatesToolInput: false,
  owns: [`${id}-state`],
  contract: {
    consumer: "the test",
    success: "ready",
    failure: "refused",
    uncertainty: "unknown",
    stateOwner: `${id}-state`,
  },
  ...over,
});
const manifestOf = (modules: unknown[], selected: string[]) => ({
  schema: 1,
  modules,
  compositions: [
    { id: "base", identity: { name: "Base", description: "test", order: 0 }, modules: selected },
  ],
});
const clean = { released: ["handle"], stopped: [], transferred: [], stillLive: [] };

interface Script {
  readonly start?: () => unknown;
  readonly drain?: () => unknown;
  readonly operations?: Record<string, Xc6Operation>;
}
function world(ids: readonly string[], scripts: Record<string, Script> = {}) {
  const events: string[] = [];
  const registrations: BackendRegistration[] = ids.map((id) => ({
    entry: `test:${id}`,
    activation: {
      start: async () => {
        events.push(`start:${id}`);
        await scripts[id]?.start?.();
      },
      drain: async () => {
        events.push(`drain:${id}`);
        return scripts[id]?.drain ? scripts[id].drain() : clean;
      },
    },
    ...(scripts[id]?.operations ? { operations: scripts[id].operations } : {}),
  }));
  return { events, registrations };
}
const options = (
  over: Partial<PrepareOptions> & Pick<PrepareOptions, "manifest" | "registrations">,
): PrepareOptions => ({
  composition: "base",
  allowlist: ["test:a", "test:b", "test:c", "test:d"],
  ...over,
});
function prepared(o: PrepareOptions): BackendAdapter {
  const result = prepareBackend(o);
  if (result.outcome !== "prepared")
    throw new Error(
      `expected a prepared Backend; refused with ${result.faults.map((f) => f.code).join(", ")}`,
    );
  return result.backend;
}
const codes = (faults: readonly { code: string }[]) => faults.map((f) => f.code);
const chain = [
  row("a"),
  row("b", { requires: { modules: ["a"] } }),
  row("c", { requires: { modules: ["b"] } }),
];

describe("registration and allowlist", () => {
  it("refuses a registration whose entry is not on the build-time allowlist, and calls no module", () => {
    const { events, registrations } = world(["a", "d"]);
    const result = prepareBackend(
      options({ manifest: manifestOf([row("a")], ["a"]), registrations, allowlist: ["test:a"] }),
    );
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused")
      expect(codes(result.faults)).toContain("registration-not-allowlisted");
    expect(events).toEqual([]);
  });

  it("refuses a manifest entry that is not on the allowlist (the shared validator) together with the registration fault", () => {
    const { registrations } = world(["a"]);
    const result = prepareBackend(
      options({ manifest: manifestOf([row("a")], ["a"]), registrations, allowlist: [] }),
    );
    expect(result.outcome === "refused" && codes(result.faults).sort()).toEqual([
      "entry-not-allowlisted",
      "registration-not-allowlisted",
    ]);
  });

  it("refuses a selected module with no registration, a registration nothing selects, and a duplicate entry — all named at once", () => {
    const { registrations } = world(["a", "d", "d"]);
    const result = prepareBackend(
      options({ manifest: manifestOf([row("a"), row("b")], ["a", "b"]), registrations }),
    );
    expect(result.outcome === "refused" && codes(result.faults).sort()).toEqual([
      "module-not-registered",
      "registration-duplicate",
      "registration-not-selected",
    ]);
  });

  it("takes the host and the allowlist from the adapter, never from the supplied facts", () => {
    const { registrations } = world(["a"]);
    const agentRow = row("a", { host: "agent" });
    const result = prepareBackend(
      options({ manifest: manifestOf([agentRow], ["a"]), registrations }),
    );
    expect(result.outcome === "refused" && codes(result.faults)).toEqual(["host-not-hosted"]);
  });
});

describe("whole-composition validation", () => {
  it("refuses an invalid composition with every fault named, before any module is called", () => {
    const { events, registrations } = world(["a", "b"]);
    const bad = [
      row("a", { requires: { modules: ["nowhere"] } }),
      row("b", { host: "client" }),
      row("c", { entry: "test:zzz" }),
    ];
    const result = prepareBackend(
      options({ manifest: manifestOf(bad, ["a", "b", "c"]), registrations }),
    );
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") {
      expect(codes(result.faults)).toEqual(
        expect.arrayContaining(["missing-requirement", "host-not-hosted", "entry-not-allowlisted"]),
      );
      expect(new Set(result.faults.map((f) => f.subject)).size).toBeGreaterThanOrEqual(3);
    }
    expect(events).toEqual([]);
  });

  it("refuses a stale artifact stamp declared by a module against the stamp this build carries", () => {
    const { registrations } = world(["a"]);
    const stale = row("a", {
      compat: { artifacts: { "@aetheria/awareness": { stamp: `sha256:${"0".repeat(64)}` } } },
    });
    const result = prepareBackend(options({ manifest: manifestOf([stale], ["a"]), registrations }));
    expect(result.outcome === "refused" && codes(result.faults)).toEqual(["stale-stamp"]);
  });
});

describe("start and drain", () => {
  it("starts in dependency order and drains in reverse, once, with a cached report", async () => {
    const { events, registrations } = world(["a", "b", "c"]);
    const backend = prepared(
      options({ manifest: manifestOf(chain, ["c", "b", "a"]), registrations }),
    );
    const started = await backend.start();
    expect(started.outcome).toBe("started");
    expect(events).toEqual(["start:a", "start:b", "start:c"]);
    expect(await backend.start()).toBe(started);
    expect(events).toHaveLength(3);

    const first = await backend.dispose("server stopping");
    expect(events.slice(3)).toEqual(["drain:c", "drain:b", "drain:a"]);
    expect(first.ok).toBe(true);
    expect(first.order).toEqual(["c", "b", "a"]);
    expect(first.reason).toBe("server stopping");
    const again = await backend.dispose("a different reason");
    expect(again).toBe(first);
    expect(events).toHaveLength(6);
  });

  it("needs a reason to dispose and attempts nothing for a Backend that never started", async () => {
    const { events, registrations } = world(["a"]);
    const backend = prepared(options({ manifest: manifestOf([row("a")], ["a"]), registrations }));
    expect(() => backend.dispose("")).toThrow();
    const report = await backend.dispose("never started");
    expect(report.order).toEqual([]);
    expect(report.ok).toBe(true);
    expect(events).toEqual([]);
    expect(backend.status().phase).toBe("disposed");
  });

  it("rolls back a failed required start: earlier modules are drained in reverse and the failure is reported", async () => {
    const { events, registrations } = world(["a", "b", "c"], {
      b: {
        start: () => {
          throw new Error("b could not start /Users/secret/path");
        },
      },
    });
    const backend = prepared(
      options({ manifest: manifestOf(chain, ["a", "b", "c"]), registrations }),
    );
    const started = await backend.start();
    expect(started.outcome).toBe("failed");
    expect(events).toEqual(["start:a", "start:b", "drain:b", "drain:a"]);
    expect(backend.status().phase).toBe("failed");
    expect((await backend.dispose("after failure")).order).toEqual(["b", "a"]);
  });

  it("waits for a start in flight when disposed during it, then releases what started", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { events, registrations } = world(["a", "b"], { a: { start: () => gate } });
    const backend = prepared(
      options({
        manifest: manifestOf([row("a"), row("b", { requires: { modules: ["a"] } })], ["a", "b"]),
        registrations,
      }),
    );
    const starting = backend.start();
    const disposing = backend.dispose("stop during start");
    release();
    expect((await starting).outcome).toBe("stopped");
    expect((await disposing).order).toEqual(["a"]);
    expect(events).toEqual(["start:a", "drain:a"]);
    expect(backend.status().phase).toBe("disposed");
  });
});

describe("the XC-7 disposal report is honest", () => {
  it("reports a drain that throws, a module still live, and a drain it cannot read — and still drains every other module", async () => {
    const { events, registrations } = world(["a", "b", "c"], {
      a: { drain: () => ({ released: [], stopped: [], transferred: [], stillLive: ["listener"] }) },
      b: {
        drain: () => {
          throw new Error("socket stuck");
        },
      },
      c: { drain: () => "released everything" },
    });
    const backend = prepared(
      options({
        manifest: manifestOf([row("a"), row("b"), row("c")], ["a", "b", "c"]),
        registrations,
      }),
    );
    await backend.start();
    const report = await backend.dispose("test");
    expect(report.ok).toBe(false);
    expect(report.stillLive).toEqual([{ module: "a", item: "listener" }]);
    expect(report.failed).toEqual([{ module: "b", message: "socket stuck" }]);
    expect(report.unobserved.map((u) => u.module)).toEqual(["c"]);
    expect(events.filter((e) => e.startsWith("drain")).sort()).toEqual([
      "drain:a",
      "drain:b",
      "drain:c",
    ]);
    const summary = backend.status().disposal;
    expect(summary).toMatchObject({
      ok: false,
      stillLive: 1,
      failedModules: ["b"],
      unobservedModules: ["c"],
    });
  });

  it("records a transfer with its receiver and confirmation", async () => {
    const transfer = {
      released: [],
      stopped: [],
      transferred: [{ item: "board-lock", to: "agent-host", confirmation: "ack-1" }],
      stillLive: [],
    };
    const { registrations } = world(["a"], { a: { drain: () => transfer } });
    const backend = prepared(options({ manifest: manifestOf([row("a")], ["a"]), registrations }));
    await backend.start();
    const report = await backend.dispose("handover");
    expect(report.ok).toBe(true);
    expect(report.transferred).toEqual([
      { module: "a", item: "board-lock", to: "agent-host", confirmation: "ack-1" },
    ]);
  });
});

describe("observers", () => {
  it("get frozen events, hold only a close handle, and cannot change a start or a disposal", async () => {
    const { registrations } = world(["a"]);
    const backend = prepared(options({ manifest: manifestOf([row("a")], ["a"]), registrations }));
    const seen: BackendEvent[] = [];
    const handle = backend.observe((event) => {
      seen.push(event);
      try {
        (event as { kind: string }).kind = "tampered";
      } catch {
        /* a frozen event refuses the write */
      }
      throw new Error("observer failure is swallowed");
    });
    const rejecting = backend.observe(async () => {
      throw new Error("async observer failure");
    });
    expect(Object.keys(handle)).toEqual(["close"]);
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.keys(rejecting)).toEqual(["close"]);

    const started = await backend.start();
    expect(started.outcome).toBe("started");
    const report = await backend.dispose("done");
    expect(report.ok).toBe(true);
    expect(seen.map((e) => e.kind)).toEqual(["started", "disposed"]);
    expect(seen.every((e) => Object.isFrozen(e))).toBe(true);
  });

  it("stop receiving events after close, and see nothing that happened before they registered", async () => {
    const { registrations } = world(["a"]);
    const backend = prepared(options({ manifest: manifestOf([row("a")], ["a"]), registrations }));
    await backend.start();
    const late: string[] = [];
    const closed: string[] = [];
    backend.observe((e) => {
      late.push(e.kind);
    });
    backend
      .observe((e) => {
        closed.push(e.kind);
      })
      .close();
    await backend.dispose("end");
    expect(late).toEqual(["disposed"]);
    expect(closed).toEqual([]);
  });

  it("have no way to register an operation", () => {
    const { registrations } = world(["a"]);
    const backend = prepared(options({ manifest: manifestOf([row("a")], ["a"]), registrations }));
    expect(Object.keys(backend.observe(() => {}))).not.toContain("register");
    expect(Object.isFrozen(backend.operations())).toBe(true);
  });
});

describe("XC-6 operation registration seam", () => {
  const ping: Xc6Operation = () => ({ status: "done", result: "pong" });
  const context = {
    caller: { threadId: "t", providerSessionId: "p", providerInstanceId: "i" },
    sessionId: "s",
    kind: "main",
    rootSessionId: "s",
    args: {},
  };

  it("serves a module's operations only while that module and the Backend are running", async () => {
    const { registrations } = world(["a"], { a: { operations: { "board.ping": ping } } });
    const backend = prepared(options({ manifest: manifestOf([row("a")], ["a"]), registrations }));
    const ops = backend.operations();
    expect(Object.getPrototypeOf(ops)).toBeNull();
    expect(Object.keys(ops)).toEqual(["board.ping"]);
    expect(await ops["board.ping"]!(context)).toEqual({
      status: "unavailable",
      code: "XC6_BACKEND_NOT_RUNNING",
    });
    await backend.start();
    expect(await ops["board.ping"]!(context)).toEqual({ status: "done", result: "pong" });
    await backend.dispose("stop");
    expect(await ops["board.ping"]!(context)).toEqual({
      status: "unavailable",
      code: "XC6_BACKEND_NOT_RUNNING",
    });
  });

  it("refuses an invalid or duplicated operation name when preparing, naming each", () => {
    const { registrations } = world(["a", "b"], {
      a: { operations: { "Bad Name": ping, "board.ping": ping } },
      b: { operations: { "board.ping": ping, constructor: ping } },
    });
    const result = prepareBackend(
      options({ manifest: manifestOf([row("a"), row("b")], ["a", "b"]), registrations }),
    );
    expect(
      result.outcome === "refused" && result.faults.map((f) => `${f.code}:${f.subject}`).sort(),
    ).toEqual(
      [
        "operation-duplicate:operation:board.ping",
        "operation-name-invalid:operation:Bad Name",
      ].sort(),
    );
  });

  it("registers no operation for a module that the composition does not select", () => {
    const { registrations } = world(["a", "d"], { d: { operations: { "x.y": ping } } });
    const result = prepareBackend(
      options({ manifest: manifestOf([row("a")], ["a"]), registrations }),
    );
    expect(result.outcome === "refused" && codes(result.faults)).toEqual([
      "registration-not-selected",
    ]);
  });
});

describe("safe composition and lifecycle status", () => {
  it("decodes as the contract's strict shape, carries the digest and artifact stamp, and no failure text", async () => {
    const { registrations } = world(["a", "b"], {
      b: {
        start: () => {
          throw new Error("secret failure /Users/x/.ssh");
        },
      },
    });
    const backend = prepared(
      options({
        manifest: manifestOf([row("a"), row("b", { required: false })], ["a", "b"]),
        registrations,
      }),
    );
    expect(backend.status().phase).toBe("prepared");
    await backend.start();
    const status = backend.status();
    const decoded = decodeAetheriaCompositionStatus(status);
    expect(decoded.phase).toBe("running");
    expect(decoded.modules.map((m) => `${m.id}:${m.state}`)).toEqual(["a:running", "b:skipped"]);
    expect(decoded.digest.value).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(decoded.digest.version).toBe(1);
    expect(decoded.artifact).toMatchObject({ package: "@aetheria/awareness", version: "0.1.0" });
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(JSON.stringify(status)).not.toContain("/Users");
    expect(decoded.disposal).toBeNull();
  });

  it("is the same digest for the same composition and a different digest for a different one", () => {
    const one = prepared(
      options({
        manifest: manifestOf([row("a")], ["a"]),
        registrations: world(["a"]).registrations,
      }),
    );
    const two = prepared(
      options({
        manifest: manifestOf([row("a")], ["a"]),
        registrations: world(["a"]).registrations,
      }),
    );
    const other = prepared(
      options({
        manifest: manifestOf([row("a"), row("b")], ["a", "b"]),
        registrations: world(["a", "b"]).registrations,
      }),
    );
    expect(one.status().digest.value).toBe(two.status().digest.value);
    expect(one.status().digest.value).not.toBe(other.status().digest.value);
  });
});
