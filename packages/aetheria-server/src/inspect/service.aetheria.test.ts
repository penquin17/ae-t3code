// @effect-diagnostics globalDate:off
// AETHERIA M11 Plan step 8 (C2 P1; D5–D7, D10–D12) — the inspection service's caller, deployment, read-only and held-call boundaries.
//
// Boundary: the real service over the real provider registry from the installed `@aetheria/inspect` archive, with scripted providers, a scripted caller check and a scripted clock and scheduler (so
// the deadline is a number the test moves, not a wait). It shows: with inspection off, or the Backend draining, both operations answer `unavailable` before the caller check and before any provider;
// a refused caller reaches no provider and an invalid or write-shaped request reaches none either; an unknown `inspect.*` name is INSPECT_READONLY; a call is held to the Backend's one deadline and
// answers `done` with a `timeout` outcome, the registry's waiting work is removed and the provider's late answer is dropped; 300 abandoned calls leave nothing held; drain settles held calls
// unavailable and counts them; paging runs across providers in a stable order; a malformed or capability-carrying provider answer is unavailable or INSPECT_READONLY, never a partial success; a
// configuration value reaches a result only through the projector; and the log carries no value. It does NOT show M03's real verdict (inspectAccess.aetheria.test.ts), the XC-6 carrier
// (apps/server inspectXc6.aetheria.test.ts), a real Backend lifecycle, or any provider over real sources (statusProviders and metadataProviders tests).
import type { Xc6OperationContext } from "@t3tools/aetheria-contracts";
import { describe, expect, it } from "vite-plus/test";

import type { InspectAccessPort } from "./inspectAccess.ts";
import {
  createProviderRegistry,
  type InspectHost,
  type InspectProvider,
  type ProviderRegistry,
} from "./inspectEntry.ts";
import {
  createInspectService,
  resolveInspectEnabled,
  type InspectLogEvent,
  type InspectSettled,
} from "./service.ts";

const flush = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

/** A clock and scheduler the test moves. */
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

const context = (args: Record<string, unknown>, sessionId = "session-1"): Xc6OperationContext => ({
  caller: { threadId: "thread-1", providerSessionId: "ps-1", providerInstanceId: "pi" },
  sessionId,
  kind: "main",
  rootSessionId: sessionId,
  args,
});

const entry = (n: number) => ({
  targetId: `t${String(n).padStart(2, "0")}`,
  kind: "module",
  state: "active",
  summary: `entry ${n}`,
});

interface Script {
  calls: { list: number; query: number };
  list?: (page: { offset: number; limit: number; kind?: string }) => unknown;
  query?: (request: { targetId: string }) => unknown;
}
const scripted = (id: string, host: InspectHost, script: Script): InspectProvider => ({
  providerId: id,
  host,
  list: (page) => {
    script.calls.list += 1;
    return script.list === undefined ? { total: 0, entries: [] } : script.list(page);
  },
  query: (request) => {
    script.calls.query += 1;
    return script.query === undefined ? { outcome: "unavailable" } : script.query(request);
  },
});
const script = (partial: Partial<Script> = {}): Script => ({
  calls: { list: 0, query: 0 },
  ...partial,
});
const itemsOf =
  (items: number[]): NonNullable<Script["list"]> =>
  (page) => ({
    total: items.length,
    entries: items.slice(page.offset, page.offset + page.limit).map(entry),
  });

const ALLOW: InspectAccessPort = { check: async () => ({ ok: true }) };

const build = (
  options: {
    enabled?: boolean;
    access?: InspectAccessPort;
    providers?: Array<[InspectHost, InspectProvider]>;
    showValues?: unknown;
    capBytes?: number;
    log?: (event: InspectLogEvent) => void;
  } = {},
) => {
  const clock = makeClock();
  const registries = new Map<InspectHost, ProviderRegistry>();
  for (const [host, provider] of options.providers ?? []) {
    const registry = registries.get(host) ?? createProviderRegistry({ host });
    registries.set(host, registry);
    registry.register(provider);
  }
  const service = createInspectService({
    access: options.access ?? ALLOW,
    enabled: options.enabled ?? true,
    registries: [...registries].map(([host, registry]) => ({ host, registry })),
    showValues: options.showValues ?? [],
    now: clock.now,
    schedule: clock.schedule,
    ...(options.capBytes === undefined ? {} : { capBytes: options.capBytes }),
    ...(options.log === undefined ? {} : { log: options.log }),
  });
  return { service, clock, registries };
};

