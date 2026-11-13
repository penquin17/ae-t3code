// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 23 (D17, R3, XC-7, XC-19; IP-58 to IP-60) — the handlers behind `aetheria.regions.report` and `aetheria.regions.read`, and the wrap that observes T3's `subscribeThread`.
//
// Boundary: `regionsRpc.ts` over the REAL region state (`regionsState.ts`, injected clock) and the REAL per-call device check (a fake `auth_sessions` row store), with T3's real `WsRpcGroup` and scope
// middleware for the scope row. The viewed thread is observed from a REAL Effect stream the test runs, ends, fails and interrupts; T3's own `subscribeThread` handler is not run here (its wrap is checked in
// the source of ws.ts and exercised by the native driver).
// It shows: the device session is re-read on EVERY call and a revoked one is refused AND its client dropped, a missing scope is refused, a device session that cannot be read is unavailable and changes
// nothing; the reply is the contract's own shape; a forged principal, session or viewing field is not read; a connection reads only its own client; the connection's finalizer drops the client on disconnect;
// the observed viewed thread appears while a subscription runs and is released when it ends, fails or is interrupted; and the three T3 files carry the marked rows and hunks.
// It does NOT show a live T3 server or a browser reporter.
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthTerminalReadScope,
  WsRpcGroup,
} from "@t3tools/contracts";
import {
  AETHERIA_WS_METHODS,
  RegionsReadResult,
  RegionsReportResult,
  type RegionDescriptor,
} from "@t3tools/aetheria-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";
import * as RpcTest from "effect/rpc/RpcTest";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import { RPC_REQUIRED_SCOPES, requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import { AuthSessionRepository } from "../persistence/AuthSessions.ts";
import { connectionActor } from "./humanControlRpc.ts";
import {
  observeViewing,
  openRegionConnection,
  openRegionConnectionIn,
  regionsRead,
  regionsReport,
} from "./regionsRpc.ts";
import {
  createRegionRegistry,
  type RegionConnection,
  type RegionRegistry,
} from "./regionsState.ts";

const M = AETHERIA_WS_METHODS;
type Session = { sessionId: string; scopes: ReadonlyArray<string> };
const SESSION: Session = { sessionId: "device-1", scopes: [AuthOrchestrationReadScope] };
const OPERATE_ONLY: Session = { sessionId: "device-1", scopes: [AuthOrchestrationOperateScope] };
const SUBJECT = "alice";
const CLIENT = "client-alice-000000001";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const source = (relative: string) => NodeFS.readFileSync(NodePath.join(here, relative), "utf8");

const decodeReport = Schema.decodeUnknownSync(RegionsReportResult as never, {
  onExcessProperty: "error",
}) as (input: unknown) => RegionsReportResult;
const decodeRead = Schema.decodeUnknownSync(RegionsReadResult as never, {
  onExcessProperty: "error",
}) as (input: unknown) => RegionsReadResult;

const descriptor = (id: string): RegionDescriptor => ({
  id,
  kind: "region",
  owner: "aetheria-ui",
  parent: null,
  description: `The ${id} region`,
  schemaVersion: 1,
  props: [],
  state: [{ name: "phase", type: "string", report: "value" }],
  tokens: [],
});
const payload = (sequence: number, ...ids: string[]) => ({
  clientId: CLIENT,
  sequence,
  regions: ids.map((id) => ({ descriptor: descriptor(id), visible: true })),
});

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

let clock = 1_000_000;
const registryOf = (): RegionRegistry => {
  let n = 0;
  return createRegionRegistry({ now: () => clock, newId: () => `conn-${(n += 1)}` });
};
const open = (registry: RegionRegistry, subject = SUBJECT, device = "device-1") =>
  registry.openConnection({ subject, deviceSessionId: device });

describe("the two methods are in T3's group with the read scope (IP-58)", () => {
  it("joins WsRpcGroup and the scope map exhaustively, both as reads", () => {
    for (const tag of [M.regionsReport, M.regionsRead]) {
      expect(WsRpcGroup.requests.has(tag)).toBe(true);
      expect(requiredScopeForRpcMethod(tag)).toBe(AuthOrchestrationReadScope);
    }
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(WsRpcGroup.requests.keys()));
  });

  it.effect("refuses a token without the scope before any handler runs", () =>
    Effect.gen(function* () {
      for (const [tag, input] of [
        [M.regionsReport, payload(1)],
        [M.regionsRead, {}],
      ] as const) {
        const group = WsRpcGroup.omit(
          ...([...WsRpcGroup.requests.keys()].filter((other) => other !== tag) as never[]),
        );
        for (const scopes of [[], [AuthTerminalReadScope], [AuthOrchestrationOperateScope]]) {
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
          const refused = yield* client[tag]!(input).pipe(Effect.flip);
          expect(refused).toMatchObject({
            _tag: "EnvironmentAuthorizationError",
            requiredPermission: AuthOrchestrationReadScope,
          });
          expect(handled).toEqual([]);
        }
      }
    }).pipe(Effect.scoped),
  );
});

