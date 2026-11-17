// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M11 Plan step 14 (C2 P1, C1 U3/R2, C4 K6, C7; D2–D7, D10–D12) — every B1 refusal and lifecycle boundary, each NAMED with the enforcer that supplies it.
//
// Boundary: the production XC-6 carrier core (`createXc6Backend`) over the operations of the REAL prepared Backend adapter, whose `inspect-backend` registration is the real service, registry and
// providers. Scripted: the verified identity (as T3's bearer lookup would give it), M03's caller verdict, the clock and the providers a case needs (a hung one, a malformed one, a canary-holding
// config one). Every operation the carrier is given is wrapped, so the test sees any operation that is not `inspect.*` — the "business-operation trace" — and snapshots the Backend's status, manifest,
// provider list and held work before and after a battery of reads and refusals. It shows the enforcer of each case and that nothing it refuses reaches a provider; it does NOT show M03's real verdict
// (inspectAccess.aetheria.test.ts), T3's HTTP route or bearer lookup, a real page, the Agent's side (outer tests/inspect/b1-boundaries.test.mjs) or a native stack (step 16).
//
// Enforcers (one per refusal, as the Plan asks): ACCESS = the caller check (M03's verdict, refused with its AUTH_* code); GATE = `inspect.enabled` (unavailable); CODEC = the core's closed request
// codec (INSPECT_INVALID, INSPECT_READONLY); REGISTRY = the core's plain-data answer check (INSPECT_READONLY); SERVICE = closed provider answers and the deadline; PROJECTOR = the core's `projectConfig`.
import {
  BACKEND_COMPOSITION_ID,
  backendManifest,
  createAgentAwarenessBackendRegistration,
  createDeliverablesBackendRegistration,
  createDiagnosticsBackendRegistration,
  createGoalsBackendRegistration,
  createGroupsBackendRegistration,
  createHumanControlBackendRegistration,
  createInspectBackendRegistration,
  createOrchestrationBackendRegistration,
  createProvidersBackendRegistration,
  createWorkflowsBackendRegistration,
  prepareAetheriaBackend,
  type InspectAccessPort,
} from "@t3tools/aetheria-server";
import { expect, it } from "vite-plus/test";

import { createXc6Backend, type Xc6Reply } from "./xc6Core.ts";

const CALLER = { threadId: "thread-1", providerSessionId: "ps-1", providerInstanceId: "pi" };
const CANARY = "CANARY-9f2c1d7e-secret";
const CANARY_STORE = "CANARY-store-77aa";
const flush = async () => {
  for (let i = 0; i < 60; i += 1) await Promise.resolve();
};

const makeClock = () => {
  let elapsed = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => 1_700_000_000_000 + elapsed,
    schedule: (ms: number, fn: () => void) => {
      const id = next++;
      timers.set(id, { at: elapsed + ms, fn });
      return () => void timers.delete(id);
    },
    advance: (ms: number) => {
      elapsed += ms;
      for (const [id, timer] of timers)
        if (timer.at <= elapsed) {
          timers.delete(id);
          timer.fn();
        }
    },
    timers: () => timers.size,
  };
};

const CONFIG_MODULE = {
  id: "canary",
  fields: {
    region: { type: "string", required: false, secret: false },
    token: { type: "string", required: false, secret: true },
    stored: { type: "string", required: false, secret: false },
    note: { type: "string", required: false, secret: false },
  },
};

