// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 3 (R1, R3, XC-15; IP-40 to IP-42) — the user's tree Stop and per-child controls through T3's REAL group, scope map and scope middleware.
//
// Boundary: T3's real `WsRpcGroup` (carrying the four `aetheria.children.*` methods), the real exhaustive scope map and scope middleware over an in-process RPC client, and
// `childrenControlRpc.ts` over FAKE M05 direct calls, a FAKE thread index and a FAKE host access rule, with the REAL per-call device check (a fake `auth_sessions` row store).
// It shows: each method's scope and a refusal before the handler runs; the actor only from the connection; a revoked, expired, missing or unreadable device session reaches no
// M05 call; a root the connection may not reach, a child that is not under the named root, and a Backend that is stopped reach no M05 call; a valid Stop is exactly ONE
// cancelTree call with the user caller; a lost reply is `CHILDREN_OUTCOME_UNKNOWN` and is not retried; M05's partial child failures pass through unchanged.
// It does NOT show the real M05 service, a real WebSocket, or stored child state (the native driver in step 6 compares the stored state).
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthTerminalReadScope,
  WsRpcGroup,
} from "@t3tools/contracts";
import { AETHERIA_WS_METHODS } from "@t3tools/aetheria-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as RpcTest from "effect/rpc/RpcTest";

