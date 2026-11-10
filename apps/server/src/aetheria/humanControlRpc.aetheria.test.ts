// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M06 Plan step 6 (IP-20 to IP-22) — the XC-18 client RPCs through T3's REAL group, scope map, scope middleware and instrumentation map.
//
// Boundary: T3's real `WsRpcGroup` (now carrying the eleven XC-18 methods), the real exhaustive scope map and scope middleware
// (`RpcAuthorization.layer`) over an in-process RPC client, and this package's handlers over a FAKE interaction service (the step-5 archive is not
// repacked yet; the real service + real intake run in humanControlDelivery.aetheria.test.ts once it is). It shows: each method has one explicit
// scope — the reads and the stream `orchestration:read`, the seven actions `orchestration:operate`; a token without it is refused BEFORE the handler
// runs; the actor, scopes and authentication time the service receives are the connection's, and a payload field cannot name an actor; methods whose
// steps are not built answer INTERACTION_UNAVAILABLE and reach no service; no Backend answers unavailable, never an empty success. Step 16 adds: every
// handler passes only the schema's fields and the connection's actor to the service (seven actions, three reads); a read checks the scope and the
// service's access rule first and a refused check reaches no read; the stream unsubscribes when it ends, is interrupted, or the Backend drains. It does
// NOT show a real WebSocket upgrade, device pairing, or revocation of a live connection (humanControlClient.aetheria.test.ts runs the same handlers
// over the real service).
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthTerminalReadScope,
  WsRpcGroup,
} from "@t3tools/contracts";
import { AETHERIA_WS_METHODS } from "@t3tools/aetheria-contracts";
import type { HumanControlService } from "@t3tools/aetheria-server";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as RpcTest from "effect/rpc/RpcTest";

import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import { RPC_REQUIRED_SCOPES, requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import {
  authorizationGrant,
  connectionActor,
  interactionsAnswer,
  interactionsCancel,
  interactionsChanges,
  interactionsClose,
  interactionsHold,
  interactionsSnapshot,
  planDecide,
  planModeGet,
  planModeSet,
  tasksGet,
} from "./humanControlRpc.ts";

const M = AETHERIA_WS_METHODS;
const READS = [M.interactionsSnapshot, M.planModeGet, M.tasksGet, M.interactionsChanges] as const;
const ACTIONS = [
  M.interactionsAnswer,
  M.interactionsCancel,
  M.interactionsHold,
  M.interactionsClose,
  M.planDecide,
  M.planModeSet,
  M.authorizationGrant,
] as const;
const SHA = "b".repeat(64);

describe("the XC-18 methods are in T3's group with one explicit scope each", () => {
  it("joins WsRpcGroup, the scope map and the instrumentation map exhaustively", () => {
    for (const tag of [...READS, ...ACTIONS]) expect(WsRpcGroup.requests.has(tag)).toBe(true);
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(WsRpcGroup.requests.keys()));
    // The instrumentation map (IP-22) is not exported; its `satisfies Record<WsRpcMethod, string>` makes tsc fail on a missing method.
  });

  it("requires orchestration:read for the reads and the stream, orchestration:operate for the seven actions", () => {
    for (const tag of READS)
      expect(requiredScopeForRpcMethod(tag)).toBe(AuthOrchestrationReadScope);
    for (const tag of ACTIONS)
      expect(requiredScopeForRpcMethod(tag)).toBe(AuthOrchestrationOperateScope);
    expect(ACTIONS).toHaveLength(7);
  });
});