const resultOf = (settled: InspectSettled) =>
  (settled as { result: Record<string, unknown> }).result;

describe("whether inspection is on", () => {
  it("is on for an explicit true or a deployment marked local, and fails closed for everything else", () => {
    expect(resolveInspectEnabled({ enabled: true })).toBe(true);
    expect(resolveInspectEnabled({ deployment: "local" })).toBe(true);
    expect(resolveInspectEnabled({ enabled: true, deployment: "remote" })).toBe(true);
    expect(resolveInspectEnabled({ enabled: false, deployment: "local" })).toBe(false);
    for (const deployment of ["remote", "", "LOCAL", 1, null, undefined, {}])
      expect(resolveInspectEnabled({ deployment }), String(deployment)).toBe(false);
    for (const enabled of ["true", 1, null, [], {}, "yes"])
      expect(resolveInspectEnabled({ enabled, deployment: "local" }), String(enabled)).toBe(false);
    expect(resolveInspectEnabled({})).toBe(false);
  });
});

describe("the boundaries before a provider runs", () => {
  it("answers unavailable when inspection is off, asking neither the caller check nor a provider", async () => {
    const s = script();
    let checks = 0;
    const { service } = build({
      enabled: false,
      access: { check: async () => (checks++, { ok: true }) },
      providers: [["backend", scripted("modules", "backend", s)]],
    });
    for (const op of ["inspect.list", "inspect.query"]) {
      const args = op === "inspect.list" ? {} : { providerId: "modules", targetId: "a" };
      expect(await service.serve(op, context(args))).toEqual({
        status: "unavailable",
        code: "INSPECT_UNAVAILABLE",
      });
    }
    expect(checks).toBe(0);
    expect(s.calls).toEqual({ list: 0, query: 0 });
  });

  it("refuses a caller M03 does not authorize with M03's code and runs no provider, whatever the arguments", async () => {
    const s = script();
    const { service } = build({
      access: { check: async () => ({ ok: false, code: "AUTH_TOOL_NOT_ALLOWED", reason: "x" }) },
      providers: [["backend", scripted("modules", "backend", s)]],
    });
    expect(await service.serve("inspect.list", context({}))).toEqual({
      status: "refused",
      code: "AUTH_TOOL_NOT_ALLOWED",
    });
    expect(
      await service.serve("inspect.query", context({ providerId: "modules", targetId: "a" })),
    ).toEqual({ status: "refused", code: "AUTH_TOOL_NOT_ALLOWED" });
    // Even a request that is not valid is answered with the caller's refusal first: an unauthorized caller learns nothing about the request.
    expect(await service.serve("inspect.list", context({ sessionId: "other" }))).toEqual({
      status: "refused",
      code: "AUTH_TOOL_NOT_ALLOWED",
    });
    expect(s.calls).toEqual({ list: 0, query: 0 });
  });

  it("asks the caller check about the carrier's session and the operation, never an argument", async () => {
    const seen: Array<[string, string]> = [];
    const { service } = build({
      access: { check: async (session, op) => (seen.push([session, op]), { ok: true }) },
      providers: [["backend", scripted("modules", "backend", script())]],
    });
    await service.serve("inspect.list", context({}, "carrier-session"));
    await service.serve("inspect.list", context({ sessionId: "forged" }, "carrier-session"));
    expect(seen).toEqual([
      ["carrier-session", "inspect.list"],
      ["carrier-session", "inspect.list"],
    ]);
  });

  it("refuses a request that claims authority, is not the closed shape, or names a write, before any provider", async () => {
    const s = script();
    const { service } = build({ providers: [["backend", scripted("modules", "backend", s)]] });
    const claims = [
      { sessionId: "x" },
      { threadId: "t" },
      { actor: "a" },
      { composition: "c" },
      { surprise: 1 },
    ];
    for (const args of claims)
      expect(await service.serve("inspect.list", context(args)), JSON.stringify(args)).toEqual({
        status: "refused",
        code: "INSPECT_INVALID",
      });
    for (const selector of ["call(x)", "run now", "a=1", "a;b", "set value"])
      expect(
        await service.serve(
          "inspect.query",
          context({ providerId: "modules", targetId: "a", selector }),
        ),
        selector,
      ).toEqual({ status: "refused", code: "INSPECT_READONLY" });
    expect(s.calls).toEqual({ list: 0, query: 0 });
  });

  it("serves exactly two operations; another inspect verb is INSPECT_READONLY and anything else is the carrier's unknown operation", async () => {
    const s = script();
    const { service } = build({ providers: [["backend", scripted("modules", "backend", s)]] });
    expect(Object.keys(service.operations()).sort()).toEqual(["inspect.list", "inspect.query"]);
    for (const verb of ["inspect.write", "inspect.call", "inspect.invoke", "inspect."])
      expect(await service.serve(verb, context({})), verb).toEqual({
        status: "refused",
        code: "INSPECT_READONLY",
      });
    expect(await service.serve("board.read", context({}))).toEqual({
      status: "refused",
      code: "XC6_UNKNOWN_OPERATION",
    });
    expect(s.calls).toEqual({ list: 0, query: 0 });
  });
});