import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import { RPC_REQUIRED_SCOPES, requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import { AuthSessionRepository } from "../persistence/AuthSessions.ts";
import {
  childrenCancelTree,
  childrenClose,
  childrenInterrupt,
  childrenList,
} from "./childrenControlRpc.ts";
import { connectionActor } from "./humanControlRpc.ts";

const M = AETHERIA_WS_METHODS;
const OPERATE = [M.childrenCancelTree, M.childrenInterrupt, M.childrenClose] as const;
const ROOT = "thread-root";
const OTHER_ROOT = "thread-other";
const CHILD = "thread-child";
type Session = { sessionId: string; scopes: ReadonlyArray<string> };
const SESSION: Session = {
  sessionId: "device-1",
  scopes: [AuthOrchestrationOperateScope, AuthOrchestrationReadScope],
};
const READ_ONLY = { sessionId: "device-1", scopes: [AuthOrchestrationReadScope] };
const OPERATE_ONLY = { sessionId: "device-1", scopes: [AuthOrchestrationOperateScope] };

describe("the children methods are in T3's group with one explicit scope each", () => {
  it("joins WsRpcGroup and the scope map exhaustively: list reads, the other three operate", () => {
    for (const tag of [...OPERATE, M.childrenList]) expect(WsRpcGroup.requests.has(tag)).toBe(true);
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(WsRpcGroup.requests.keys()));
    for (const tag of OPERATE)
      expect(requiredScopeForRpcMethod(tag)).toBe(AuthOrchestrationOperateScope);
    expect(requiredScopeForRpcMethod(M.childrenList)).toBe(AuthOrchestrationReadScope);
  });

  it.effect("refuses a token without the scope before any handler runs", () =>
    Effect.gen(function* () {
      const payloads: ReadonlyArray<readonly [string, unknown, string]> = [
        [M.childrenCancelTree, { rootThreadId: ROOT }, AuthOrchestrationOperateScope],
        [
          M.childrenInterrupt,
          { rootThreadId: ROOT, childThreadId: CHILD },
          AuthOrchestrationOperateScope,
        ],
        [
          M.childrenClose,
          { rootThreadId: ROOT, childThreadId: CHILD },
          AuthOrchestrationOperateScope,
        ],
        [M.childrenList, { rootThreadId: ROOT }, AuthOrchestrationReadScope],
      ];
      for (const [tag, payload, required] of payloads) {
        const group = WsRpcGroup.omit(
          ...([...WsRpcGroup.requests.keys()].filter((other) => other !== tag) as never[]),
        );
        const insufficient =
          required === AuthOrchestrationOperateScope
            ? [[], [AuthTerminalReadScope], [AuthOrchestrationReadScope]]
            : [[], [AuthTerminalReadScope], [AuthOrchestrationOperateScope]];
        for (const scopes of insufficient) {
          const handled: Array<string> = [];
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

type Call = { readonly method: string; readonly args: readonly unknown[] };
interface Options {
  /** Roots the host's access rule refuses. */
  readonly deniedRoots?: ReadonlyArray<string>;
  /** Thread ids the index knows (thread → Pi session) and whether each is a subagent; default: root and other root as mains, child as a subagent. */
  readonly bindings?: Record<string, { sessionId: string; subagent: boolean | null }>;
  readonly corruptThreads?: ReadonlyArray<string>;
  /** The kind M03's identity record gives a Pi session (default: pi-child is a child, any other session a main); `unreadable` sessions answer unavailable. */
  readonly sessionKinds?: Record<string, "not-child" | "child" | "unavailable">;
  readonly noInteractions?: boolean;
  readonly noOrchestration?: boolean;
  readonly noDirect?: boolean;
  readonly cancelTree?: () => Promise<unknown>;
  readonly list?: () => Promise<unknown>;
  readonly interruptTurn?: () => Promise<unknown>;
  readonly closeChild?: () => Promise<unknown>;
}
const CANCEL_VALUE = {
  rootThreadId: ROOT,
  rows: [
    { childId: CHILD, action: "interrupted" },
    { childId: "thread-idle", action: "left-idle" },
  ],
  rootStopped: true,
  complete: true,
};
const ROW = (childId: string, mode: "continuable" | "one-shot", state = "running") => ({
  childId,
  parentId: ROOT,
  depth: 1,
  role: null,
  mode,
  state,
  lastOutcome: null,
  route: null,
});

const fakeBackend = (options: Options = {}) => {
  const calls: Array<Call> = [];
  const note =
    (method: string, result: () => Promise<unknown>) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return result();
    };
  const bindings = options.bindings ?? {
    [ROOT]: { sessionId: "pi-root", subagent: false },
    [OTHER_ROOT]: { sessionId: "pi-other", subagent: false },
    [CHILD]: { sessionId: "pi-child", subagent: true },
  };
  const direct = {
    cancelTree: note(
      "cancelTree",
      options.cancelTree ?? (async () => ({ ok: true, value: CANCEL_VALUE })),
    ),
    listChildren: note(
      "listChildren",
      options.list ??
        (async () => ({
          ok: true,
          value: {
            rows: [ROW(CHILD, "continuable"), ROW("thread-oneshot", "one-shot")],
            diagnostics: [],
          },
        })),
    ),
    interruptTurn: note(
      "interruptTurn",
      options.interruptTurn ?? (async () => ({ status: "accepted" })),
    ),
    closeChild: note(
      "closeChild",
      options.closeChild ?? (async () => ({ ok: true, value: { closed: true, killedJobs: [] } })),
    ),
  };
  const interactions = {
    canAccess: async (...args: unknown[]) => {
      calls.push({ method: "canAccess", args });
      const target = args[1] as { readonly rootSessionId: string };
      return !(options.deniedRoots ?? []).includes(target.rootSessionId);
    },
  };
  const backend = Option.some({
    identityKind: (sessionId: string) => {
      calls.push({ method: "identityKind", args: [sessionId] });
      return (
        options.sessionKinds?.[sessionId] ?? (sessionId === "pi-child" ? "child" : "not-child")
      );
    },
    interactions: () => (options.noInteractions === true ? undefined : interactions),
    orchestration: () =>
      options.noOrchestration === true
        ? undefined
        : { direct: () => (options.noDirect === true ? undefined : direct) },
    index: {
      lookup: (threadId: string) => {
        calls.push({ method: "lookup", args: [threadId] });
        if ((options.corruptThreads ?? []).includes(threadId))
          return { status: "corrupt", problem: "unreadable" };
        const found = bindings[threadId];
        return found === undefined
          ? { status: "absent" }
          : { status: "ok", binding: { threadId, ...found } };
      },
    },
  });
  return { backend: backend as never, calls };
};
const mutating = (calls: ReadonlyArray<Call>) =>
  calls.filter((call) => ["cancelTree", "interruptTurn", "closeChild"].includes(call.method));

/** The device-session rows: what `auth_sessions` says for the connection's session id. */
type Row = { revokedAt: unknown; expiresAt: DateTime.Utc };
const live = (): Row => ({
  revokedAt: null,
  expiresAt: DateTime.makeUnsafe("2099-01-01T00:00:00.000Z"),
});
const repo = (read: () => Effect.Effect<Option.Option<Row>, unknown>) =>
  Layer.succeed(AuthSessionRepository, { getById: () => read() } as never);
const withDevice = <A, E>(
  effect: Effect.Effect<A, E, AuthSessionRepository>,
  read: () => Effect.Effect<Option.Option<Row>, unknown> = () => Effect.succeedSome(live()),
) => effect.pipe(Effect.provide(repo(read)));
const actorOf = (session: Session = SESSION) => connectionActor(session as never);

describe("a valid Stop is one cancelTree call with the user caller", () => {
  it.effect(
    "asks the host rule about the root, then calls M05 once; the payload cannot supply a caller",
    () =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend();
          const actor = yield* actorOf();
          const reply = yield* childrenCancelTree(fake.backend, actor, {
            rootThreadId: ROOT,
            ...({
              caller: { user: false },
              user: true,
              actor: { clientSessionId: "someone" },
            } as object),
          });
          expect(reply).toEqual({ ok: true, value: CANCEL_VALUE });
          expect(mutating(fake.calls)).toEqual([
            {
              method: "cancelTree",
              args: [{ caller: { user: true }, args: { rootThreadId: ROOT } }],
            },
          ]);
          // The thread's Pi session was read from the index, and the host rule asked about that session as its own root BEFORE the call.
          const order = fake.calls.map((call) => call.method);
          expect(order.indexOf("lookup")).toBeLessThan(order.indexOf("canAccess"));
          expect(order.indexOf("canAccess")).toBeLessThan(order.indexOf("cancelTree"));
          expect(fake.calls.find((call) => call.method === "canAccess")?.args[1]).toEqual({
            sessionId: "pi-root",
            rootSessionId: "pi-root",
          });
          expect(JSON.stringify(fake.calls)).not.toContain("someone");
        }),
      ),
  );

  it.effect("passes M05's partial child failures through unchanged and never claims more", () =>
    withDevice(
      Effect.gen(function* () {
        const value = {
          rootThreadId: ROOT,
          rows: [
            { childId: "a", action: "interrupted" },
            { childId: "b", action: "failed", detail: "the close was not confirmed (X)" },
            {
              childId: "c",
              action: "unavailable",
              detail: "T3 could not report the child's activity",
            },
          ],
          rootStopped: true,
          complete: false,
        };
        const fake = fakeBackend({ cancelTree: async () => ({ ok: true, value }) });
        const reply = yield* childrenCancelTree(fake.backend, yield* actorOf(), {
          rootThreadId: ROOT,
        });
        expect(reply).toEqual({ ok: true, value });
        expect(mutating(fake.calls)).toHaveLength(1);
      }),
    ),
  );

  it.effect(
    "maps M05's refusals: a known code passes through, an unknown code is an unknown outcome",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          const passthrough = fakeBackend({
            cancelTree: async () => ({
              ok: false,
              code: "ORCHESTRATION_UNAVAILABLE",
              detail: "T3's lineage cannot be read",
            }),
          });
          expect(
            yield* childrenCancelTree(passthrough.backend, actor, { rootThreadId: ROOT }),
          ).toEqual({
            ok: false,
            code: "ORCHESTRATION_UNAVAILABLE",
            detail: "T3's lineage cannot be read",
          });
          const odd = fakeBackend({
            cancelTree: async () => ({ ok: false, code: "SOMETHING_NEW" }),
          });
          expect(
            yield* childrenCancelTree(odd.backend, actor, { rootThreadId: ROOT }),
          ).toMatchObject({
            ok: false,
            code: "CHILDREN_OUTCOME_UNKNOWN",
          });
          const garbled = fakeBackend({ cancelTree: async () => "nonsense" });
          expect(
            yield* childrenCancelTree(garbled.backend, actor, { rootThreadId: ROOT }),
          ).toMatchObject({
            ok: false,
            code: "CHILDREN_OUTCOME_UNKNOWN",
          });
        }),
      ),
  );

  it.effect(
    "a lost reply (the call throws) is an unknown outcome and the call is never repeated",
    () =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend({
            cancelTree: async () => {
              throw new Error("socket closed");
            },
          });
          const reply = yield* childrenCancelTree(fake.backend, yield* actorOf(), {
            rootThreadId: ROOT,
          });
          expect(reply).toMatchObject({ ok: false, code: "CHILDREN_OUTCOME_UNKNOWN" });
          expect(mutating(fake.calls)).toHaveLength(1);
          expect(JSON.stringify(reply)).not.toContain("socket closed");
        }),
      ),
  );
});

