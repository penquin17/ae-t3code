// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M11 Plan step 8 (C2 P1, C7; D5–D7, D10–D12) — `inspect.list` and `inspect.query` through the XC-6 carrier core.
//
// Boundary: the real XC-6 core (`createXc6Backend`) over the operations of the real prepared production Backend adapter, whose `inspect-backend` registration is the real service, registry and
// providers; the identity port, the caller check and the clock are scripted (the verified session is the port's, as T3's bearer lookup would make it). It shows: before the Backend runs, and after it
// is disposed, both operations answer the adapter's `unavailable`; a running call answers `done` and the reply decodes as an inspect carrier reply; a call is HELD to the Backend's deadline and answers
// `done` with a `timeout` outcome, never `pending`; 300 abandoned calls against a carrier with four pending slots allocate no token and fill no slot; a poll of any token is refused; an argument
// that claims a session is refused INSPECT_INVALID; a refused caller is the carrier's 403 with M03's code and reaches no provider; inspection off is unavailable and no provider is asked; disposing
// the Backend settles held calls unavailable. It does NOT show the HTTP route, T3's bearer lookup, M03's real verdict (inspectAccess.aetheria.test.ts) or a real page. An unregistered `inspect.*` name
// is the carrier's own unknown-operation refusal here: the core dispatches only registered names, so the service's INSPECT_READONLY for another verb is shown at service level, not on this wire.
import {
  BACKEND_COMPOSITION_ID,
  backendManifest,
  createAgentAwarenessBackendRegistration,
  createDeliverablesBackendRegistration,
  createGoalsBackendRegistration,
  createGroupsBackendRegistration,
  createHumanControlBackendRegistration,
  createInspectBackendRegistration,
  createOrchestrationBackendRegistration,
  createProvidersBackendRegistration,
  prepareAetheriaBackend,
  type InspectAccessPort,
} from "@t3tools/aetheria-server";
import { expect, it } from "vite-plus/test";

import { createXc6Backend, type Xc6Reply } from "./xc6Core.ts";