describe("a held call", () => {
  it("answers done with a timeout outcome at the Backend's deadline, removes the waiting work and drops the late answer", async () => {
    let release: (value: unknown) => void = () => undefined;
    const slow = new Promise((resolve) => (release = resolve));
    const s = script({ list: () => slow });
    const { service, clock, registries } = build({
      providers: [["backend", scripted("slow", "backend", s)]],
    });
    let settled: InspectSettled | undefined;
    void service.serve("inspect.list", context({})).then((r) => (settled = r));
    await flush();
    expect(settled).toBeUndefined();
    expect(service.held()).toBe(1);
    expect(registries.get("backend")?.inFlight()).toBe(1);
    clock.advance(9_999);
    await flush();
    expect(settled).toBeUndefined();
    clock.advance(1);
    await flush();
    expect(settled).toMatchObject({ status: "done", result: { outcome: "timeout" } });
    expect(Object.keys(resultOf(settled as InspectSettled)).sort()).toEqual([
      "capturedAt",
      "outcome",
    ]);
    expect(service.held()).toBe(0);
    expect(registries.get("backend")?.inFlight()).toBe(0);
    release({ total: 1, entries: [entry(1)] });
    await flush();
    expect(settled).toMatchObject({ result: { outcome: "timeout" } });
  });

  it("a timed-out query names its provider and target and nothing else", async () => {
    const s = script({ query: () => new Promise(() => undefined) });
    const { service, clock } = build({ providers: [["backend", scripted("slow", "backend", s)]] });
    let settled: InspectSettled | undefined;
    void service
      .serve("inspect.query", context({ providerId: "slow", targetId: "x" }))
      .then((r) => (settled = r));
    await flush();
    clock.advance(10_000);
    await flush();
    expect(resultOf(settled as InspectSettled)).toMatchObject({
      outcome: "timeout",
      providerId: "slow",
      targetId: "x",
    });
  });

  it("an answer before the deadline cancels the timer; no call is ever pending", async () => {
    const { service, clock } = build({
      providers: [["backend", scripted("modules", "backend", script({ list: itemsOf([1, 2]) }))]],
    });
    const settled = await service.serve("inspect.list", context({}));
    expect(settled.status).toBe("done");
    expect(clock.timers()).toBe(0);
    expect(service.held()).toBe(0);
  });

  it("300 abandoned calls leave nothing held, nothing waiting and no timer, and none answers pending", async () => {
    const s = script({ list: () => new Promise(() => undefined) });
    const { service, clock, registries } = build({
      providers: [["backend", scripted("hung", "backend", s)]],
    });
    const answers: InspectSettled[] = [];
    for (let i = 0; i < 300; i += 1)
      void service.serve("inspect.list", context({}, `session-${i}`)).then((r) => answers.push(r));
    await flush();
    expect(service.held()).toBe(300);
    expect(registries.get("backend")?.inFlight()).toBe(300);
    clock.advance(10_000);
    await flush();
    expect(answers).toHaveLength(300);
    for (const answer of answers) {
      expect(["done", "refused", "unavailable"]).toContain(answer.status);
      expect(answer).toMatchObject({ result: { outcome: "timeout" } });
    }
    expect(service.held()).toBe(0);
    expect(registries.get("backend")?.inFlight()).toBe(0);
    expect(clock.timers()).toBe(0);
  });

  it("drain stops admission, settles held calls unavailable, counts them, and a later call is unavailable", async () => {
    const s = script({ list: () => new Promise(() => undefined) });
    const { service, registries } = build({
      providers: [["backend", scripted("hung", "backend", s)]],
    });
    const answers: InspectSettled[] = [];
    for (let i = 0; i < 3; i += 1)
      void service.serve("inspect.list", context({})).then((r) => answers.push(r));
    await flush();
    expect(service.drain()).toEqual({ stopped: 3 });
    await flush();
    expect(answers).toEqual([
      { status: "unavailable", code: "INSPECT_UNAVAILABLE" },
      { status: "unavailable", code: "INSPECT_UNAVAILABLE" },
      { status: "unavailable", code: "INSPECT_UNAVAILABLE" },
    ]);
    expect(registries.get("backend")?.inFlight()).toBe(0);
    expect(await service.serve("inspect.list", context({}))).toEqual({
      status: "unavailable",
      code: "INSPECT_UNAVAILABLE",
    });
    expect(service.drain()).toEqual({ stopped: 0 });
  });
});