describe("nothing reaches M05 unless the connection may make the call", () => {
  it.effect(
    "a read-only or unrelated device is refused by scope; the handler re-checks what T3 checked",
    () =>
      withDevice(
        Effect.gen(function* () {
          for (const session of [
            READ_ONLY,
            { sessionId: "device-1", scopes: [AuthTerminalReadScope] },
          ]) {
            const fake = fakeBackend();
            const actor = yield* actorOf(session);
            for (const reply of [
              yield* childrenCancelTree(fake.backend, actor, { rootThreadId: ROOT }),
              yield* childrenInterrupt(fake.backend, actor, {
                rootThreadId: ROOT,
                childThreadId: CHILD,
              }),
              yield* childrenClose(fake.backend, actor, {
                rootThreadId: ROOT,
                childThreadId: CHILD,
              }),
            ])
              expect(reply).toMatchObject({ ok: false, code: "CHILDREN_NOT_AUTHORIZED" });
            expect(fake.calls).toEqual([]);
          }
          const fake = fakeBackend();
          const listed = yield* childrenList(fake.backend, yield* actorOf(OPERATE_ONLY), {
            rootThreadId: ROOT,
          });
          expect(listed).toMatchObject({ ok: false, code: "CHILDREN_NOT_AUTHORIZED" });
          expect(fake.calls).toEqual([]);
        }),
      ),
  );

  it.effect("a revoked, missing or expired device session is refused before anything else", () =>
    Effect.gen(function* () {
      const cases: Array<[string, () => Effect.Effect<Option.Option<Row>, unknown>]> = [
        [
          "revoked",
          () =>
            Effect.succeedSome({
              ...live(),
              revokedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
            }),
        ],
        ["missing", () => Effect.succeedNone],
        [
          "expired",
          // `it.effect` runs on the test clock, which starts at 0: an expiry at 0 is not after "now".
          () => Effect.succeedSome({ revokedAt: null, expiresAt: DateTime.makeUnsafe(0) }),
        ],
      ];
      for (const [label, read] of cases) {
        const fake = fakeBackend();
        yield* withDevice(
          Effect.gen(function* () {
            const actor = yield* actorOf();
            const replies = [
              yield* childrenCancelTree(fake.backend, actor, { rootThreadId: ROOT }),
              yield* childrenInterrupt(fake.backend, actor, {
                rootThreadId: ROOT,
                childThreadId: CHILD,
              }),
              yield* childrenClose(fake.backend, actor, {
                rootThreadId: ROOT,
                childThreadId: CHILD,
              }),
              yield* childrenList(fake.backend, actor, { rootThreadId: ROOT }),
            ];
            for (const reply of replies)
              expect(reply, label).toMatchObject({ ok: false, code: "CHILDREN_DEVICE_REVOKED" });
          }),
          read,
        );
        expect(fake.calls, label).toEqual([]);
      }
    }),
  );

  it.effect("a device session that cannot be read is unavailable, never a pass", () => {
    const fake = fakeBackend();
    return withDevice(
      Effect.gen(function* () {
        const actor = yield* actorOf();
        expect(
          yield* childrenCancelTree(fake.backend, actor, { rootThreadId: ROOT }),
        ).toMatchObject({
          ok: false,
          code: "CHILDREN_UNAVAILABLE",
        });
        expect(fake.calls).toEqual([]);
      }),
      () => Effect.fail({ _tag: "RepositoryUnreadable" as const }),
    );
  });

  it.effect(
    "a wrong root reaches nothing: unknown thread, a subagent named as a root, a root the host rule refuses",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          for (const [label, root, options] of [
            ["unknown thread", "thread-nobody", {}],
            ["child as root", CHILD, {}],
            ["denied by the host rule", OTHER_ROOT, { deniedRoots: ["pi-other"] }],
          ] as const) {
            const fake = fakeBackend(options);
            expect(
              yield* childrenCancelTree(fake.backend, actor, { rootThreadId: root }),
              label,
            ).toMatchObject({
              ok: false,
              code: "CHILDREN_NOT_FOUND",
            });
            expect(mutating(fake.calls), label).toEqual([]);
          }
          const corrupt = fakeBackend({ corruptThreads: [ROOT] });
          expect(
            yield* childrenCancelTree(corrupt.backend, actor, { rootThreadId: ROOT }),
          ).toMatchObject({
            ok: false,
            code: "CHILDREN_UNAVAILABLE",
          });
          expect(mutating(corrupt.calls)).toEqual([]);
        }),
      ),
  );

  // M10 native slice finding: every M05 child binding in the thread index carries `subagent: null` (the index never learns it), so the `subagent === true` refusal alone let a child be named
  // as a root and Stopped as one. The child's own identity record (kind "child", M03) is the proof, read through the Backend.
  it.effect(
    "a child named as a root is refused in every method although the index says subagent null; nothing reaches M05",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          const bindings = { [CHILD]: { sessionId: "pi-child", subagent: null } };
          const calls = [
            (b: never) => childrenCancelTree(b, actor, { rootThreadId: CHILD }),
            (b: never) => childrenList(b, actor, { rootThreadId: CHILD }),
            (b: never) =>
              childrenInterrupt(b, actor, { rootThreadId: CHILD, childThreadId: "thread-x" }),
            (b: never) =>
              childrenClose(b, actor, { rootThreadId: CHILD, childThreadId: "thread-x" }),
          ];
          for (const call of calls) {
            const fake = fakeBackend({ bindings });
            expect(yield* call(fake.backend)).toMatchObject({
              ok: false,
              code: "CHILDREN_NOT_FOUND",
            });
            expect(
              fake.calls.filter((c) =>
                ["cancelTree", "listChildren", "interruptTurn", "closeChild", "canAccess"].includes(
                  c.method,
                ),
              ),
            ).toEqual([]);
          }
          // A main thread (identity kind main) is still a root.
          const main = fakeBackend({
            bindings: { [ROOT]: { sessionId: "pi-root", subagent: null } },
          });
          expect(
            yield* childrenCancelTree(main.backend, actor, { rootThreadId: ROOT }),
          ).toMatchObject({ ok: true });
        }),
      ),
  );

  it.effect(
    "a root whose identity record cannot be read is not stopped or listed: unavailable, nothing reaches M05",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          const fake = fakeBackend({ sessionKinds: { "pi-root": "unavailable" } });
          expect(
            yield* childrenCancelTree(fake.backend, actor, { rootThreadId: ROOT }),
          ).toMatchObject({ ok: false, code: "CHILDREN_UNAVAILABLE" });
          expect(yield* childrenList(fake.backend, actor, { rootThreadId: ROOT })).toMatchObject({
            ok: false,
            code: "CHILDREN_UNAVAILABLE",
          });
          expect(
            fake.calls.filter((c) =>
              ["cancelTree", "listChildren", "canAccess"].includes(c.method),
            ),
          ).toEqual([]);
          // A record that is absent or retired does not prove a child: the root goes on to the host rule and M05, as before.
          const absent = fakeBackend({ sessionKinds: { "pi-root": "not-child" } });
          expect(
            yield* childrenCancelTree(absent.backend, actor, { rootThreadId: ROOT }),
          ).toMatchObject({ ok: true });
        }),
      ),
  );

  it.effect(
    "a stopped Backend, no children service, or no direct API answers unavailable and cancels nothing",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          for (const options of [
            { noOrchestration: true },
            { noDirect: true },
            { noInteractions: true },
          ]) {
            const fake = fakeBackend(options);
            expect(
              yield* childrenCancelTree(fake.backend, actor, { rootThreadId: ROOT }),
            ).toMatchObject({
              ok: false,
              code: "CHILDREN_UNAVAILABLE",
            });
            expect(mutating(fake.calls)).toEqual([]);
          }
          expect(
            yield* childrenCancelTree(Option.none(), actor, { rootThreadId: ROOT }),
          ).toMatchObject({
            ok: false,
            code: "CHILDREN_UNAVAILABLE",
          });
        }),
      ),
  );
});

