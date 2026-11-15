// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off
// AETHERIA M11 Plan step 3 (B3, C5 P4, C6 U3) — probe: can the Backend send one correlated request to ONE connected page and get its reply?
//
// Boundary: Effect's real RpcGroup / RpcTest machinery with a probe-only group of one custom STREAM method (the request channel, the same kind
// as `subscribeThread` / `aetheria.interactions.changes`) and one plain REPLY method, two client connections each with its own scope, and a
// probe-only hub that holds only the table of pending requests. It shows: a request reaches only the chosen viewer of the thread; the reply is
// correlated by id and from the owning connection only; no-client, ambiguous, silent (deadline), closing (disconnected) and late-reply outcomes;
// one attempt per query; the connection's lifetime is its scope. It does NOT show a real WebSocket, T3's RpcAuthorization middleware or request
// scope, a built page, or the shipped carrier: those are the native probe's (tests/inspect/probes/client-roundtrip.native.test.mjs), which is not
// satisfied by this test. The group is NOT added to T3's WsRpcGroup; no production file is touched.
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcTest from "effect/rpc/RpcTest";
import * as TestClock from "effect/testing/TestClock";

const Request = Schema.Struct({ id: Schema.String, op: Schema.String });
const Requests = Rpc.make("probe.requests", {
  payload: Schema.Struct({ threadId: Schema.String }),
  success: Request,
  stream: true,
});
const Reply = Rpc.make("probe.reply", {
  payload: Schema.Struct({ id: Schema.String, body: Schema.String }),
  success: Schema.Struct({ accepted: Schema.Boolean }),
});
const Group = RpcGroup.make(Requests, Reply);

type Outcome = "ok" | "no-client" | "ambiguous" | "disconnected" | "timeout";
interface Conn {
  readonly id: string;
  readonly threadId: string;
  readonly queue: Queue.Queue<{ id: string; op: string }>;
}
interface Pending {
  readonly owner: string;
  readonly done: Deferred.Deferred<{ outcome: Outcome; body?: string }>;
}

/** The two methods of the probe group as a client calls them (the group's own client type, restated without its handler requirements). */
interface PageClient {
  readonly "probe.requests": (input: {
    readonly threadId: string;
  }) => Stream.Stream<{ readonly id: string; readonly op: string }>;
  readonly "probe.reply": (input: {
    readonly id: string;
    readonly body: string;
  }) => Effect.Effect<{ readonly accepted: boolean }>;
}

/** The probe hub: connections and the pending table only; no replies are stored, and a settled entry is removed. */
const makeHub = () => {
  const conns = new Map<string, Conn>();
  const pending = new Map<string, Pending>();
  const sent: Array<{ conn: string; id: string }> = [];
  let n = 0;
  const settleFor = (connId: string, outcome: Outcome) =>
    Effect.forEach(
      [...pending].filter(([, p]) => p.owner === connId),
      ([id, p]) =>
        Effect.sync(() => pending.delete(id)).pipe(
          Effect.andThen(Deferred.succeed(p.done, { outcome })),
        ),
      { discard: true },
    );
  const ask = (threadId: string, op: string, deadlineMs: number, clientId?: string) =>
    Effect.gen(function* () {
      const viewers = [...conns.values()].filter((c) => c.threadId === threadId);
      const chosen = clientId === undefined ? viewers : viewers.filter((c) => c.id === clientId);
      if (chosen.length === 0) return { outcome: "no-client" as Outcome };
      if (chosen.length > 1)
        return { outcome: "ambiguous" as Outcome, clients: chosen.map((c) => c.id) };
      const target = chosen[0]!;
      const id = `q${(n += 1)}`;
      const done = yield* Deferred.make<{ outcome: Outcome; body?: string }>();
      pending.set(id, { owner: target.id, done });
      sent.push({ conn: target.id, id });
      yield* Queue.offer(target.queue, { id, op }); // exactly one attempt
      const settled = yield* Deferred.await(done).pipe(
        Effect.timeoutOption(deadlineMs),
        Effect.map(
          Option.getOrElse((): { outcome: Outcome; body?: string } => ({ outcome: "timeout" })),
        ),
      );
      pending.delete(id); // deadline cleanup: a late reply finds nothing
      return settled;
    });
  /** One connection's handlers; `scope` is the connection's own, closed when the socket closes. */
  const connect = (
    connId: string,
    threadId: string,
    scope: Scope.Scope,
    behaviour: (op: string) => "reply" | "silent",
  ) =>
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<{ id: string; op: string }>();
      conns.set(connId, { id: connId, threadId, queue });
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => conns.delete(connId)).pipe(
          Effect.andThen(Effect.suspend(() => settleFor(connId, "disconnected"))),
        ),
      );
      const layer = Layer.mergeAll(
        Group.toLayerHandler("probe.requests", () => Stream.fromQueue(queue)),
        Group.toLayerHandler("probe.reply", ({ id, body }) =>
          Effect.gen(function* () {
            const p = pending.get(id);
            if (!p || p.owner !== connId) return { accepted: false }; // unknown, settled, or another connection's id
            pending.delete(id);
            yield* Deferred.succeed(p.done, { outcome: "ok" as Outcome, body });
            return { accepted: true };
          }),
        ),
      );
      const made = yield* RpcTest.makeClient(Group).pipe(Effect.provide(layer));
      const client = made as unknown as PageClient;
      return { client, behaviour };
    });
  return { ask, connect, conns, pending, sent };
};