function world(
  options: {
    access?: InspectAccessPort;
    enabled?: boolean;
    showValues?: unknown;
    capBytes?: number;
    clean?: boolean;
    start?: boolean;
  } = {},
) {
  const clock = makeClock();
  const counts = { hung: 0, other: 0 };
  const logs: unknown[] = [];
  let accessChecks = 0;
  const registration = createInspectBackendRegistration({
    access: options.access ?? { check: async () => (accessChecks++, { ok: true }) },
    enablement: { enabled: options.enabled ?? true },
    sources: {
      manifest: () => backendManifest(),
      status: () =>
        prepared.outcome === "prepared" ? prepared.backend.status() : (undefined as never),
    },
    showValues: options.showValues ?? [],
    now: clock.now,
    schedule: clock.schedule,
    log: (event) => logs.push(event),
    ...(options.capBytes === undefined ? {} : { capBytes: options.capBytes }),
  });
  const hold: { release: () => void } = { release: () => undefined };
  // The fixtures are failing providers; `clean` takes them out again so the real providers alone are listed (paging, states).
  const add = (provider: Parameters<typeof registration.registry.register>[0]): void => {
    const dispose = registration.registry.register(provider);
    if (options.clean === true) dispose();
  };
  add({
    providerId: "hung",
    host: "backend",
    list: () => (counts.hung++, new Promise(() => undefined)),
    query: () => (counts.hung++, new Promise(() => undefined)),
  });
  add({
    providerId: "late",
    host: "backend",
    list: () =>
      new Promise((resolve) => {
        counts.other++;
        hold.release = () =>
          resolve({
            total: 1,
            entries: [{ targetId: "x", kind: "thing", state: "active", summary: CANARY }],
          });
      }),
    query: () => new Promise(() => undefined),
  });
  const bad = (providerId: string, answer: () => unknown) =>
    add({
      providerId,
      host: "backend",
      list: () => (counts.other++, answer()),
      query: () => (counts.other++, answer()),
    });
  class Handle {
    run() {
      return CANARY;
    }
  }
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const accessor = {
    total: 1,
    get entries() {
      counts.other += 100;
      return [];
    },
  };
  bad("callable", () => ({ total: 0, entries: [], run: () => CANARY }));
  bad("classy", () => ({ total: 1, entries: [new Handle()] }));
  bad("cyclic", () => cycle);
  bad("accessor", () => accessor);
  bad("symbolic", () => ({ total: 0, entries: [], [Symbol("k")]: CANARY }));
  bad("malformed", () => ({ total: 2, entries: [{ targetId: "a" }] }));
  bad("throws", () => {
    throw new Error(`boom ${CANARY}`);
  });
  registration.registry.register({
    providerId: "canary-config",
    host: "backend",
    list: (page: { offset: number }) => ({
      total: 1,
      entries:
        page.offset === 0
          ? [
              {
                targetId: "canary",
                kind: "module-config",
                state: "active",
                summary: "4 configuration field(s)",
              },
            ]
          : [],
    }),
    query: () => ({
      outcome: "ok",
      state: "active",
      config: {
        module: CONFIG_MODULE,
        values: { region: "eu-west", token: CANARY, stored: CANARY_STORE, note: "kept private" },
        origins: { stored: "credential-store" },
      },
    }),
  });
  const prepared = prepareAetheriaBackend({
    registrations: [
      createAgentAwarenessBackendRegistration(),
      createProvidersBackendRegistration({ composition: BACKEND_COMPOSITION_ID }),
      createHumanControlBackendRegistration({}),
      createOrchestrationBackendRegistration({}),
      createGoalsBackendRegistration(),
      createWorkflowsBackendRegistration({}),
      createGroupsBackendRegistration({}),
      createDeliverablesBackendRegistration({}),
      registration,
      createDiagnosticsBackendRegistration({}),
    ],
  });
  if (prepared.outcome !== "prepared") throw new Error("the Backend did not prepare");
  // The business-operation trace: every operation the carrier is given is wrapped, and the names reached are recorded.
  const reached: string[] = [];
  const operations = Object.fromEntries(
    Object.entries(prepared.backend.operations()).map(([name, fn]) => [
      name,
      (context: never) => (reached.push(name), (fn as (c: never) => unknown)(context)),
    ]),
  );
  const events: Array<{ kind: string; op?: string; status: string; code?: string }> = [];
  const carrier = createXc6Backend({
    identity: () => ({
      ok: true,
      sessionId: "session-1",
      kind: "main",
      rootSessionId: "session-1",
    }),
    operations: operations as never,
    newToken: () => `token-${events.length}`,
    log: (event) => events.push(event),
    maxPending: 4,
  });
  const call = (op: string, args: Record<string, unknown> = {}) =>
    carrier.handle({ caller: CALLER, claimedSessionId: null, body: { v: 1, op, args } });
  const snapshot = () =>
    JSON.stringify({
      status: prepared.backend.status(),
      manifest: backendManifest(),
      providers: registration.registry.providers(),
      held: registration.service.held(),
      inFlight: registration.registry.inFlight(),
      timers: clock.timers(),
    });
  return {
    backend: prepared.backend,
    registration,
    call,
    clock,
    counts,
    logs,
    events,
    reached,
    hold,
    snapshot,
    checks: () => accessChecks,
    started: options.start === false ? Promise.resolve() : prepared.backend.start(),
  };
}

const body = (response: { body: Xc6Reply }) => response.body as Record<string, any>;
const everything = (w: ReturnType<typeof world>, replies: unknown[]) =>
  JSON.stringify({ replies, logs: w.logs, events: w.events });

