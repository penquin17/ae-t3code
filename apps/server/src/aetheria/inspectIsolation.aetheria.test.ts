// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M11 Plan steps 19 and 20 (C2 P1, C5 P4, C6 U3; D5, D6, D8–D12) — server isolation and honest outcomes of ONE live client query, from the Backend's service to the page's reply.
//
// Boundary: the REAL region registry (`regionsState.ts`), the REAL transport and stream/reply handlers (`inspectClientTransport.ts`, `inspectRpc.ts`), the REAL C5 resolver and the REAL inspection service from the
// Backend package, with T3's real device-session check (`connectionActor` over a scripted `auth_sessions` row) and a scripted scheduler the test moves (no wall clock). Doubled: the caller check (always allows: its
// verdicts are inspectAccess.aetheria.test.ts's), the WebSocket and T3's scope middleware (inspectRpc.aetheria.test.ts), and the page itself (a scripted stream consumer). It shows: two principals viewing the
// requesting thread are both eligible (one answers, two are ambiguous with ids only); a page on another thread is never listed or reached, even by explicit id; a forged thread, client, actor or connection key is
// refused before anything is sent; a reply from another connection (a stolen correlation id) settles nothing and the right page still answers; a same-device takeover cannot answer for the connection that was
// asked; a page that left the thread before the send is no-client and one that left before its reply is disconnected; a closing page is disconnected, a silent one timeout at D, and a late, duplicate or malformed
// reply is dropped; a revoked, unreadable or unscoped device is refused on the stream and the reply; exactly one request is sent per query; and principal-scoped reads are unchanged. It does NOT show a real socket,
// the XC-6 carrier, a built page (the native step-24 drill), or the web responder (apps/web responder tests).
import { createClientQueries, createInspectBackendRegistration } from "@t3tools/aetheria-server";
import type { Xc6OperationContext } from "@t3tools/aetheria-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { AuthSessionRepository } from "../persistence/AuthSessions.ts";
import { connectionActor } from "./humanControlRpc.ts";
import { createInspectClientTransport } from "./inspectClientTransport.ts";
import { inspectReply, inspectRequests } from "./inspectRpc.ts";
import { createRegionRegistry, type RegionConnection } from "./regionsState.ts";

const D = 10_000;
const READ = "orchestration:read";
const THREAD = "thread-builder-1";

type Row = { revokedAt: unknown; expiresAt: DateTime.Utc };
const live = (): Row => ({
  revokedAt: null,
  expiresAt: DateTime.makeUnsafe("2099-01-01T00:00:00.000Z"),
});

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

const settle = Effect.forEach(Array.from({ length: 30 }), () => Effect.yieldNow, { discard: true });
/** Lets promise continuations (the service, the resolver) and the forked stream consumers run to their next wait: yields only, no clock. */
const flush = Effect.promise(async () => {
  for (let i = 0; i < 60; i += 1) await Promise.resolve();
}).pipe(Effect.andThen(settle), Effect.andThen(settle));

const world = () => {
  const clock = makeClock();
  let n = 0;
  const registry = createRegionRegistry({ now: clock.now, newId: () => `conn-${(n += 1)}` });
  const transport = createInspectClientTransport(registry);
  let q = 0;
  const queries = createClientQueries({
    port: transport.port,
    deadlineMs: D,
    schedule: clock.schedule,
    newId: () => `req-${(q += 1)}`,
  });
  const logged: unknown[] = [];
  const inspect = createInspectBackendRegistration({
    access: { check: async () => ({ ok: true }) },
    enablement: { enabled: true },
    clients: queries,
    now: clock.now,
    schedule: clock.schedule,
    deadlineMs: D,
    log: (event) => logged.push(event),
  });
  return { clock, registry, transport, queries, inspect, logged };
};
type World = ReturnType<typeof world>;

const descriptor = (id: string) => ({
  id,
  kind: "region" as const,
  owner: "aetheria-ui",
  parent: null,
  description: `The ${id} region`,
  schemaVersion: 1,
  props: [{ name: "title", type: "string" as const, report: "value" as const }],
  state: [{ name: "phase", type: "string" as const, report: "shape" as const }],
  tokens: [],
});