describe("per-child Stop: interrupt for a continuable child, close for a one-shot, only inside the named root", () => {
  it.effect(
    "interrupt checks the child is listed under the root, then calls interruptTurn with module authority for the child's Pi session",
    () =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend();
          const reply = yield* childrenInterrupt(fake.backend, yield* actorOf(), {
            rootThreadId: ROOT,
            childThreadId: CHILD,
          });
          expect(reply).toEqual({ ok: true, value: { accepted: true } });
          expect(fake.calls.find((call) => call.method === "listChildren")?.args[0]).toEqual({
            caller: { user: true },
            args: { scope: "descendants", rootThreadId: ROOT },
          });
          const [interrupt] = mutating(fake.calls);
          expect(interrupt?.method).toBe("interruptTurn");
          expect(interrupt?.args[0]).toMatchObject({
            authority: { kind: "backend-module" },
            sessionId: "pi-child",
          });
          expect(mutating(fake.calls)).toHaveLength(1);
        }),
      ),
  );

  it.effect(
    "close calls M05's closeChild with the user caller and returns its report and killed jobs",
    () =>
      withDevice(
        Effect.gen(function* () {
          const closed = {
            closed: true,
            killedJobs: ["job-1"],
            report: { status: "interrupted", text: "stopped", route: 1 },
          };
          const fake = fakeBackend({ closeChild: async () => ({ ok: true, value: closed }) });
          const reply = yield* childrenClose(fake.backend, yield* actorOf(), {
            rootThreadId: ROOT,
            childThreadId: "thread-oneshot",
          });
          expect(reply).toEqual({ ok: true, value: closed });
          expect(mutating(fake.calls)).toEqual([
            {
              method: "closeChild",
              args: [{ caller: { user: true }, args: { target: "thread-oneshot" } }],
            },
          ]);
        }),
      ),
  );

  it.effect(
    "a child that is not listed under the named root is not found, and a list that cannot be read is unavailable",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          const other = fakeBackend();
          for (const act of [childrenInterrupt, childrenClose])
            expect(
              yield* act(other.backend, actor, {
                rootThreadId: ROOT,
                childThreadId: "thread-of-another-root",
              }),
            ).toMatchObject({ ok: false, code: "CHILDREN_NOT_FOUND" });
          expect(mutating(other.calls)).toEqual([]);

          const unreadable = fakeBackend({
            list: async () => ({ ok: false, code: "ORCHESTRATION_UNAVAILABLE" }),
          });
          for (const act of [childrenInterrupt, childrenClose])
            expect(
              yield* act(unreadable.backend, actor, { rootThreadId: ROOT, childThreadId: CHILD }),
            ).toMatchObject({ ok: false, code: "CHILDREN_UNAVAILABLE" });
          expect(mutating(unreadable.calls)).toEqual([]);

          const wrongRoot = fakeBackend({ deniedRoots: ["pi-other"] });
          expect(
            yield* childrenClose(wrongRoot.backend, actor, {
              rootThreadId: OTHER_ROOT,
              childThreadId: CHILD,
            }),
          ).toMatchObject({ ok: false, code: "CHILDREN_NOT_FOUND" });
          expect(wrongRoot.calls.some((call) => call.method === "listChildren")).toBe(false);
        }),
      ),
  );

  it.effect(
    "a refused, unavailable or thrown interrupt or close is never reported as done, and is not retried",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          const unavailable = fakeBackend({
            interruptTurn: async () => ({
              status: "unavailable",
              detail: "T3 did not take the interrupt",
            }),
          });
          expect(
            yield* childrenInterrupt(unavailable.backend, actor, {
              rootThreadId: ROOT,
              childThreadId: CHILD,
            }),
          ).toEqual({
            ok: false,
            code: "ORCHESTRATION_UNAVAILABLE",
            detail: "T3 did not take the interrupt",
          });
          const refused = fakeBackend({
            interruptTurn: async () => ({ status: "refused", reason: "unauthorized" }),
          });
          expect(
            yield* childrenInterrupt(refused.backend, actor, {
              rootThreadId: ROOT,
              childThreadId: CHILD,
            }),
          ).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
          const thrown = fakeBackend({
            closeChild: async () => {
              throw new Error("boom");
            },
          });
          expect(
            yield* childrenClose(thrown.backend, actor, {
              rootThreadId: ROOT,
              childThreadId: CHILD,
            }),
          ).toMatchObject({ ok: false, code: "CHILDREN_OUTCOME_UNKNOWN" });
          expect(mutating(thrown.calls)).toHaveLength(1);
          const noSession = fakeBackend({
            bindings: {
              [ROOT]: { sessionId: "pi-root", subagent: false },
            },
            list: async () => ({
              ok: true,
              value: { rows: [ROW(CHILD, "continuable")], diagnostics: [] },
            }),
          });
          expect(
            yield* childrenInterrupt(noSession.backend, actor, {
              rootThreadId: ROOT,
              childThreadId: CHILD,
            }),
          ).toMatchObject({ ok: false, code: "CHILDREN_UNAVAILABLE" });
          expect(mutating(noSession.calls)).toEqual([]);
        }),
      ),
  );

  it.effect("list is a read: it asks the host rule, then M05's user list for the named root", () =>
    withDevice(
      Effect.gen(function* () {
        const fake = fakeBackend();
        const reply = yield* childrenList(fake.backend, yield* actorOf(READ_ONLY), {
          rootThreadId: ROOT,
        });
        expect(reply).toMatchObject({ ok: true, value: { diagnostics: [] } });
        expect(fake.calls.find((call) => call.method === "listChildren")?.args[0]).toEqual({
          caller: { user: true },
          args: { scope: "descendants", rootThreadId: ROOT },
        });
        expect(mutating(fake.calls)).toEqual([]);
      }),
    ),
  );
});
