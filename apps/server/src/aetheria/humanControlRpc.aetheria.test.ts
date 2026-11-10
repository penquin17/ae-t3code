// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M06 Plan step 6 (IP-20 to IP-22) — the XC-18 client RPCs through T3's REAL group, scope map, scope middleware and instrumentation map.
//
// Boundary: T3's real `WsRpcGroup` (now carrying the eleven XC-18 methods), the real exhaustive scope map and scope middleware
// (`RpcAuthorization.layer`) over an in-process RPC client, and this package's handlers over a FAKE interaction service (the step-5 archive is not
// repacked yet; the real service + real intake run in humanControlDelivery.aetheria.test.ts once it is). It shows: each method has one explicit
// scope — the reads and the stream `orchestration:read`, the seven actions `orchestration:operate`; a token without it is refused BEFORE the handler
// runs; the actor, scopes and authentication time the service receives are the connection's, and a payload field cannot name an actor; methods whose
// steps are not built answer INTERACTION_UNAVAILABLE and reach no service; no Backend answers unavailable, never an empty success. It does NOT show a
// real WebSocket upgrade, device pairing, or revocation of a live connection (a later scripted-client step).
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
import * as Stream from "effect/Stream";
import * as RpcTest from "effect/rpc/RpcTest";

import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import { RPC_REQUIRED_SCOPES, requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import {
  connectionActor,
  interactionsAnswer,
  interactionsChanges,
  interactionsSnapshot,
  unbuiltAction,
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
  const group = WsRpcGroup.omit(
    ...[...WsRpcGroup.requests.keys()].filter(
      (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, typeof M.interactionsAnswer> =>
        tag !== M.interactionsAnswer,
    ),
  );
  const payload = {
    interactionId: "int-1",
    revision: SHA,
    answers: [{ id: "q1", selected: ["a"], skipped: false }],
  };

  it.effect("refuses an absent or read-only token for answer before any handler runs", () =>
    Effect.gen(function* () {
      for (const scopes of [[], [AuthTerminalReadScope], [AuthOrchestrationReadScope]] as const) {
        const handled: Array<string> = [];
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.mergeAll(
              group.toLayerHandler(M.interactionsAnswer, () =>
                Effect.sync(() => handled.push("answer")).pipe(Effect.andThen(Effect.never)),
              ),
              RpcAuthorization.layer(scopes),
            ),
          ),
        );
        expect(yield* client[M.interactionsAnswer](payload).pipe(Effect.flip)).toMatchObject({
          _tag: "EnvironmentAuthorizationError",
          requiredPermission: AuthOrchestrationOperateScope,
        });
        expect(handled).toEqual([]);
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

const fakeService = () => {
  const calls: Array<{ readonly method: string; readonly args: readonly unknown[] }> = [];
  const listeners = new Set<(change: { rootSessionId: string; version: number }) => void>();
  const service = {
    snapshot: async (rootSessionId: string) => {
      calls.push({ method: "snapshot", args: [rootSessionId] });
      return { ok: true, value: { rootSessionId, version: 3, interactions: [record("pending")] } };
    },
    answer: async (who: unknown, args: unknown) => {
      calls.push({ method: "answer", args: [who, args] });
      return { ok: true, value: record("answered") };
    },
    onChange: (listener: (change: { rootSessionId: string; version: number }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as HumanControlService;
  return { service, calls, listeners };
};
const backendOf = (service: HumanControlService | undefined) =>
  Option.some({ interactions: () => service });
const session = { sessionId: "client-session-1", scopes: [AuthOrchestrationOperateScope] };

describe("the handlers over the one interaction service", () => {
  it.effect("takes the actor from the connection, never from the payload", () =>
    Effect.gen(function* () {
      const fake = fakeService();
      const actor = yield* connectionActor(session as never);
      expect(actor).toMatchObject({
        clientSessionId: "client-session-1",
        grantedScopes: [AuthOrchestrationOperateScope],
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
        expect(
          yield* interactionsSnapshot(backendOf(fake.service), { rootSessionId: "root-1" }),
        ).toMatchObject({ ok: true, value: { rootSessionId: "root-1", version: 3 } });
        for (const none of [Option.none(), backendOf(undefined)]) {
          const reply = yield* interactionsSnapshot(none, { rootSessionId: "root-1" });
          expect(reply).toMatchObject({ ok: false, code: "INTERACTION_UNAVAILABLE" });
        }
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

  it("answers INTERACTION_UNAVAILABLE for an action whose step is not built, and reaches no service", () => {
    const fake = fakeService();
    expect(unbuiltAction("cancel")).toMatchObject({ ok: false, code: "INTERACTION_UNAVAILABLE" });
    expect(fake.calls).toEqual([]);
  });

  it.live(
    "streams only the changes of the requested root, and stops listening when the stream ends",
    () =>
      Effect.gen(function* () {
        const fake = fakeService();
        const fiber = yield* interactionsChanges(backendOf(fake.service), {
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
              interactionsChanges(Option.none(), { rootSessionId: "root-1" }),
            ),
          ),
        ).toEqual([]);
      }).pipe(Effect.scoped),
  );
});