/** A scripted page: a region connection of one principal that views threads, reports one region, and listens on its request stream. */
const page = (
  w: World,
  subject: string,
  clientId: string,
  threads: ReadonlyArray<string>,
  options: {
    device?: string;
    scopes?: ReadonlyArray<string>;
    read?: () => Effect.Effect<Option.Option<Row>, unknown>;
  } = {},
) =>
  Effect.gen(function* () {
    const connection: RegionConnection = w.registry.openConnection({
      subject,
      deviceSessionId: options.device ?? `dev-${subject}`,
    });
    const ends = threads.map((thread) => connection.observeViewing(thread));
    connection.report({
      clientId,
      sequence: 1,
      regions: [{ descriptor: descriptor("shell"), visible: true }],
    });
    const repository = Layer.succeed(AuthSessionRepository, {
      getById: () => (options.read ?? (() => Effect.succeedSome(live())))(),
    } as never);
    const actor = yield* connectionActor({
      sessionId: `session-${subject}`,
      scopes: options.scopes ?? [READ],
    } as never).pipe(Effect.provide(repository));
    const received: Array<{ requestId: string; regionId: string }> = [];
    const stream = yield* inspectRequests(connection, actor, w.transport, w.queries, {}).pipe(
      Stream.runForEach((request) => Effect.sync(() => void received.push(request))),
      Effect.forkChild,
    );
    yield* settle;
    const reply = (requestId: string, body: Record<string, unknown> = ok) =>
      inspectReply(connection, actor, w.queries, { requestId, ...body } as never);
    return { connection, actor, received, stream, ends, reply };
  });

const ok = {
  outcome: "ok",
  state: "active",
  shape: {},
  values: { "props.title": "Hello", "state.phase": "secret-phase" },
};
const context = (args: Record<string, unknown>, threadId = THREAD): Xc6OperationContext => ({
  caller: { threadId, providerSessionId: "ps-1", providerInstanceId: "pi" },
  sessionId: "session-builder",
  kind: "main",
  rootSessionId: "session-builder",
  args,
});
const query = (w: World, args: Record<string, unknown> = {}, threadId = THREAD) =>
  w.inspect.service.serve(
    "inspect.query",
    context({ providerId: "client-regions", targetId: "shell", ...args }, threadId),
  );
const outcomeOf = (settled: { status: string; result?: unknown }) => {
  expect(settled.status).toBe("done");
  return settled.result as Record<string, unknown>;
};
const A = "client-aaaaaaaaaaaaaaaa";
const B = "client-bbbbbbbbbbbbbbbb";
const C = "client-cccccccccccccccc";

describe("which pages the requesting thread can reach (N1)", () => {
  it.effect(
    "two principals viewing the requesting thread are eligible: one answers, two are ambiguous with ids only",
    () =>
      Effect.gen(function* () {
        const w = world();
        const alice = yield* page(w, "alice", A, [THREAD]);
        const asking = query(w);
        yield* flush;
        expect(alice.received.map((r) => r.regionId)).toEqual(["shell"]);
        expect(yield* alice.reply("req-1")).toEqual({ ok: true, value: { accepted: true } });
        const answered = outcomeOf(yield* Effect.promise(() => asking));
        expect(answered).toMatchObject({ outcome: "ok", clientId: A });
        expect(JSON.stringify(answered)).not.toContain("secret-phase"); // a shape field's value never passes

        const bob = yield* page(w, "bob", B, [THREAD]);
        const ambiguous = outcomeOf(yield* Effect.promise(() => query(w)));
        expect(ambiguous).toMatchObject({ outcome: "ambiguous" });
        expect((ambiguous.clients as Array<{ clientId: string }>).map((c) => c.clientId)).toEqual([
          A,
          B,
        ]);
        expect(JSON.stringify(ambiguous)).not.toMatch(/alice|bob|dev-|conn-|session-/);
        expect(bob.received).toEqual([]);
        expect(alice.received).toHaveLength(1); // ambiguity sent nothing
      }),
  );

  it.effect(
    "a page on another thread is never listed or reached, even by explicit id, whoever it belongs to",
    () =>
      Effect.gen(function* () {
        const w = world();
        const alice = yield* page(w, "alice", A, [THREAD]);
        const bobElsewhere = yield* page(w, "bob", B, ["thread-other"]);
        const listed = outcomeOf(
          yield* Effect.promise(() =>
            w.inspect.service.serve("inspect.list", context({ providerId: "client-regions" })),
          ),
        );
        expect(listed).toMatchObject({ outcome: "ok", total: 1 });
        const byId = outcomeOf(yield* Effect.promise(() => query(w, { clientId: B })));
        expect(byId).toMatchObject({ outcome: "no-client" });
        const other = query(w, {}, "thread-other");
        yield* flush;
        expect(bobElsewhere.received).toHaveLength(1);
        expect(alice.received).toEqual([]);
        yield* bobElsewhere.reply("req-1");
        expect(outcomeOf(yield* Effect.promise(() => other))).toMatchObject({
          outcome: "ok",
          clientId: B,
        });
      }),
  );

  it.effect(
    "a forged thread, client, actor, principal, connection or session key is refused before anything is sent",
    () =>
      Effect.gen(function* () {
        const w = world();
        const alice = yield* page(w, "alice", A, [THREAD]);
        for (const forged of [
          { threadId: "thread-other" },
          { actor: "bob" },
          { principal: "bob" },
          { connectionId: "conn-1" },
          { sessionId: "x" },
          { deviceId: "dev-alice" },
        ]) {
          const settled = yield* Effect.promise(() => query(w, forged));
          expect(settled).toMatchObject({ status: "refused", code: "INSPECT_INVALID" });
        }
        expect(alice.received).toEqual([]);
        expect(w.queries.held()).toBe(0);
      }),
  );

  it.effect(
    "principal-scoped reads are unchanged: a principal never sees another's client through them",
    () =>
      Effect.gen(function* () {
        const w = world();
        yield* page(w, "alice", A, [THREAD]);
        yield* page(w, "bob", B, [THREAD]);
        expect(w.registry.clientsFor({ subject: "alice" }).map((c) => c.clientId)).toEqual([A]);
        expect(w.registry.clientOf({ subject: "alice" }, B)).toBeUndefined();
      }),
  );
});