describe("listing", () => {
  const two = () => [
    ["backend", scripted("alpha", "backend", script({ list: itemsOf([1, 2, 3]) }))] as [
      InspectHost,
      InspectProvider,
    ],
    ["backend", scripted("beta", "backend", script({ list: itemsOf([4, 5]) }))] as [
      InspectHost,
      InspectProvider,
    ],
  ];
  const targets = (settled: InspectSettled) =>
    (resultOf(settled).entries as Array<{ providerId: string; targetId: string }>).map(
      (e) => `${e.providerId}/${e.targetId}`,
    );

  it("pages across providers in a stable order, with a total and a nextOffset that resumes", async () => {
    const { service } = build({ providers: two().reverse() });
    const first = await service.serve("inspect.list", context({ offset: 0, limit: 2 }));
    expect(targets(first)).toEqual(["alpha/t01", "alpha/t02"]);
    expect(resultOf(first)).toMatchObject({ outcome: "ok", total: 5, nextOffset: 2, limit: 2 });
    const second = await service.serve("inspect.list", context({ offset: 2, limit: 2 }));
    expect(targets(second)).toEqual(["alpha/t03", "beta/t04"]);
    expect(resultOf(second)).toMatchObject({ total: 5, nextOffset: 4 });
    const last = await service.serve("inspect.list", context({ offset: 4, limit: 2 }));
    expect(targets(last)).toEqual(["beta/t05"]);
    expect(resultOf(last)).toMatchObject({ total: 5, nextOffset: null });
    const past = await service.serve("inspect.list", context({ offset: 9, limit: 2 }));
    expect(targets(past)).toEqual([]);
    expect(resultOf(past)).toMatchObject({ total: 5, nextOffset: null });
  });

  it("stamps each entry with its provider and host, and filters by provider, host and kind", async () => {
    const agent = scripted("tools", "agent", script({ list: itemsOf([9]) }));
    const { service } = build({ providers: [...two(), ["agent", agent]] });
    const all = await service.serve("inspect.list", context({}));
    expect(targets(all)).toEqual([
      "tools/t09",
      "alpha/t01",
      "alpha/t02",
      "alpha/t03",
      "beta/t04",
      "beta/t05",
    ]);
    expect((resultOf(all).entries as Array<{ host: string }>)[0]?.host).toBe("agent");
    expect(targets(await service.serve("inspect.list", context({ providerId: "beta" })))).toEqual([
      "beta/t04",
      "beta/t05",
    ]);
    expect(targets(await service.serve("inspect.list", context({ host: "agent" })))).toEqual([
      "tools/t09",
    ]);
    expect(await service.serve("inspect.list", context({ providerId: "nobody" }))).toEqual({
      status: "unavailable",
      code: "INSPECT_UNKNOWN_PROVIDER",
    });
  });

  it("is unavailable, never a partial success, when a provider answers a malformed shape", async () => {
    const bad = scripted(
      "bad",
      "backend",
      script({ list: () => ({ total: 1, entries: [{ targetId: "a" }] }) }),
    );
    const { service } = build({ providers: [...two(), ["backend", bad]] });
    expect(await service.serve("inspect.list", context({}))).toEqual({
      status: "unavailable",
      code: "INSPECT_PROVIDER_FAILED",
    });
  });

  it("refuses a provider answer that carries a capability as INSPECT_READONLY, and a provider that throws is unavailable", async () => {
    const callable = scripted(
      "callable",
      "backend",
      script({ list: () => ({ total: 0, entries: [], run: () => 1 }) }),
    );
    expect(
      await build({ providers: [["backend", callable]] }).service.serve(
        "inspect.list",
        context({}),
      ),
    ).toEqual({ status: "refused", code: "INSPECT_READONLY" });
    const throwing = scripted(
      "throws",
      "backend",
      script({
        list: () => {
          throw new Error("canary-error-text");
        },
      }),
    );
    const answer = await build({ providers: [["backend", throwing]] }).service.serve(
      "inspect.list",
      context({}),
    );
    expect(answer).toEqual({ status: "unavailable", code: "INSPECT_PROVIDER_FAILED" });
    expect(JSON.stringify(answer)).not.toContain("canary");
  });

  it("cuts a page by whole entries at the result cap and says truncated", async () => {
    const { service } = build({
      providers: [
        ["backend", scripted("alpha", "backend", script({ list: itemsOf([1, 2, 3, 4, 5, 6]) }))],
      ],
      capBytes: 600,
    });
    const settled = await service.serve("inspect.list", context({ limit: 6 }));
    const result = resultOf(settled);
    expect(result.outcome).toBe("truncated");
    expect((result.entries as unknown[]).length).toBeLessThan(6);
    expect(result.nextOffset).toBe((result.entries as unknown[]).length);
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(600);
  });
});