const CALLER = { threadId: "thread-1", providerSessionId: "ps-1", providerInstanceId: "pi" };
const flush = async () => {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
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

function world(options: { enabled?: boolean; access?: InspectAccessPort } = {}) {
  const clock = makeClock();
  const calls = { list: 0, query: 0 };
  let accessChecks = 0;
  const registration = createInspectBackendRegistration({
    access: options.access ?? { check: async () => (accessChecks++, { ok: true }) },
    enablement: { enabled: options.enabled ?? true },
    sources: {
      manifest: () => backendManifest(),
      status: () =>
        prepared.outcome === "prepared" ? prepared.backend.status() : (undefined as never),
    },
    now: clock.now,
    schedule: clock.schedule,
  });
  registration.registry.register({
    providerId: "hung",
    host: "backend",
    list: () => (calls.list++, new Promise(() => undefined)),
    query: () => (calls.query++, new Promise(() => undefined)),
  });
  const prepared = prepareAetheriaBackend({
    registrations: [
      createAgentAwarenessBackendRegistration(),
      createProvidersBackendRegistration({ composition: BACKEND_COMPOSITION_ID }),
      createHumanControlBackendRegistration({}),
      createOrchestrationBackendRegistration({}),
      createGoalsBackendRegistration(),
      createGroupsBackendRegistration({}),
      createDeliverablesBackendRegistration({}),
      registration,
    ],
  });
  if (prepared.outcome !== "prepared") throw new Error("the Backend did not prepare");
  const events: Array<{ kind: string; op?: string; status: string; code?: string }> = [];
  const carrier = createXc6Backend({
    identity: () => ({
      ok: true,
      sessionId: "session-1",
      kind: "main",
      rootSessionId: "session-1",
    }),
    operations: prepared.backend.operations(),
    newToken: () => `token-${events.length}`,
    log: (event) => events.push(event),
    maxPending: 4,
  });
  const call = (op: string, args: Record<string, unknown> = {}) =>
    carrier.handle({ caller: CALLER, claimedSessionId: null, body: { v: 1, op, args } });
  return {
    backend: prepared.backend,
    carrier,
    call,
    clock,
    calls,
    events,
    checks: () => accessChecks,
    registration,
  };
}

const body = (response: { body: Xc6Reply }) => response.body as Record<string, any>;

it("answers the adapter's unavailable before the Backend runs, and asks no check and no provider", async () => {
  const w = world();
  for (const op of ["inspect.list", "inspect.query"]) {
    const response = await w.call(
      op,
      op === "inspect.list" ? {} : { providerId: "hung", targetId: "a" },
    );
    expect(response.http).toBe(200);
    expect(body(response)).toEqual({
      v: 1,
      status: "unavailable",
      code: "XC6_BACKEND_NOT_RUNNING",
    });
  }
  expect(w.checks()).toBe(0);
  expect(w.calls).toEqual({ list: 0, query: 0 });
});

it("a running list answers done with a result the inspect carrier codec accepts, and never pending", async () => {
  const w = world();
  await w.backend.start();
  const response = await w.call("inspect.list", { providerId: "modules" });
  expect(response.http).toBe(200);
  expect(body(response).status).toBe("done");
  expect(body(response).result.outcome).toBe("ok");
  expect(body(response).result.entries.length).toBeGreaterThan(0);
  expect(body(response).token).toBeUndefined();
  const query = await w.call("inspect.query", {
    providerId: "modules",
    targetId: "inspect-backend",
    selector: "declared.services",
  });
  expect(body(query)).toMatchObject({
    status: "done",
    result: { outcome: "ok", selector: "declared.services" },
  });
  expect(w.events.every((e) => e.status !== "pending")).toBe(true);
});

it("holds a call to the Backend's deadline and answers done with a timeout outcome, not pending", async () => {
  const w = world();
  await w.backend.start();
  const pending = w.call("inspect.list", { providerId: "hung" });
  await flush();
  expect(w.calls.list).toBe(1);
  w.clock.advance(9_999);
  await flush();
  let settled: unknown;
  void pending.then((r) => (settled = r));
  await flush();
  expect(settled).toBeUndefined();
  w.clock.advance(1);
  const response = await pending;
  expect(response.http).toBe(200);
  expect(body(response)).toMatchObject({ v: 1, status: "done", result: { outcome: "timeout" } });
});

it("300 abandoned calls allocate no token and fill no slot of a four-slot carrier, and a poll of any token is refused", async () => {
  const w = world();
  await w.backend.start();
  const replies: Xc6Reply[] = [];
  for (let i = 0; i < 300; i += 1)
    void w
      .call(
        i % 2 === 0 ? "inspect.list" : "inspect.query",
        i % 2 === 0 ? { providerId: "hung" } : { providerId: "hung", targetId: "a" },
      )
      .then((r) => replies.push(r.body));
  await flush();
  expect(w.registration.service.held()).toBe(300);
  w.clock.advance(10_000);
  await flush();
  expect(replies).toHaveLength(300);
  for (const reply of replies) {
    expect(reply).toMatchObject({ v: 1, status: "done" });
    expect(reply).not.toHaveProperty("token");
  }
  expect(w.events.filter((e) => e.status === "pending" || e.code === "XC6_PENDING_FULL")).toEqual(
    [],
  );
  expect(w.registration.service.held()).toBe(0);
  expect(w.registration.registry.inFlight()).toBe(0);
  expect(w.clock.timers()).toBe(0);
  for (const token of ["token-1", "token-299", "guess"]) {
    const poll = await w.carrier.handle({
      caller: CALLER,
      claimedSessionId: null,
      body: { v: 1, poll: token },
    });
    expect(poll.body).toEqual({ v: 1, status: "refused", code: "XC6_POLL_REFUSED" });
  }
});

it("refuses an argument that claims a session or any authority, and runs no provider", async () => {
  const w = world();
  await w.backend.start();
  for (const args of [
    { sessionId: "x" },
    { threadId: "t" },
    { root: "/" },
    { providerId: "hung", surprise: 1 },
  ]) {
    const response = await w.call("inspect.list", args);
    expect(response.http).toBe(403);
    expect(body(response)).toEqual({ v: 1, status: "refused", code: "INSPECT_INVALID" });
  }
  expect(w.calls).toEqual({ list: 0, query: 0 });
});

it("a caller M03 refuses is the carrier's 403 with M03's code, and reaches no provider", async () => {
  const w = world({
    access: { check: async () => ({ ok: false, code: "AUTH_TOOL_NOT_ALLOWED", reason: "no" }) },
  });
  await w.backend.start();
  const response = await w.call("inspect.list", { providerId: "hung" });
  expect(response.http).toBe(403);
  expect(body(response)).toEqual({ v: 1, status: "refused", code: "AUTH_TOOL_NOT_ALLOWED" });
  expect(w.calls).toEqual({ list: 0, query: 0 });
});

it("with inspection off both operations are unavailable and no check or provider runs", async () => {
  const w = world({ enabled: false });
  await w.backend.start();
  for (const op of ["inspect.list", "inspect.query"]) {
    const response = await w.call(
      op,
      op === "inspect.list" ? { providerId: "hung" } : { providerId: "hung", targetId: "a" },
    );
    expect(response.http).toBe(200);
    expect(body(response)).toEqual({ v: 1, status: "unavailable", code: "INSPECT_UNAVAILABLE" });
  }
  expect(w.checks()).toBe(0);
  expect(w.calls).toEqual({ list: 0, query: 0 });
});

it("disposing the Backend settles held calls unavailable, counted in the disposal report, and later calls are unavailable", async () => {
  const w = world();
  await w.backend.start();
  const held = [
    w.call("inspect.list", { providerId: "hung" }),
    w.call("inspect.list", { providerId: "hung" }),
  ];
  await flush();
  const report = await w.backend.dispose("test over");
  const replies = await Promise.all(held);
  for (const reply of replies)
    expect(body(reply)).toEqual({ v: 1, status: "unavailable", code: "INSPECT_UNAVAILABLE" });
  expect(report.stopped.length).toBe(2);
  expect(report.ok).toBe(true);
  expect(body(await w.call("inspect.list", {}))).toEqual({
    v: 1,
    status: "unavailable",
    code: "XC6_BACKEND_NOT_RUNNING",
  });
});

it("exposes exactly the two inspect operations on the wire; another inspect name is the carrier's unknown operation", async () => {
  const w = world();
  await w.backend.start();
  expect(
    Object.keys(w.backend.operations())
      .filter((name) => name.startsWith("inspect."))
      .sort(),
  ).toEqual(["inspect.list", "inspect.query"]);
  const response = await w.call("inspect.write", {});
  expect(response.http).toBe(404);
  expect(body(response)).toEqual({ v: 1, status: "refused", code: "XC6_UNKNOWN_OPERATION" });
  expect(w.calls).toEqual({ list: 0, query: 0 });
});