/**
 * The wire. `RpcTest.makeClient` passes the payload through unserialized, so it never runs the server's decode. These cases serve the REAL `WsRpcGroup` `aetheria.regions.report` request over `RpcServer.toHttpEffect` with JSON
 * serialization: the server decodes the payload from bytes with the parse options the Rpc carries, then hands it to the REAL `regionsReport` handler over the real region state. They show what a client
 * is told when it sends a report with a field the contract does not declare; they do not show T3's websocket transport (the same decode, a different protocol) or the native client (slice-2 `regions-round-trip`).
 */
describe("a report with a field the contract does not declare is refused at the wire decode (M10 slice-2 finding)", () => {
  /** One region request (the report unless a tag is given) over the real server decode: the replies the server wrote, and every payload the handler received. */
  const callOverWire = (wirePayload: unknown, tag: string = M.regionsReport) =>
    Effect.gen(function* () {
      const registry = registryOf();
      const connection = open(registry);
      const actor = yield* actorOf();
      const handled: Array<unknown> = [];
      const group = WsRpcGroup.omit(
        ...([...WsRpcGroup.requests.keys()].filter((other) => other !== tag) as never[]),
      );
      const loose = group as unknown as {
        toLayerHandler: (t: string, h: (p: unknown) => unknown) => Layer.Layer<never>;
      };
      const toHttpEffect = RpcServer.toHttpEffect as unknown as (
        g: unknown,
      ) => Effect.Effect<
        Effect.Effect<
          HttpServerResponse.HttpServerResponse,
          never,
          Scope.Scope | HttpServerRequest.HttpServerRequest
        >,
        never,
        Scope.Scope | RpcSerialization.RpcSerialization
      >;
      const handlers = loose.toLayerHandler(tag, (received) => {
        handled.push(received);
        // The handler runs inside the server's own fibre, which does not inherit the test's services: it is given the device-session store itself.
        const handler = (tag === M.regionsRead ? regionsRead : regionsReport) as (
          connection: RegionConnection,
          actor: Parameters<typeof regionsReport>[1],
          payload: never,
        ) => Effect.Effect<unknown, unknown, AuthSessionRepository>;
        return handler(connection, actor, received as never).pipe(
          Effect.provide(repo(() => Effect.succeedSome(live()))),
        );
      });
      const http = yield* toHttpEffect(group).pipe(
        Effect.provide(
          Layer.mergeAll(
            handlers,
            RpcSerialization.layerJson,
            RpcAuthorization.layer([AuthOrchestrationReadScope] as never),
          ),
        ),
      );
      const request = HttpServerRequest.fromWeb(
        new Request("http://localhost/rpc", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            _tag: "Request",
            id: "1",
            tag,
            payload: wirePayload,
            headers: [],
          }),
        }),
      );
      const response = yield* http.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      );
      const replies = JSON.parse(
        yield* Effect.promise(() => HttpServerResponse.toWeb(response).text()),
      ) as ReadonlyArray<{
        _tag: string;
        exit?: { _tag: string; value?: unknown; cause?: unknown };
      }>;
      return { replies, handled, registry };
    }).pipe(Effect.scoped, (effect) => withDevice(effect as never)) as Effect.Effect<{
      replies: ReadonlyArray<{
        _tag: string;
        exit?: { _tag: string; value?: unknown; cause?: unknown };
      }>;
      handled: Array<unknown>;
      registry: RegionRegistry;
    }>;

  it.effect(
    "accepts a valid report: the handler runs and the reply is the contract's success",
    () =>
      Effect.gen(function* () {
        const { replies, handled, registry } = yield* callOverWire(payload(1, "shell"));
        expect(handled).toHaveLength(1);
        expect(replies[0]).toMatchObject({
          _tag: "Exit",
          exit: { _tag: "Success", value: { ok: true, value: { sequence: 1 } } },
        });
        expect(registry.clientsFor({ subject: SUBJECT })).toHaveLength(1);
      }),
  );

  it.effect(
    "refuses a report carrying a principal, a viewing and a value: the handler never runs and nothing is stored",
    () =>
      Effect.gen(function* () {
        const forged = {
          ...payload(1, "shell"),
          principal: { subject: "bob" },
          viewing: ["forged-thread"],
          value: "forged-value",
        };
        const { replies, handled, registry } = yield* callOverWire(forged);
        expect(handled).toEqual([]);
        expect(registry.clientsFor({ subject: SUBJECT })).toEqual([]);
        expect(registry.clientsFor({ subject: "bob" })).toEqual([]);
        expect(replies).toHaveLength(1);
        // What the client receives: an RPC exit that is a failure naming the first key the contract does not declare, never a success carrying a REGIONS_* reply. The refusal is not a coded value (the decode runs before the handler).
        expect(replies[0]).toMatchObject({
          _tag: "Exit",
          exit: {
            _tag: "Failure",
            cause: [
              { _tag: "Die", defect: expect.stringContaining("Expected no excess property") },
            ],
          },
        });
        expect(JSON.stringify(replies[0])).not.toMatch(/forged-thread|forged-value|REGIONS_/);
      }),
  );

  it.effect("refuses an unknown key inside a region entry and inside a descriptor", () =>
    Effect.gen(function* () {
      const base = payload(1, "shell");
      const inEntry = {
        ...base,
        regions: [{ ...base.regions[0]!, value: "forged-value" }],
      };
      const inDescriptor = {
        ...base,
        regions: [
          { ...base.regions[0]!, descriptor: { ...base.regions[0]!.descriptor, principal: "bob" } },
        ],
      };
      for (const forged of [inEntry, inDescriptor]) {
        const { replies, handled } = yield* callOverWire(forged);
        expect(handled).toEqual([]);
        expect(replies[0]).toMatchObject({ _tag: "Exit", exit: { _tag: "Failure" } });
      }
    }),
  );

  // Review 2 finding F5: the read's payload is empty, and an empty struct passes an unknown key through whole, so the option alone refused nothing there.
  it.effect("accepts an empty read: the handler runs and the reply is the contract's success", () =>
    Effect.gen(function* () {
      const { replies, handled } = yield* callOverWire({}, M.regionsRead);
      expect(handled).toEqual([{}]);
      expect(replies[0]).toMatchObject({
        _tag: "Exit",
        exit: { _tag: "Success", value: { ok: true, value: { client: null } } },
      });
    }),
  );

  it.effect("refuses a read that carries any key at all: the handler never runs", () =>
    Effect.gen(function* () {
      for (const forged of [
        { principal: { subject: "bob" } },
        { clientId: "client-bob-0000000001" },
        { viewing: ["forged-thread"] },
        { value: "forged-value" },
      ]) {
        const { replies, handled } = yield* callOverWire(forged, M.regionsRead);
        expect(handled).toEqual([]);
        expect(replies).toHaveLength(1);
        expect(replies[0]).toMatchObject({ _tag: "Exit", exit: { _tag: "Failure" } });
        expect(JSON.stringify(replies[0])).not.toMatch(/forged-thread|forged-value|client-bob/);
      }
    }),
  );
});