describe("querying", () => {
  const FIELDS = {
    name: { type: "string", required: true, secret: false },
    token: { type: "string", required: false, secret: true },
    mode: { type: "string", required: false, secret: false },
    note: { type: "string", required: false, secret: false },
  };
  const configProvider = (values: Record<string, unknown>, origins?: Record<string, string>) =>
    scripted(
      "config",
      "backend",
      script({
        query: () => ({
          outcome: "ok",
          state: "active",
          config: {
            module: { id: "mod", fields: FIELDS },
            values,
            ...(origins === undefined ? {} : { origins }),
          },
        }),
      }),
    );

  it("answers a provider's exact shape and applies a selector to it; a part the shape lacks is schema-unsupported", async () => {
    const shaped = scripted(
      "modules",
      "backend",
      script({
        query: () => ({ outcome: "ok", state: "active", shape: { a: { b: [10, 20] }, c: 1 } }),
      }),
    );
    const { service } = build({ providers: [["backend", shaped]] });
    const whole = await service.serve(
      "inspect.query",
      context({ providerId: "modules", targetId: "x" }),
    );
    expect(resultOf(whole)).toMatchObject({
      outcome: "ok",
      state: "active",
      shape: { a: { b: [10, 20] }, c: 1 },
      values: {},
      omitted: [],
    });
    const part = await service.serve(
      "inspect.query",
      context({ providerId: "modules", targetId: "x", selector: "a.b[1]" }),
    );
    expect(resultOf(part)).toMatchObject({ outcome: "ok", selector: "a.b[1]", shape: 20 });
    const missing = await service.serve(
      "inspect.query",
      context({ providerId: "modules", targetId: "x", selector: "a.zzz" }),
    );
    expect(resultOf(missing)).toEqual({
      outcome: "schema-unsupported",
      capturedAt: expect.any(String),
      providerId: "modules",
      targetId: "x",
    });
  });

  it("an unknown provider is unavailable, and a provider's empty outcome is carried as it is", async () => {
    const empty = scripted("modules", "backend", script());
    const { service } = build({ providers: [["backend", empty]] });
    expect(
      await service.serve("inspect.query", context({ providerId: "nobody", targetId: "x" })),
    ).toEqual({ status: "unavailable", code: "INSPECT_UNKNOWN_PROVIDER" });
    expect(
      resultOf(
        await service.serve("inspect.query", context({ providerId: "modules", targetId: "x" })),
      ),
    ).toMatchObject({ outcome: "unavailable", providerId: "modules", targetId: "x" });
  });

  it("shows a value only for a listed non-secret field, and never a secret, an unlisted value or a credential-store origin", async () => {
    const logs: InspectLogEvent[] = [];
    const values = {
      name: "canary-name-value",
      token: "canary-token-secret",
      mode: "canary-mode-credential",
      note: "canary-note-unlisted",
    };
    const { service } = build({
      providers: [["backend", configProvider(values, { mode: "credential-store" })]],
      showValues: ["mod.name", "mod.token", "mod.mode"],
      log: (event) => logs.push(event),
    });
    const settled = await service.serve(
      "inspect.query",
      context({ providerId: "config", targetId: "mod" }),
    );
    const result = resultOf(settled);
    expect(result.values).toEqual({ name: "canary-name-value" });
    expect(result.omitted).toEqual([
      { path: "mode", reason: "credential-store" },
      { path: "note", reason: "not-allowed" },
      { path: "token", reason: "secret" },
    ]);
    const text = JSON.stringify([settled, logs]);
    for (const canary of ["canary-token-secret", "canary-mode-credential", "canary-note-unlisted"])
      expect(text).not.toContain(canary);
    expect((result.shape as { fields: unknown[] }).fields).toHaveLength(4);
  });

  it("shows no value at all when showValues is empty or malformed, and the shape still lists every field", async () => {
    for (const showValues of [[], undefined, "mod.name", { 0: "mod.name" }, ["not a pair"], 7]) {
      const { service } = build({
        providers: [["backend", configProvider({ name: "canary-name-value" })]],
        showValues,
      });
      const result = resultOf(
        await service.serve("inspect.query", context({ providerId: "config", targetId: "mod" })),
      );
      expect(result.values, JSON.stringify(showValues)).toEqual({});
      expect(result.omitted).toEqual([{ path: "name", reason: "not-allowed" }]);
      expect(JSON.stringify(result)).not.toContain("canary-name-value");
    }
  });

  it("is unavailable, with no value, when a config candidate's fields are not the exact XC-4 shape", async () => {
    const odd = scripted(
      "config",
      "backend",
      script({
        query: () => ({
          outcome: "ok",
          state: "active",
          config: {
            module: {
              id: "mod",
              fields: { name: { type: "string", required: true, secret: false, default: "x" } },
            },
            values: { name: "canary-name-value" },
          },
        }),
      }),
    );
    const answer = await build({
      providers: [["backend", odd]],
      showValues: ["mod.name"],
    }).service.serve("inspect.query", context({ providerId: "config", targetId: "mod" }));
    expect(answer).toEqual({ status: "unavailable", code: "INSPECT_PROVIDER_FAILED" });
  });

  it("refuses a provider answer that carries its own values or omissions: a value reaches a result only through the projector", async () => {
    const sneaky = scripted(
      "modules",
      "backend",
      script({
        query: () => ({
          outcome: "ok",
          state: "active",
          shape: {},
          values: { token: "canary-token-secret" },
        }),
      }),
    );
    const answer = await build({
      providers: [["backend", sneaky]],
      showValues: ["mod.token"],
    }).service.serve("inspect.query", context({ providerId: "modules", targetId: "x" }));
    expect(answer).toEqual({ status: "unavailable", code: "INSPECT_PROVIDER_FAILED" });
    expect(JSON.stringify(answer)).not.toContain("canary");
  });

  it("cuts an oversized shape by whole entries, keeps it valid JSON and says what is missing", async () => {
    const big = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `field${String(i).padStart(2, "0")}`,
        { type: "string", note: "x".repeat(40) },
      ]),
    );
    const { service } = build({
      providers: [
        [
          "backend",
          scripted(
            "modules",
            "backend",
            script({ query: () => ({ outcome: "ok", state: "active", shape: big }) }),
          ),
        ],
      ],
      capBytes: 900,
    });
    const result = resultOf(
      await service.serve("inspect.query", context({ providerId: "modules", targetId: "x" })),
    );
    expect(result.outcome).toBe("truncated");
    expect(result.truncation).toMatchObject({ capBytes: 900 });
    const kept = Object.keys(result.shape as object);
    expect(kept.length).toBeLessThan(40);
    expect(kept).toEqual(Object.keys(big).slice(0, kept.length));
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(900);
  });
});

describe("the log", () => {
  it("carries operation, status, code and outcome only", async () => {
    const logs: InspectLogEvent[] = [];
    const { service } = build({
      providers: [["backend", scripted("modules", "backend", script({ list: itemsOf([1]) }))]],
      log: (e) => logs.push(e),
    });
    await service.serve("inspect.list", context({}));
    await service.serve("inspect.list", context({ sessionId: "canary-forged" }));
    expect(logs).toEqual([
      { operation: "inspect.list", status: "done", outcome: "ok" },
      { operation: "inspect.list", status: "refused", code: "INSPECT_INVALID" },
    ]);
  });
});