describe("authorization runs before the handler", () => {
  const subject = { type: "plan", id: "plan-1", revision: SHA };
  const withId = { interactionId: "int-1", revision: SHA };
  // One valid payload per non-stream method (the stream's scope row is checked above).
  const payloads: ReadonlyArray<readonly [string, unknown, string]> = [
    [M.interactionsSnapshot, { rootSessionId: "root-1" }, AuthOrchestrationReadScope],
    [M.planModeGet, { sessionId: "session-1" }, AuthOrchestrationReadScope],
    [M.tasksGet, { sessionId: "session-1" }, AuthOrchestrationReadScope],
    [
      M.interactionsAnswer,
      { ...withId, answers: [{ id: "q1", selected: ["a"], skipped: false }] },
      AuthOrchestrationOperateScope,
    ],
    [M.interactionsCancel, withId, AuthOrchestrationOperateScope],
    [M.interactionsHold, withId, AuthOrchestrationOperateScope],
    [M.interactionsClose, withId, AuthOrchestrationOperateScope],
    [M.planDecide, { ...withId, decision: "approved" }, AuthOrchestrationOperateScope],
    [
      M.planModeSet,
      { sessionId: "session-1", active: true, expectedModeRevision: 0 },
      AuthOrchestrationOperateScope,
    ],
    [M.authorizationGrant, { subject, sessionId: "session-1" }, AuthOrchestrationOperateScope],
  ];

  it.effect(
    "refuses a token without the method's scope before any handler runs, for the three reads and the seven actions",
    () =>
      Effect.gen(function* () {
        expect(payloads).toHaveLength(10);
        for (const [tag, payload, required] of payloads) {
          const group = WsRpcGroup.omit(
            ...([...WsRpcGroup.requests.keys()].filter((other) => other !== tag) as never[]),
          );
          // A token holding only the OTHER orchestration scope, or an unrelated one, or none.
          const insufficient =
            required === AuthOrchestrationOperateScope
              ? [[], [AuthTerminalReadScope], [AuthOrchestrationReadScope]]
              : [[], [AuthTerminalReadScope], [AuthOrchestrationOperateScope]];
          for (const scopes of insufficient) {
            const handled: Array<string> = [];
            // The group is narrowed to one method at run time; its static type cannot say which, so the call is typed by hand.
            const loose = group as unknown as {
              toLayerHandler: (t: string, h: () => unknown) => Layer.Layer<never>;
            };
            const makeClient = RpcTest.makeClient as unknown as (
              g: unknown,
            ) => Effect.Effect<
              Record<string, (p: unknown) => Effect.Effect<unknown, unknown>>,
              never,
              Scope.Scope
            >;
            const client = yield* makeClient(group).pipe(
              Effect.provide(
                Layer.mergeAll(
                  loose.toLayerHandler(tag, () =>
                    Effect.sync(() => handled.push(tag)).pipe(Effect.andThen(Effect.never)),
                  ),
                  RpcAuthorization.layer(scopes as never),
                ),
              ),
            );
            const refused = yield* client[tag]!(payload).pipe(Effect.flip);
            expect(refused).toMatchObject({
              _tag: "EnvironmentAuthorizationError",
              requiredPermission: required,
            });
            expect(handled).toEqual([]);
          }
        }
      }).pipe(Effect.scoped),
  );
});

const record = (state: string) => ({
  interactionId: "int-1",
  kind: "question",
  state,
  revision: SHA,
  rootSessionId: "root-1",
  sessionId: "session-1",
  askCallId: "call-1",
  createdAt: "2026-11-10T12:00:00.000Z",
  held: false,
  content: { questions: [{ id: "q1", question: "Which?" }] },
});