/** A page: subscribes to the request stream and answers according to its behaviour; records everything it received. */
const runPage = (
  page: { client: PageClient; behaviour: (op: string) => "reply" | "silent" },
  threadId: string,
  received: Array<string>,
  replyBody = "region-values",
) =>
  page.client["probe.requests"]({ threadId }).pipe(
    Stream.runForEach((request: { id: string; op: string }) =>
      Effect.gen(function* () {
        received.push(request.id);
        if (page.behaviour(request.op) === "reply")
          yield* page.client["probe.reply"]({ id: request.id, body: replyBody });
      }),
    ),
    Effect.forkScoped,
  );

/** Lets forked consumers and the hub run to their next wait: yields, no clock. */
const settle = Effect.forEach(Array.from({ length: 40 }), () => Effect.yieldNow, { discard: true });

describe("B3: a correlated request reaches one page and its reply comes back", () => {
  it.effect(
    "sends to the single viewer of the thread; another connection on another thread receives nothing",
    () =>
      Effect.gen(function* () {
        const hub = makeHub();
        const scopeA = yield* Scope.make();
        const scopeB = yield* Scope.make();
        const a = yield* hub.connect("A", "t1", scopeA, () => "reply");
        const b = yield* hub.connect("B", "t2", scopeB, () => "reply");
        const gotA: Array<string> = [];
        const gotB: Array<string> = [];
        yield* runPage(a, "t1", gotA).pipe(Effect.provideService(Scope.Scope, scopeA));
        yield* runPage(b, "t2", gotB).pipe(Effect.provideService(Scope.Scope, scopeB));
        yield* settle;
        const result = yield* hub.ask("t1", "query", 1000);
        expect(result).toEqual({ outcome: "ok", body: "region-values" });
        yield* settle;
        expect(gotA).toHaveLength(1);
        expect(gotB).toEqual([]);
        expect(hub.sent).toEqual([{ conn: "A", id: "q1" }]);
        expect(hub.pending.size).toBe(0);
        yield* Scope.close(scopeA, { _tag: "Success", value: undefined } as never);
        yield* Scope.close(scopeB, { _tag: "Success", value: undefined } as never);
      }),
  );

  it.effect(
    "no viewer is no-client; two viewers are ambiguous (ids only) and an explicit id selects one; an explicit id outside the viewers is no-client",
    () =>
      Effect.gen(function* () {
        const hub = makeHub();
        expect(yield* hub.ask("t1", "q", 200)).toEqual({ outcome: "no-client" });
        const scopeA = yield* Scope.make();
        const scopeB = yield* Scope.make();
        const scopeC = yield* Scope.make();
        const a = yield* hub.connect("A", "t1", scopeA, () => "reply");
        const b = yield* hub.connect("B", "t1", scopeB, () => "reply");
        const c = yield* hub.connect("C", "t9", scopeC, () => "reply");
        const got: Record<string, Array<string>> = { A: [], B: [], C: [] };
        yield* runPage(a, "t1", got.A!).pipe(Effect.provideService(Scope.Scope, scopeA));
        yield* runPage(b, "t1", got.B!).pipe(Effect.provideService(Scope.Scope, scopeB));
        yield* runPage(c, "t9", got.C!).pipe(Effect.provideService(Scope.Scope, scopeC));
        yield* settle;
        expect(yield* hub.ask("t1", "q", 200)).toEqual({
          outcome: "ambiguous",
          clients: ["A", "B"],
        });
        expect(hub.sent).toEqual([]); // ambiguity sends nothing
        expect((yield* hub.ask("t1", "q", 500, "B")).outcome).toBe("ok");
        yield* settle;
        expect(got).toEqual({ A: [], B: ["q1"], C: [] });
        expect(yield* hub.ask("t1", "q", 200, "C")).toEqual({ outcome: "no-client" }); // C views another thread
        for (const s of [scopeA, scopeB, scopeC])
          yield* Scope.close(s, { _tag: "Success", value: undefined } as never);
      }),
  );

  it.effect(
    "a silent page ends at the deadline with timeout, after one attempt, and its late reply is refused",
    () =>
      Effect.gen(function* () {
        const hub = makeHub();
        const scope = yield* Scope.make();
        const page = yield* hub.connect("A", "t1", scope, () => "silent");
        const got: Array<string> = [];
        yield* runPage(page, "t1", got).pipe(Effect.provideService(Scope.Scope, scope));
        yield* settle;
        const asking = yield* hub.ask("t1", "q", 80).pipe(Effect.forkChild);
        yield* settle;
        yield* TestClock.adjust(79);
        yield* settle;
        expect(hub.pending.size).toBe(1); // still waiting one millisecond before the deadline
        yield* TestClock.adjust(1);
        const result = yield* Fiber.join(asking);
        expect(result.outcome).toBe("timeout");
        expect(got).toEqual(["q1"]); // one attempt, no retry
        expect(hub.pending.size).toBe(0);
        const late = yield* page.client["probe.reply"]({ id: "q1", body: "late" });
        expect(late).toEqual({ accepted: false });
        yield* Scope.close(scope, { _tag: "Success", value: undefined } as never);
      }),
  );

  it.effect("a reply for another connection's id is refused; the owner can still answer", () =>
    Effect.gen(function* () {
      const hub = makeHub();
      const scopeA = yield* Scope.make();
      const scopeB = yield* Scope.make();
      const a = yield* hub.connect("A", "t1", scopeA, () => "silent");
      const b = yield* hub.connect("B", "t2", scopeB, () => "silent");
      yield* runPage(a, "t1", []).pipe(Effect.provideService(Scope.Scope, scopeA));
      yield* runPage(b, "t2", []).pipe(Effect.provideService(Scope.Scope, scopeB));
      yield* settle;
      const asking = yield* hub.ask("t1", "q", 1000).pipe(Effect.forkChild);
      yield* settle;
      expect(yield* b.client["probe.reply"]({ id: "q1", body: "forged" })).toEqual({
        accepted: false,
      });
      expect(yield* a.client["probe.reply"]({ id: "q1", body: "genuine" })).toEqual({
        accepted: true,
      });
      expect(yield* Fiber.join(asking)).toEqual({ outcome: "ok", body: "genuine" });
      for (const s of [scopeA, scopeB])
        yield* Scope.close(s, { _tag: "Success", value: undefined } as never);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "closing the connection while a query is pending settles it as disconnected, not timeout",
    () =>
      Effect.gen(function* () {
        const hub = makeHub();
        const scope = yield* Scope.make();
        const page = yield* hub.connect("A", "t1", scope, () => "silent");
        yield* runPage(page, "t1", []).pipe(Effect.provideService(Scope.Scope, scope));
        yield* settle;
        const fiber = yield* hub.ask("t1", "q", 5000).pipe(Effect.forkChild);
        yield* settle;
        expect(hub.pending.size).toBe(1);
        yield* Scope.close(scope, { _tag: "Success", value: undefined } as never);
        const settled = yield* Fiber.join(fiber);
        expect(settled.outcome).toBe("disconnected");
        expect(hub.conns.size).toBe(0);
        expect(hub.pending.size).toBe(0);
      }).pipe(Effect.scoped),
  );
});

describe("21 sequential correlated round trips", () => {
  it.effect(
    "each is answered once by the one page, with one attempt and no leftover pending entry (no timing: in-process times cannot fix D)",
    () =>
      Effect.gen(function* () {
        const hub = makeHub();
        const scope = yield* Scope.make();
        const page = yield* hub.connect("A", "t1", scope, () => "reply");
        const got: Array<string> = [];
        yield* runPage(page, "t1", got).pipe(Effect.provideService(Scope.Scope, scope));
        yield* settle;
        for (let i = 0; i < 21; i += 1) {
          const asking = yield* hub.ask("t1", "query", 10_000).pipe(Effect.forkChild);
          yield* settle;
          expect(yield* Fiber.join(asking)).toEqual({ outcome: "ok", body: "region-values" });
        }
        expect(got).toHaveLength(21);
        expect(new Set(got).size).toBe(21);
        expect(hub.sent).toHaveLength(21);
        expect(hub.pending.size).toBe(0);
        yield* Scope.close(scope, { _tag: "Success", value: undefined } as never);
      }),
  );
});