it("ACCESS: a missing, invalid or removed identity and a child without the tools are M03's refusals, with M03's code, before any provider", async () => {
  for (const code of [
    "AUTH_IDENTITY_UNAVAILABLE",
    "AUTH_IDENTITY_INVALID",
    "AUTH_ROLE_REMOVED",
    "AUTH_TOOL_NOT_ALLOWED",
  ]) {
    const w = world({
      access: { check: async () => ({ ok: false, code, reason: `no ${CANARY}` }) },
    });
    await w.started;
    const replies: unknown[] = [];
    for (const [op, args] of [
      ["inspect.list", { providerId: "hung" }],
      ["inspect.list", {}],
      ["inspect.query", { providerId: "hung", targetId: "a" }],
      ["inspect.query", { providerId: "canary-config", targetId: "canary" }],
    ] as const) {
      const response = await w.call(op, { ...args });
      replies.push(response.body);
      expect(response.http).toBe(403);
      expect(body(response)).toEqual({ v: 1, status: "refused", code });
    }
    expect(w.counts).toEqual({ hung: 0, other: 0 });
    expect(w.reached.every((name) => name.startsWith("inspect."))).toBe(true);
    expect(everything(w, replies)).not.toContain(CANARY);
  }
});

it("GATE: with inspection off both operations are unavailable and neither the caller check nor any provider runs", async () => {
  const w = world({ enabled: false });
  await w.started;
  for (const [op, args] of [
    ["inspect.list", {}],
    ["inspect.query", { providerId: "canary-config", targetId: "canary" }],
  ] as const)
    expect(body(await w.call(op, { ...args }))).toEqual({
      v: 1,
      status: "unavailable",
      code: "INSPECT_UNAVAILABLE",
    });
  expect(w.checks()).toBe(0);
  expect(w.counts).toEqual({ hung: 0, other: 0 });
});

it("CODEC: a write-shaped selector, a verb the contract does not have and an authority-claiming argument are refused and run no provider", async () => {
  const w = world();
  await w.started;
  for (const selector of ["set(a)", "a=b", "delete x", "call run", "a;b", "fields.x`y`", "$(x)"]) {
    const response = await w.call("inspect.query", {
      providerId: "canary-config",
      targetId: "canary",
      selector,
    });
    expect(response.http).toBe(403);
    expect(body(response)).toEqual({ v: 1, status: "refused", code: "INSPECT_READONLY" });
  }
  for (const args of [
    { sessionId: "s" },
    { threadId: "t" },
    { actor: "x" },
    { composition: "builder" },
    { root: "/" },
    { surprise: 1 },
  ])
    expect(body(await w.call("inspect.list", args))).toEqual({
      v: 1,
      status: "refused",
      code: "INSPECT_INVALID",
    });
  expect(body(await w.call("inspect.query", { providerId: "canary-config" }))).toEqual({
    v: 1,
    status: "refused",
    code: "INSPECT_INVALID",
  });
  expect((await w.call("inspect.write", {})).http).toBe(404);
  expect(w.counts).toEqual({ hung: 0, other: 0 });
  expect(w.reached.every((name) => name.startsWith("inspect."))).toBe(true);
});

it("REGISTRY: a provider answer that could call or hold a handle — a function, a class, a cycle, an accessor, a symbol — is INSPECT_READONLY and no getter ran", async () => {
  const w = world();
  await w.started;
  for (const providerId of ["callable", "classy", "cyclic", "accessor", "symbolic"]) {
    const response = await w.call("inspect.list", { providerId });
    expect(body(response)).toEqual({ v: 1, status: "refused", code: "INSPECT_READONLY" });
  }
  expect(w.counts.other).toBe(5);
  expect(everything(w, [])).not.toContain(CANARY);
});

it("SERVICE: a malformed answer and a provider that throws are unavailable (INSPECT_PROVIDER_FAILED) with no provider text in the reply or the log", async () => {
  const w = world();
  await w.started;
  const replies: unknown[] = [];
  for (const providerId of ["malformed", "throws"]) {
    const response = await w.call("inspect.list", { providerId });
    replies.push(response.body);
    expect(body(response)).toEqual({
      v: 1,
      status: "unavailable",
      code: "INSPECT_PROVIDER_FAILED",
    });
  }
  expect(everything(w, replies)).not.toContain(CANARY);
});