describe("a reply is the asked page's, in the asked view, once", () => {
  it.effect(
    "another connection's reply with the stolen correlation id settles nothing; the asked page still answers",
    () =>
      Effect.gen(function* () {
        const w = world();
        const alice = yield* page(w, "alice", A, [THREAD]);
        const mallory = yield* page(w, "mallory", C, ["thread-other"]);
        const asking = query(w);
        yield* flush;
        expect(
          yield* mallory.reply("req-1", { ...ok, values: { "props.title": "FORGED" } }),
        ).toEqual({
          ok: true,
          value: { accepted: false },
        });
        expect(w.queries.held()).toBe(1);
        yield* alice.reply("req-1");
        const answered = outcomeOf(yield* Effect.promise(() => asking));
        expect(JSON.stringify(answered)).not.toContain("FORGED");
        expect(answered).toMatchObject({ outcome: "ok", clientId: A });
        // a duplicate and a late reply settle nothing
        expect(yield* alice.reply("req-1")).toEqual({ ok: true, value: { accepted: false } });
      }),
  );

  it.effect(
    "a same-device takeover of the client id cannot answer for the connection that was asked, whose end is disconnected",
    () =>
      Effect.gen(function* () {
        const w = world();
        const first = yield* page(w, "alice", A, [THREAD], { device: "dev-same" });
        const asking = query(w);
        yield* flush;
        const second = yield* page(w, "alice", A, [THREAD], { device: "dev-same" });
        // the takeover (same client id, same device) is a new connection: it did not receive the old request
        expect(second.received).toEqual([]);
        expect(yield* second.reply("req-1")).toEqual({ ok: true, value: { accepted: false } });
        yield* Fiber.interrupt(first.stream);
        expect(outcomeOf(yield* Effect.promise(() => asking))).toMatchObject({
          outcome: "disconnected",
        });
        expect(second.received).toEqual([]); // never reissued to the new connection
      }),
  );

  it.effect(
    "a page that left the thread before the send is no-client; one that left before its reply is disconnected",
    () =>
      Effect.gen(function* () {
        const w = world();
        const alice = yield* page(w, "alice", A, [THREAD]);
        alice.ends[0]!();
        expect(outcomeOf(yield* Effect.promise(() => query(w)))).toMatchObject({
          outcome: "no-client",
        });
        const rejoin = alice.connection.observeViewing(THREAD);
        const asking = query(w);
        yield* flush;
        rejoin(); // navigated away while it answers
        expect(yield* alice.reply("req-1")).toEqual({ ok: true, value: { accepted: false } });
        expect(outcomeOf(yield* Effect.promise(() => asking))).toMatchObject({
          outcome: "disconnected",
        });
      }),
  );

  it.effect(
    "a closing page is disconnected, a silent one is timeout at D with its late reply dropped, and each is one attempt",
    () =>
      Effect.gen(function* () {
        const w = world();
        const alice = yield* page(w, "alice", A, [THREAD]);
        const closing = query(w);
        yield* flush;
        yield* Fiber.interrupt(alice.stream); // the request stream ends (socket closed)
        expect(outcomeOf(yield* Effect.promise(() => closing))).toMatchObject({
          outcome: "disconnected",
        });

        const bob = yield* page(w, "bob", B, ["thread-2"]);
        let settled: unknown;
        void query(w, {}, "thread-2").then((s) => (settled = s));
        yield* flush;
        w.clock.advance(D - 1);
        yield* flush;
        expect(settled).toBeUndefined();
        w.clock.advance(1);
        yield* flush;
        expect(outcomeOf(settled as never)).toMatchObject({ outcome: "timeout" });
        expect(yield* bob.reply("req-2")).toEqual({ ok: true, value: { accepted: false } });
        expect(bob.received).toHaveLength(1);
        expect(w.queries.held()).toBe(0);
        expect(w.clock.timers()).toBe(0);
      }),
  );

  it.effect(
    "a malformed reply is unavailable and carries nothing; an unknown region, schema and unavailable pass through as outcomes",
    () =>
      Effect.gen(function* () {
        const w = world();
        const alice = yield* page(w, "alice", A, [THREAD]);
        const asks = [
          {
            body: { outcome: "ok", state: "weird", shape: {}, values: {} },
            expected: "unavailable",
          },
          { body: { outcome: "region-not-found" }, expected: "region-not-found" },
          { body: { outcome: "schema-unsupported" }, expected: "schema-unsupported" },
        ];
        for (const [index, item] of asks.entries()) {
          const asking = query(w);
          yield* flush;
          yield* alice.reply(`req-${index + 1}`, item.body);
          expect(outcomeOf(yield* Effect.promise(() => asking)).outcome).toBe(item.expected);
        }
        expect(alice.received).toHaveLength(3);
      }),
  );
});