const fakeService = (options: { readonly access?: boolean } = {}) => {
  const calls: Array<{ readonly method: string; readonly args: readonly unknown[] }> = [];
  const listeners = new Set<(change: { rootSessionId: string; version: number }) => void>();
  const ends = new Set<() => void>();
  const note =
    <R>(method: string, result: R) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return result;
    };
  const service = {
    snapshot: async (rootSessionId: string) => {
      calls.push({ method: "snapshot", args: [rootSessionId] });
      return { ok: true, value: { rootSessionId, version: 3, interactions: [record("pending")] } };
    },
    answer: note("answer", { ok: true, value: record("answered") }),
    cancel: note("cancel", { ok: true, value: record("cancelled") }),
    hold: note("hold", { ok: true, value: { ...record("pending"), held: true } }),
    close: note("close", { ok: true, value: record("pending") }),
    decidePlan: note("decidePlan", { ok: true, value: record("answered") }),
    getPlanMode: note("getPlanMode", {
      ok: true,
      value: { sessionId: "session-1", active: false, modeRevision: 0 },
    }),
    setPlanMode: note("setPlanMode", {
      ok: true,
      value: { sessionId: "session-1", active: true, modeRevision: 1 },
    }),
    grant: note("grant", { ok: true, value: { originId: "org-1" } }),
    canAccess: async (...args: unknown[]) => {
      calls.push({ method: "canAccess", args });
      return options.access ?? true;
    },
    onChange: (listener: (change: { rootSessionId: string; version: number }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as HumanControlService;
  /** What the Backend's `watchInteractions` does: subscribe, and run the end hook at a drain. */
  const watch = (
    listener: (change: { rootSessionId: string; version: number }) => void,
    onEnd: () => void,
  ) => {
    const stop = service.onChange(listener);
    ends.add(onEnd);
    return () => {
      stop();
      ends.delete(onEnd);
    };
  };
  return { service, calls, listeners, ends, watch };
};
const backendOf = (service: HumanControlService | undefined, watch = fakeService().watch) =>
  Option.some({
    interactions: () => service,
    watchInteractions: (
      listener: (change: { rootSessionId: string; version: number }) => void,
      onEnd: () => void,
    ) => (service === undefined ? undefined : watch(listener, onEnd)),
  });
const session = {
  sessionId: "client-session-1",
  scopes: [AuthOrchestrationOperateScope, AuthOrchestrationReadScope],
};

describe("the handlers over the one interaction service", () => {
  it.effect("takes the actor from the connection, never from the payload", () =>
    Effect.gen(function* () {
      const fake = fakeService();
      const actor = yield* connectionActor(session as never);
      expect(actor).toMatchObject({
        clientSessionId: "client-session-1",
        grantedScopes: [AuthOrchestrationOperateScope, AuthOrchestrationReadScope],
      });
      expect(Number.isNaN(Date.parse(actor.authenticatedAt))).toBe(false);
      const reply = yield* interactionsAnswer(backendOf(fake.service), actor, {
        interactionId: "int-1",
        revision: SHA,
        answers: [{ id: "q1", selected: ["a"], skipped: false }],
        // A forged claim is not part of the schema; the handler never reads one.
        ...({ actor: { clientSessionId: "someone-else" } } as object),
      });
      expect(reply).toMatchObject({ ok: true, value: { state: "answered" } });
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]?.args[0]).toEqual({ actor });
      expect(JSON.stringify(fake.calls[0]?.args[1])).not.toContain("someone-else");
    }),
  );

  it.effect(
    "serves the snapshot of a root from the service, and unavailable when no service runs",
    () =>
      Effect.gen(function* () {
        const fake = fakeService();
        const actor = yield* connectionActor(session);
        expect(
          yield* interactionsSnapshot(backendOf(fake.service), actor, { rootSessionId: "root-1" }),
        ).toMatchObject({ ok: true, value: { rootSessionId: "root-1", version: 3 } });
        // The access rule was asked about this root before the snapshot was read.
        expect(fake.calls.map((call) => call.method)).toEqual(["canAccess", "snapshot"]);
        for (const none of [Option.none(), backendOf(undefined)]) {
          const reply = yield* interactionsSnapshot(none, actor, { rootSessionId: "root-1" });
          expect(reply).toMatchObject({ ok: false, code: "INTERACTION_UNAVAILABLE" });
        }
      }),
  );

  it.effect("reads nothing for a connection without the read scope or the host's access", () =>
    Effect.gen(function* () {
      const refused = fakeService({ access: false });
      const allowed = fakeService();
      const reader = yield* connectionActor(session);
      const operateOnly = yield* connectionActor({
        sessionId: "c2",
        scopes: [AuthOrchestrationOperateScope],
      });
      const asks = [
        interactionsSnapshot(backendOf(refused.service), reader, { rootSessionId: "root-1" }),
        planModeGet(backendOf(refused.service), reader, { sessionId: "session-1" }),
        tasksGet(backendOf(refused.service), reader, { sessionId: "session-1" }),
        interactionsSnapshot(backendOf(allowed.service), operateOnly, { rootSessionId: "root-1" }),
        planModeGet(backendOf(allowed.service), operateOnly, { sessionId: "session-1" }),
      ];
      for (const ask of asks)
        expect(yield* ask).toMatchObject({ ok: false, code: "INTERACTION_NOT_FOUND" });
      expect(refused.calls.map((call) => call.method)).toEqual([
        "canAccess",
        "canAccess",
        "canAccess",
      ]);
      // The scope is checked before the access rule is asked, and no read ever ran.
      expect(allowed.calls).toEqual([]);
    }),
  );

  it.effect(
    "serves planMode.get after the check and answers tasks.get unavailable, never an empty list",
    () =>
      Effect.gen(function* () {
        const fake = fakeService();
        const actor = yield* connectionActor(session);
        expect(
          yield* planModeGet(backendOf(fake.service), actor, { sessionId: "session-1" }),
        ).toMatchObject({
          ok: true,
          value: { active: false, modeRevision: 0 },
        });
        const tasks = yield* tasksGet(backendOf(fake.service), actor, { sessionId: "session-1" });
        expect(tasks).toMatchObject({ ok: false, code: "INTERACTION_UNAVAILABLE" });
      }),
  );

  it.effect(
    "passes only the schema's fields and the connection's actor to each of the seven actions",
    () =>
      Effect.gen(function* () {
        const fake = fakeService();
        const backend = backendOf(fake.service);
        const actor = yield* connectionActor(session);
        const ids = { interactionId: "int-1", revision: SHA };
        const forged = {
          actor: { clientSessionId: "someone-else" },
          rootSessionId: "root-X",
        } as object;
        const subject = { type: "plan", id: "plan-1", revision: SHA };
        yield* interactionsCancel(backend, actor, { ...ids, feedback: "no", ...forged });
        yield* interactionsHold(backend, actor, { ...ids, ...forged });
        yield* interactionsClose(backend, actor, { ...ids, ...forged });
        yield* planDecide(backend, actor, {
          ...ids,
          decision: "changes_requested",
          feedback: "more",
          ...forged,
        });
        yield* planModeSet(backend, actor, {
          sessionId: "session-1",
          active: true,
          expectedModeRevision: 0,
          ...forged,
        });
        const granted = yield* authorizationGrant(backend, actor, {
          subject,
          sessionId: "session-1",
          ...forged,
        });
        expect(granted).toEqual({ ok: true, value: { originId: "org-1" } });
        expect(fake.calls.map((call) => call.method)).toEqual([
          "cancel",
          "hold",
          "close",
          "decidePlan",
          "setPlanMode",
          "grant",
        ]);
        for (const call of fake.calls) {
          expect(call.args[0]).toEqual({ actor });
          expect(JSON.stringify(call.args)).not.toContain("someone-else");
          expect(JSON.stringify(call.args)).not.toContain("root-X");
        }
        expect(fake.calls[0]?.args[1]).toEqual({ ...ids, feedback: "no" });
        expect(fake.calls[2]?.args[1]).toEqual(ids);
        expect(fake.calls[3]?.args[1]).toEqual({
          ...ids,
          decision: "changes_requested",
          feedback: "more",
        });
        expect(fake.calls[5]?.args[1]).toEqual({ subject, sessionId: "session-1" });
      }),
  );

  it.effect(
    "answers unavailable, and an unknown outcome for a write, when no service runs or one call fails",
    () =>
      Effect.gen(function* () {
        const actor = yield* connectionActor(session);
        const broken = {
          hold: async () => {
            throw new Error("boom");
          },
        } as unknown as HumanControlService;
        const failed = yield* interactionsHold(backendOf(broken), actor, {
          interactionId: "int-1",
          revision: SHA,
        });
        expect((failed as { detail?: string }).detail).toMatch(/^outcome unknown/);
        for (const none of [Option.none(), backendOf(undefined)])
          expect(
            yield* planModeSet(none, actor, {
              sessionId: "s",
              active: true,
              expectedModeRevision: 0,
            }),
          ).toMatchObject({ ok: false, code: "INTERACTION_UNAVAILABLE" });
      }),
  );

  it.effect(
    "reports an unknown outcome, not a definite non-execution, when the service call itself fails",
    () =>
      Effect.gen(function* () {
        const broken = {
          answer: async () => {
            throw new Error("boom");
          },
        } as unknown as HumanControlService;
        const actor = yield* connectionActor(session as never);
        const reply = yield* interactionsAnswer(backendOf(broken), actor, {
          interactionId: "int-1",
          revision: SHA,
          answers: [],
        });
        expect(reply).toMatchObject({ ok: false, code: "INTERACTION_UNAVAILABLE" });
        expect((reply as { detail?: string }).detail).toMatch(/^outcome unknown/);
      }),
  );

  it.live(
    "streams only the changes of the requested root, and stops listening when the stream ends",
    () =>
      Effect.gen(function* () {
        const fake = fakeService();
        const actor = yield* connectionActor(session);
        const fiber = yield* interactionsChanges(backendOf(fake.service, fake.watch), actor, {
          rootSessionId: "root-1",
        }).pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped);
        yield* Effect.promise(() => vi.waitFor(() => expect(fake.listeners.size).toBe(1)));
        for (const change of [
          { rootSessionId: "root-OTHER", version: 9 },
          { rootSessionId: "root-1", version: 4 },
          { rootSessionId: "root-1", version: 5 },
        ])
          for (const listener of fake.listeners) listener(change);
        expect(Array.from(yield* Fiber.join(fiber))).toEqual([
          { rootSessionId: "root-1", version: 4 },
          { rootSessionId: "root-1", version: 5 },
        ]);
        yield* Effect.promise(() => vi.waitFor(() => expect(fake.listeners.size).toBe(0)));
        // No running service: the stream ends at once; the client re-reads the snapshot, which then answers unavailable.
        expect(
          Array.from(
            yield* Stream.runCollect(
              interactionsChanges(Option.none(), actor, { rootSessionId: "root-1" }),
            ),
          ),
        ).toEqual([]);
      }).pipe(Effect.scoped),
  );

  it.live(
    "unsubscribes when the connection's fiber is interrupted, and ends when the Backend drains",
    () =>
      Effect.gen(function* () {
        const fake = fakeService();
        const actor = yield* connectionActor(session);
        const backend = backendOf(fake.service, fake.watch);
        const start = () =>
          interactionsChanges(backend, actor, { rootSessionId: "root-1" }).pipe(
            Stream.runDrain,
            Effect.forkScoped,
          );

        // Disconnect or revocation interrupts the connection's fibers: the listener goes.
        const disconnected = yield* start();
        yield* Effect.promise(() => vi.waitFor(() => expect(fake.listeners.size).toBe(1)));
        yield* Fiber.interrupt(disconnected);
        yield* Effect.promise(() => vi.waitFor(() => expect(fake.listeners.size).toBe(0)));
        expect(fake.ends.size).toBe(0);

        // A drain runs the end hook: the stream completes on its own.
        const drained = yield* start();
        yield* Effect.promise(() => vi.waitFor(() => expect(fake.ends.size).toBe(1)));
        for (const end of fake.ends) end();
        yield* Fiber.join(drained);
        yield* Effect.promise(() => vi.waitFor(() => expect(fake.listeners.size).toBe(0)));
      }).pipe(Effect.scoped),
  );

  it.live(
    "ends at once, subscribing nothing, when the connection fails the scope or access check",
    () =>
      Effect.gen(function* () {
        const refused = fakeService({ access: false });
        const allowed = fakeService();
        const reader = yield* connectionActor(session);
        const operateOnly = yield* connectionActor({
          sessionId: "c2",
          scopes: [AuthOrchestrationOperateScope],
        });
        for (const [fake, actor] of [
          [refused, reader],
          [allowed, operateOnly],
        ] as const)
          expect(
            Array.from(
              yield* Stream.runCollect(
                interactionsChanges(backendOf(fake.service, fake.watch), actor, {
                  rootSessionId: "root-1",
                }),
              ),
            ),
          ).toEqual([]);
        expect(refused.listeners.size + allowed.listeners.size).toBe(0);
      }).pipe(Effect.scoped),
  );
});