it("PROJECTOR: empty, unlisted, listed non-secret, listed secret and credential-store values — only the listed non-secret value leaves, and no canary is in any reply, log or event", async () => {
  const replies: unknown[] = [];
  for (const showValues of [
    [],
    ["canary.note"],
    ["canary.region", "canary.token", "canary.stored"],
    "canary.region",
    ["not a pair", 4],
  ]) {
    const w = world({ showValues });
    await w.started;
    const response = await w.call("inspect.query", {
      providerId: "canary-config",
      targetId: "canary",
    });
    replies.push(response.body);
    const result = body(response).result;
    expect(result.outcome).toBe("ok");
    const shown = Object.keys(result.values).sort();
    const expected = Array.isArray(showValues)
      ? ["region", "note"]
          .filter((name) => (showValues as unknown[]).includes(`canary.${name}`))
          .sort()
      : [];
    expect(shown).toEqual(expected);
    const reasons = Object.fromEntries(
      (result.omitted as Array<{ path: string; reason: string }>).map((o) => [o.path, o.reason]),
    );
    expect(reasons.token).toBe("secret");
    expect(reasons.stored).toBe("credential-store");
    for (const name of ["region", "note"])
      if (!expected.includes(name)) expect(reasons[name]).toBe("not-allowed");
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(JSON.stringify(result)).not.toContain(CANARY_STORE);
    expect(everything(w, replies)).not.toContain(CANARY);
    expect(everything(w, replies)).not.toContain(CANARY_STORE);
    // The exact shape is the XC-4 fields and nothing else: no default, no JSON Schema, no value.
    expect(
      result.shape.fields.map((f: Record<string, unknown>) => Object.keys(f).sort().join()),
    ).toEqual(Array(4).fill("name,required,secret,type"));
  }
  // A selector narrows the shape; it cannot reach a value the projector withheld.
  const w = world({ showValues: ["canary.region"] });
  await w.started;
  const selected = body(
    await w.call("inspect.query", {
      providerId: "canary-config",
      targetId: "canary",
      selector: "fields",
    }),
  );
  expect(JSON.stringify(selected)).not.toContain(CANARY);
});

it("lifecycle states through the real Backend status: every running Backend module is active, listed once, and the Agent's modules are not guessed here", async () => {
  const w = world({ clean: true });
  await w.started;
  const modules = body(await w.call("inspect.list", { providerId: "modules", limit: 100 })).result;
  expect(modules.outcome).toBe("ok");
  const byId = Object.fromEntries(
    modules.entries.map((e: { targetId: string; state: string; host: string }) => [e.targetId, e]),
  );
  expect(byId["inspect-backend"].state).toBe("active");
  expect(Object.keys(byId).length).toBe(modules.total);
  // The Backend lists the Backend composition's own modules, each running; the Agent's modules are the Agent's to report (`agent-status`), so none appears here as a guess.
  expect(
    modules.entries.every(
      (e: { state: string; host: string }) => e.state === "active" && e.host === "backend",
    ),
  ).toBe(true);
  expect(byId["tool-inspect"]).toBeUndefined();
  const comps = body(await w.call("inspect.list", { providerId: "compositions" })).result;
  expect(
    comps.entries.some(
      (e: { targetId: string; state: string }) =>
        e.targetId === "aetheria-backend" && e.state === "active",
    ),
  ).toBe(true);
});