describe("the device and its scope are checked on the stream and the reply", () => {
  it.effect("an unscoped device gets an empty stream and a refused reply", () =>
    Effect.gen(function* () {
      const w = world();
      const noScope = yield* page(w, "alice", A, [THREAD], { scopes: [] });
      const asking = query(w);
      yield* flush;
      expect(noScope.received).toEqual([]);
      // no request stream was opened for it, so it is not sent to: no-client, with no attempt made
      expect(outcomeOf(yield* Effect.promise(() => asking))).toMatchObject({
        outcome: "no-client",
      });
      expect(yield* noScope.reply("req-1")).toMatchObject({
        ok: false,
        code: "INSPECT_CLIENT_NOT_AUTHORIZED",
      });
      expect(w.queries.held()).toBe(0);
    }),
  );

  it.effect(
    "a revoked device is refused and its connection dropped; an unreadable one is refused and changes nothing",
    () =>
      Effect.gen(function* () {
        const w = world();
        let state: "live" | "revoked" | "unreadable" = "live";
        const alice = yield* page(w, "alice", A, [THREAD], {
          read: () =>
            state === "unreadable"
              ? Effect.fail("the row cannot be read")
              : Effect.succeedSome(
                  state === "revoked" ? { ...live(), revokedAt: DateTime.makeUnsafe(0) } : live(),
                ),
        });
        state = "unreadable";
        expect(yield* alice.reply("req-1")).toMatchObject({
          ok: false,
          code: "INSPECT_CLIENT_UNAVAILABLE",
        });
        expect(w.registry.clientsViewing(THREAD)).toHaveLength(1); // nothing changed
        state = "revoked";
        expect(yield* alice.reply("req-1")).toMatchObject({
          ok: false,
          code: "INSPECT_CLIENT_DEVICE_REVOKED",
        });
        expect(w.registry.clientsViewing(THREAD)).toEqual([]); // the connection was closed with its client
      }),
  );

  it.effect(
    "makes no business call and logs no value: only operation names, statuses, codes and outcomes",
    () =>
      Effect.gen(function* () {
        const w = world();
        const alice = yield* page(w, "alice", A, [THREAD]);
        const asking = query(w);
        yield* flush;
        yield* alice.reply("req-1");
        yield* Effect.promise(() => asking);
        expect(JSON.stringify(w.logged)).not.toMatch(/Hello|secret-phase|client-aaaa|req-|alice/);
        expect(w.queries.held()).toBe(0);
      }),
  );
});