describe("a report is bound to the connection and checked on every call", () => {
  it.effect(
    "stores the regions under the connection's principal and answers in the contract's shape",
    () =>
      withDevice(
        Effect.gen(function* () {
          const registry = registryOf();
          const connection = open(registry);
          connection.observeViewing("thread-1");
          const reply = yield* regionsReport(
            connection,
            yield* actorOf(),
            payload(1, "shell", "composer") as never,
          );
          expect(decodeReport(reply)).toEqual({
            ok: true,
            value: {
              clientId: CLIENT,
              sequence: 1,
              regions: [
                { id: "shell", visible: true },
                { id: "composer", visible: true },
              ],
              viewing: ["thread-1"],
            },
          });
          expect(registry.clientsFor({ subject: SUBJECT })[0]!.principal).toEqual({
            subject: SUBJECT,
            deviceSessionId: "device-1",
          });
        }),
      ),
  );

  it.effect("reads no principal, session or viewing from the payload", () =>
    withDevice(
      Effect.gen(function* () {
        const registry = registryOf();
        const connection = open(registry);
        const forged = {
          ...payload(1, "shell"),
          principal: { subject: "bob" },
          subject: "bob",
          sessionId: "forged-session",
          viewing: ["forged-thread"],
          threadId: "forged-thread",
        };
        const reply = yield* regionsReport(connection, yield* actorOf(), forged as never);
        expect(reply).toMatchObject({ ok: true, value: { viewing: [] } });
        const stored = JSON.stringify(registry.clientsFor({ subject: SUBJECT }));
        expect(stored).not.toContain("forged");
        expect(registry.clientsFor({ subject: "bob" })).toEqual([]);
      }),
    ),
  );

  it.effect(
    "re-reads the device session on every call: a revocation between two calls refuses the second and drops the client",
    () => {
      let reads = 0;
      let revoked = false;
      return withDevice(
        Effect.gen(function* () {
          const registry = registryOf();
          const connection = open(registry);
          const actor = yield* actorOf();
          expect(
            yield* regionsReport(connection, actor, payload(1, "shell") as never),
          ).toMatchObject({
            ok: true,
          });
          const afterFirst = reads;
          expect(afterFirst).toBeGreaterThanOrEqual(1);
          expect(registry.clientsFor({ subject: SUBJECT })).toHaveLength(1);
          revoked = true;
          expect(
            yield* regionsReport(connection, actor, payload(2, "shell") as never),
          ).toMatchObject({
            ok: false,
            code: "REGIONS_DEVICE_REVOKED",
          });
          expect(reads).toBeGreaterThan(afterFirst);
          expect(registry.clientsFor({ subject: SUBJECT })).toEqual([]);
          expect(yield* regionsRead(connection, actor, {})).toMatchObject({
            ok: false,
            code: "REGIONS_DEVICE_REVOKED",
          });
        }),
        () => {
          reads += 1;
          return Effect.succeedSome(
            revoked
              ? { ...live(), revokedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z") }
              : live(),
          );
        },
      );
    },
  );

  it.effect("refuses a missing or expired device session the same way", () =>
    Effect.gen(function* () {
      for (const read of [
        () => Effect.succeedNone,
        () => Effect.succeedSome({ revokedAt: null, expiresAt: DateTime.makeUnsafe(0) }),
      ] as const)
        yield* withDevice(
          Effect.gen(function* () {
            const registry = registryOf();
            const connection = open(registry);
            expect(
              yield* regionsReport(connection, yield* actorOf(), payload(1, "shell") as never),
            ).toMatchObject({ ok: false, code: "REGIONS_DEVICE_REVOKED" });
            expect(registry.clientsFor({ subject: SUBJECT })).toEqual([]);
          }),
          read as never,
        );
    }),
  );

  it.effect("answers unavailable, changing nothing, when the device session cannot be read", () =>
    withDevice(
      Effect.gen(function* () {
        const registry = registryOf();
        const connection = open(registry);
        expect(
          yield* regionsReport(connection, yield* actorOf(), payload(1, "shell") as never),
        ).toMatchObject({ ok: false, code: "REGIONS_UNAVAILABLE" });
        expect(registry.clientsFor({ subject: SUBJECT })).toEqual([]);
      }),
      () => Effect.fail({ _tag: "RepositoryUnreadable" as const }),
    ),
  );

  it.effect("refuses a connection without the read scope, changing nothing", () =>
    withDevice(
      Effect.gen(function* () {
        const registry = registryOf();
        const connection = open(registry);
        const actor = yield* actorOf(OPERATE_ONLY);
        expect(yield* regionsReport(connection, actor, payload(1, "shell") as never)).toMatchObject(
          {
            ok: false,
            code: "REGIONS_NOT_AUTHORIZED",
          },
        );
        expect(yield* regionsRead(connection, actor, {})).toMatchObject({
          ok: false,
          code: "REGIONS_NOT_AUTHORIZED",
        });
        expect(registry.clientsFor({ subject: SUBJECT })).toEqual([]);
      }),
    ),
  );

  it.effect(
    "passes the state's refusals through as coded values: stale, foreign client id, rate",
    () =>
      withDevice(
        Effect.gen(function* () {
          const registry = registryOf();
          const connection = open(registry);
          const actor = yield* actorOf();
          yield* regionsReport(connection, actor, payload(2, "shell") as never);
          expect(
            yield* regionsReport(connection, actor, payload(2, "evil") as never),
          ).toMatchObject({
            ok: false,
            code: "REGIONS_STALE",
          });
          const intruder = open(registry, "bob", "device-9");
          expect(yield* regionsReport(intruder, actor, payload(9, "evil") as never)).toMatchObject({
            ok: false,
            code: "REGIONS_CLIENT_CONFLICT",
          });
          for (let i = 3; i < 40; i += 1)
            yield* regionsReport(connection, actor, payload(i, "shell") as never);
          expect(
            yield* regionsReport(connection, actor, payload(99, "shell") as never),
          ).toMatchObject({
            ok: false,
            code: "REGIONS_RATE_LIMITED",
          });
          expect(registry.clientsFor({ subject: "bob" })).toEqual([]);
        }),
      ),
  );
});

describe("a connection reads only its own client", () => {
  it.effect(
    "returns its stored client, with kind and owner, or a known none; another connection's never",
    () =>
      withDevice(
        Effect.gen(function* () {
          const registry = registryOf();
          const mine = open(registry);
          const theirs = open(registry, "bob", "device-2");
          const actor = yield* actorOf();
          expect(decodeRead(yield* regionsRead(mine, actor, {}))).toEqual({
            ok: true,
            value: { client: null },
          });
          yield* regionsReport(mine, actor, payload(1, "shell") as never);
          const reply = decodeRead(yield* regionsRead(mine, actor, {}));
          expect(reply).toMatchObject({
            ok: true,
            value: {
              client: {
                clientId: CLIENT,
                sequence: 1,
                regions: [
                  {
                    id: "shell",
                    kind: "region",
                    owner: "aetheria-ui",
                    parent: null,
                    schemaVersion: 1,
                    visible: true,
                  },
                ],
                viewing: [],
              },
            },
          });
          expect(decodeRead(yield* regionsRead(theirs, actor, {}))).toEqual({
            ok: true,
            value: { client: null },
          });
        }),
      ),
  );
});

describe("the connection's lifetime", () => {
  it.effect(
    "opens a connection bound to the actor's device session and the subject, and drops its client when the scope closes",
    () =>
      withDevice(
        Effect.gen(function* () {
          const registry = registryOf();
          const actor = yield* actorOf();
          yield* Effect.scoped(
            Effect.gen(function* () {
              const connection = yield* openRegionConnection(actor, SUBJECT, registry);
              yield* regionsReport(connection, actor, payload(1, "shell") as never);
              expect(registry.clientsFor({ subject: SUBJECT })[0]!.principal).toEqual({
                subject: SUBJECT,
                deviceSessionId: "device-1",
              });
            }),
          );
          expect(registry.clientsFor({ subject: SUBJECT })).toEqual([]);
          expect(registry.stats()).toEqual({ connections: 0, clients: 0 });
        }),
      ),
  );
});

/**
 * M10 slice-2 defect (`regions-round-trip`, native run m10-slice2-g): every report and read answered REGIONS_UNAVAILABLE "the region registry is not running". Root cause: ws.ts builds each connection's handlers
 * with `Effect.provide(layerWsRpc(...))` on an effect that RETURNS the handlers while the RPC server is forked in the request's own scope. `Effect.provide(layer)` builds the layer in a scope of its own and closes it
 * when that effect completes (effect/internal/layer.ts `provideLayer` is `scopedWith`), i.e. right after the build and before the first call. A handle opened with `acquireRelease` inside that layer was therefore
 * closed at once. These cases use that exact shape: a layer opens the handle, an effect returns it out of `Effect.provide`, and the call is made afterwards.
 */
describe("the connection handle lives as long as the connection, not as long as the handlers' layer build (M10 slice-2 defect)", () => {
  const Handle = Context.Service<RegionConnection>("test/RegionConnectionHandle");
  /** The handle as the handlers receive it: built by a layer, returned out of `Effect.provide`, used after, in the request's scope. */
  const afterBuild = (
    layerOf: (requestScope: Scope.Scope) => Layer.Layer<RegionConnection>,
  ): Effect.Effect<RegionConnection, never, Scope.Scope> =>
    Effect.gen(function* () {
      const requestScope = yield* Scope.Scope;
      return yield* Effect.service(Handle).pipe(Effect.provide(layerOf(requestScope)));
    });

  it.effect(
    "a handle opened in the layer's own scope is closed once the layer is built (the defect, pinned)",
    () =>
      withDevice(
        Effect.gen(function* () {
          const registry = registryOf();
          const actor = yield* actorOf();
          yield* Effect.scoped(
            Effect.gen(function* () {
              const connection = yield* afterBuild(() =>
                Layer.effect(Handle)(openRegionConnection(actor, SUBJECT, registry)),
              );
              const result = yield* regionsReport(connection, actor, payload(1, "shell") as never);
              expect(result).toMatchObject({ ok: false, code: "REGIONS_UNAVAILABLE" });
            }),
          );
        }),
      ),
  );

  it.effect(
    "a handle bound to the request's scope answers after the build and is dropped when that scope closes",
    () =>
      withDevice(
        Effect.gen(function* () {
          const registry = registryOf();
          const actor = yield* actorOf();
          yield* Effect.scoped(
            Effect.gen(function* () {
              const connection = yield* afterBuild((requestScope) =>
                Layer.effect(Handle)(
                  openRegionConnectionIn(requestScope, actor, SUBJECT, registry),
                ),
              );
              const reported = decodeReport(
                yield* regionsReport(connection, actor, payload(1, "shell") as never),
              );
              expect(reported.ok).toBe(true);
              const read = decodeRead(yield* regionsRead(connection, actor, {} as never));
              expect(read).toMatchObject({ ok: true, value: { client: { clientId: CLIENT } } });
              expect(registry.stats()).toEqual({ connections: 1, clients: 1 });
            }),
          );
          // the request's scope closed (the socket ended): the client is gone with the connection
          expect(registry.stats()).toEqual({ connections: 0, clients: 0 });
        }),
      ),
  );
});

describe("the viewed thread is observed from the connection's own subscription", () => {
  const viewingOf = (registry: RegionRegistry) =>
    registry.clientsFor({ subject: SUBJECT })[0]?.viewing;

  it.effect(
    "shows the thread while the subscription runs and releases it when the stream ends, leaving its elements untouched",
    () =>
      Effect.gen(function* () {
        const registry = registryOf();
        const connection = open(registry);
        connection.report({ clientId: CLIENT, sequence: 1, regions: [] });
        const seen: Array<ReadonlyArray<string> | undefined> = [];
        const wrapped = observeViewing(
          connection,
          "thread-1",
          Stream.fromIterable([1, 2, 3]).pipe(
            Stream.tap(() => Effect.sync(() => seen.push(viewingOf(registry)))),
          ),
        );
        expect(viewingOf(registry)).toEqual([]);
        const items = yield* Stream.runCollect(wrapped);
        expect([...items]).toEqual([1, 2, 3]);
        expect(seen).toEqual([["thread-1"], ["thread-1"], ["thread-1"]]);
        expect(viewingOf(registry)).toEqual([]);
      }),
  );

  it.effect("releases it when the stream fails", () =>
    Effect.gen(function* () {
      const registry = registryOf();
      const connection = open(registry);
      connection.report({ clientId: CLIENT, sequence: 1, regions: [] });
      const exit = yield* Effect.exit(
        Stream.runDrain(observeViewing(connection, "thread-1", Stream.fail("boom"))),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(viewingOf(registry)).toEqual([]);
    }),
  );

  it.effect("releases it when the subscription is interrupted, as on a disconnect", () =>
    Effect.gen(function* () {
      const registry = registryOf();
      const connection = open(registry);
      connection.report({ clientId: CLIENT, sequence: 1, regions: [] });
      const fiber = yield* Effect.forkChild(
        Stream.runDrain(observeViewing(connection, "thread-1", Stream.never)),
      );
      yield* Effect.yieldNow;
      expect(viewingOf(registry)).toEqual(["thread-1"]);
      yield* Fiber.interrupt(fiber);
      expect(viewingOf(registry)).toEqual([]);
    }),
  );

  it.effect("holds a thread viewed through two overlapping subscriptions until the last ends", () =>
    Effect.gen(function* () {
      const registry = registryOf();
      const connection = open(registry);
      connection.report({ clientId: CLIENT, sequence: 1, regions: [] });
      const a = yield* Effect.forkChild(
        Stream.runDrain(observeViewing(connection, "thread-1", Stream.never)),
      );
      const b = yield* Effect.forkChild(
        Stream.runDrain(observeViewing(connection, "thread-1", Stream.never)),
      );
      yield* Effect.yieldNow;
      expect(viewingOf(registry)).toEqual(["thread-1"]);
      yield* Fiber.interrupt(a);
      expect(viewingOf(registry)).toEqual(["thread-1"]);
      yield* Fiber.interrupt(b);
      expect(viewingOf(registry)).toEqual([]);
    }),
  );
});

describe("the seams are marked and wired in the T3 files (IP-58, IP-59, IP-60)", () => {
  // Built from two parts so this test file is not itself read as an integration-point marker.
  const marker = (id: string) => ["AETHERIA-IP", id].join(":");
  const KEYS = ["regionsReport", "regionsRead"];

  it("has a scope row for each method under IP-58", () => {
    const text = source("../auth/RpcAuthorization.ts");
    expect(text).toContain(marker("IP-58"));
    for (const key of KEYS)
      expect(text).toContain(`[AETHERIA_WS_METHODS.${key}]: AuthOrchestrationReadScope`);
  });

  it("has an instrumentation label for each method under IP-59", () => {
    const text = source("../observability/RpcInstrumentation.ts");
    expect(text).toContain(marker("IP-59"));
    for (const key of KEYS) expect(text).toContain(`[AETHERIA_WS_METHODS.${key}]: "aetheria"`);
  });

  it("hands each method to its handler with the connection's handle and actor, and wraps subscribeThread, under IP-60", () => {
    const text = source("../ws.ts");
    expect(text).toContain(marker("IP-60"));
    for (const [key, handler] of [
      ["regionsReport", "AetheriaRegions.regionsReport"],
      ["regionsRead", "AetheriaRegions.regionsRead"],
    ] as const) {
      const at = text.indexOf(`[AETHERIA_WS_METHODS.${key}]`);
      expect(at, key).toBeGreaterThan(-1);
      expect(text.slice(at, at + 200), key).toContain(
        `${handler}(aetheriaRegionConnection, aetheriaActor, input)`,
      );
    }
    // the handle is released with the REQUEST's scope: the layer's own scope closes right after the handlers are built (M10 slice-2 defect)
    expect(text).toMatch(
      /AetheriaRegions\.openRegionConnectionIn\(\s*connectionScope,\s*aetheriaActor,\s*currentSession\.subject,?\s*\)/,
    );
    expect(text).toMatch(/connectionScope = requestScope \?\? \(yield\* Scope\.Scope\)/);
    expect(text).toMatch(
      /const requestScope = yield\* Scope\.Scope;[\s\S]{0,200}RpcServer\.make\(/,
    );
    expect(text).toMatch(/readSettingsClient\(url\.value\),\s*requestScope,\s*\)/);
    const sub = text.indexOf("[ORCHESTRATION_V2_WS_METHODS.subscribeThread]");
    expect(sub).toBeGreaterThan(-1);
    expect(text.slice(sub, sub + 600)).toMatch(
      /AetheriaRegions\.observeViewing\(\s*aetheriaRegionConnection,\s*input\.threadId/,
    );
  });

  it("drains the shared registry when the Backend layer's scope closes (XC-7)", () => {
    const text = source("./aetheriaBackend.ts");
    expect(text).toContain("drainSharedRegionRegistry()");
    expect(text).toMatch(/Effect\.addFinalizer\([\s\S]{0,200}drainSharedRegionRegistry\(\)/);
  });
});