it("pages are stable and the cap is whole-entry at cap−1, cap and cap+1: every entry once, in order, a cut page resumes at nextOffset", async () => {
  const full = world({ clean: true });
  await full.started;
  const all = body(await full.call("inspect.list", { limit: 100 })).result;
  expect(all.outcome).toBe("ok");
  const size = JSON.stringify(all).length; // the service sizes UTF-8 bytes of the result; every entry is ASCII here
  for (const [cap, outcome] of [
    [size + 1, "ok"],
    [size, "ok"],
    [size - 1, "truncated"],
  ] as const) {
    const w = world({ capBytes: cap, clean: true });
    await w.started;
    const first = body(await w.call("inspect.list", { limit: 100 })).result;
    expect(first.outcome).toBe(outcome);
    const seen: unknown[] = [];
    let offset = 0;
    let page = first;
    for (let guard = 0; guard < 200; guard += 1) {
      seen.push(...page.entries);
      if (page.nextOffset === null) break;
      expect(page.nextOffset).toBe(offset + page.entries.length);
      offset = page.nextOffset;
      page = body(await w.call("inspect.list", { offset, limit: 100 })).result;
    }
    expect(seen).toEqual(all.entries);
  }
  const pages: unknown[] = [];
  const small = world({ clean: true });
  await small.started;
  let offset = 0;
  for (let guard = 0; guard < 200; guard += 1) {
    const page = body(await small.call("inspect.list", { offset, limit: 3 })).result;
    expect(page.total).toBe(all.total);
    pages.push(...page.entries);
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  expect(pages).toEqual(all.entries);
  expect(body(await small.call("inspect.list", { offset: all.total + 10 })).result.entries).toEqual(
    [],
  );
});

it("DEADLINE: a hung call is held to D and answers done/timeout; a late reply is dropped, and nothing is left waiting; duplicate and disposed providers are refused", async () => {
  const w = world();
  await w.started;
  const held = w.call("inspect.list", { providerId: "late" });
  await flush();
  expect(w.registration.service.held()).toBe(1);
  w.clock.advance(10_000);
  const reply = await held;
  expect(body(reply)).toMatchObject({ v: 1, status: "done", result: { outcome: "timeout" } });
  w.hold.release();
  await flush();
  expect(JSON.stringify(reply.body)).not.toContain(CANARY);
  expect([
    w.registration.service.held(),
    w.registration.registry.inFlight(),
    w.clock.timers(),
  ]).toEqual([0, 0, 0]);
  expect(() =>
    w.registration.registry.register({
      providerId: "hung",
      host: "backend",
      list: () => ({}),
      query: () => ({}),
    }),
  ).toThrow(/already registered/);
  // The first registration is untouched: the duplicate neither replaced nor disposed it.
  expect(w.registration.registry.providers()).toContain("hung");
  const handle = w.registration.registry.get("hung")!;
  const dispose = w.registration.registry.providers();
  expect(dispose.length).toBeGreaterThan(0);
  const report = await w.backend.dispose("test over");
  expect(report.ok).toBe(true);
  expect(handle.alive()).toBe(false);
  expect(await handle.list({ offset: 0, limit: 1 })).toEqual({
    status: "unavailable",
    code: "INSPECT_UNAVAILABLE",
  });
});

it("NO EFFECT: a battery of reads, refusals, timeouts and malformed answers leaves the Backend's status, manifest, providers and held work as they were, and reaches no operation but inspect.*", async () => {
  const w = world({ showValues: ["canary.region"] });
  await w.started;
  const before = w.snapshot();
  const calls: Array<Promise<{ body: Xc6Reply }>> = [];
  const plan: Array<[string, Record<string, unknown>]> = [
    ["inspect.list", {}],
    ["inspect.list", { providerId: "modules" }],
    ["inspect.list", { providerId: "hung" }],
    ["inspect.list", { providerId: "callable" }],
    ["inspect.list", { providerId: "malformed" }],
    ["inspect.list", { sessionId: "forged" }],
    ["inspect.query", { providerId: "modules", targetId: "inspect-backend" }],
    [
      "inspect.query",
      { providerId: "modules", targetId: "inspect-backend", selector: "declared.services" },
    ],
    ["inspect.query", { providerId: "modules", targetId: "inspect-backend", selector: "set(x)" }],
    ["inspect.query", { providerId: "config", targetId: "inspect-backend" }],
    ["inspect.query", { providerId: "canary-config", targetId: "canary" }],
    ["inspect.query", { providerId: "hung", targetId: "a" }],
    ["inspect.query", { providerId: "nope", targetId: "a" }],
  ];
  for (let round = 0; round < 3; round += 1)
    for (const [op, args] of plan) calls.push(w.call(op, { ...args }));
  await flush();
  w.clock.advance(10_000);
  const replies = await Promise.all(calls);
  expect(replies).toHaveLength(plan.length * 3);
  expect(replies.every((r) => !("token" in r.body))).toBe(true);
  expect(w.snapshot()).toBe(before);
  expect(w.reached.length).toBe(plan.length * 3);
  expect(w.reached.every((name) => name === "inspect.list" || name === "inspect.query")).toBe(true);
  expect(w.events.some((e) => e.status === "pending")).toBe(false);
  expect(
    everything(
      w,
      replies.map((r) => r.body),
    ),
  ).not.toContain(CANARY);
});

it("a pending reply is not part of the contract: a mutated service that returned pending would show as pending on the wire, and none does", async () => {
  const w = world();
  await w.started;
  const calls = ["inspect.list", "inspect.query"].map((op) =>
    w.call(
      op,
      op === "inspect.list" ? { providerId: "hung" } : { providerId: "hung", targetId: "a" },
    ),
  );
  await flush();
  w.clock.advance(10_000);
  for (const reply of await Promise.all(calls)) {
    expect(body(reply).status).toBe("done");
    expect(body(reply).status).not.toBe("pending");
  }
  expect(w.events.some((e) => e.status === "pending")).toBe(false);
});
