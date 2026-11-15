// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M11 Plan step 19 (C5 P4, C6 U3; D5, D6, D8–D11; IP-63 to IP-65) — the two methods `aetheria.inspect.requests` and `aetheria.inspect.reply` as T3 joins them: T3's real `WsRpcGroup`, its real scope map and
// scope middleware, the server's real wire decode, and the real handlers over the real region state with T3's real per-call device check (a fake `auth_sessions` row store).
// It shows: both methods are in `WsRpcGroup` and the scope map as `orchestration:read` reads; a token without the scope is refused before any handler runs; a payload with a field the contract does not declare is
// refused at the wire decode, before the handler (the requests payload takes no key at all); a revoked or expired device session ends the stream, refuses the reply and closes the connection; a session that cannot be
// read refuses the reply as unavailable; a connection without the scope gets an empty stream and a refused reply; and the three T3 files carry the marked rows and hunks.
// The finer isolation cases (who may be asked, stolen ids, deadlines) are inspectIsolation.aetheria.test.ts's. It does NOT show a live T3 server, a socket or a browser.
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthTerminalReadScope,
  WsRpcGroup,
} from "@t3tools/contracts";
import { AETHERIA_WS_METHODS, InspectReplyResult } from "@t3tools/aetheria-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
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
import { createInspectClientTransport } from "./inspectClientTransport.ts";
import { inspectReply, inspectRequests } from "./inspectRpc.ts";
import { createRegionRegistry, type RegionRegistry } from "./regionsState.ts";

const M = AETHERIA_WS_METHODS;
const TAGS = [M.inspectRequests, M.inspectReply] as const;
type Session = { sessionId: string; scopes: ReadonlyArray<string> };
const SESSION: Session = { sessionId: "device-1", scopes: [AuthOrchestrationReadScope] };
const OPERATE_ONLY: Session = { sessionId: "device-1", scopes: [AuthOrchestrationOperateScope] };

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const source = (relative: string) => NodeFS.readFileSync(NodePath.join(here, relative), "utf8");

const decodeReply = Schema.decodeUnknownSync(InspectReplyResult as never, {
  onExcessProperty: "error",
}) as (input: unknown) => InspectReplyResult;

type Row = { revokedAt: unknown; expiresAt: DateTime.Utc };
const live = (): Row => ({
  revokedAt: null,
  expiresAt: DateTime.makeUnsafe("2099-01-01T00:00:00.000Z"),
});
const revokedRow = (): Row => ({
  ...live(),
  revokedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
});
const repo = (read: () => Effect.Effect<Option.Option<Row>, unknown>) =>
  Layer.succeed(AuthSessionRepository, { getById: () => read() } as never);
/** The actor reads the device session through the store it was built under, so a test scripts the store here. */
const actorOf = (
  session: Session = SESSION,
  read: () => Effect.Effect<Option.Option<Row>, unknown> = () => Effect.succeedSome(live()),
) => connectionActor(session as never).pipe(Effect.provide(repo(read)));

const registryOf = (): RegionRegistry => {
  let n = 0;
  return createRegionRegistry({ now: () => 1_000_000, newId: () => `conn-${(n += 1)}` });
};

/** A resolver that records what reaches it; the real resolver's cases are inspectIsolation.aetheria.test.ts's. */
const fakeQueries = () => {
  const replies: Array<{ connectionId: string; requestId: string; reply: unknown }> = [];
  const ended: Array<string> = [];
  const queries = {
    reply: (input: { connectionId: string; requestId: string; reply: unknown }) => {
      replies.push(input);
      return "accepted" as const;
    },
    connectionEnded: (connectionId: string) => {
      ended.push(connectionId);
      return 0;
    },
  };
  return { queries: queries as never, replies, ended };
};

const okReply = {
  requestId: "req-1",
  outcome: "ok",
  state: "active",
  shape: {},
  values: { "props.title": "Hello" },
};

describe("the two methods are in T3's group with the read scope", () => {
  it("joins WsRpcGroup and the scope map exhaustively, both as reads", () => {
    for (const tag of TAGS) {
      expect(WsRpcGroup.requests.has(tag)).toBe(true);
      expect(requiredScopeForRpcMethod(tag)).toBe(AuthOrchestrationReadScope);
    }
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(WsRpcGroup.requests.keys()));
  });

  it.effect("refuses a token without the scope before any handler runs", () =>
    Effect.gen(function* () {
      for (const [tag, input] of [
        [M.inspectRequests, {}],
        [M.inspectReply, okReply],
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
          ) => Effect.Effect<Record<string, (p: unknown) => unknown>, never, Scope.Scope>;
          const client = yield* makeClient(group).pipe(
            Effect.provide(
              Layer.mergeAll(
                loose.toLayerHandler(tag, () =>
                  tag === M.inspectRequests
                    ? Stream.unwrap(
                        Effect.sync(() => handled.push(tag)).pipe(Effect.as(Stream.never)),
                      )
                    : Effect.sync(() => handled.push(tag)).pipe(Effect.andThen(Effect.never)),
                ),
                RpcAuthorization.layer(scopes as never),
              ),
            ),
          );
          // A stream method fails when its stream is read; a plain method fails on the call.
          const attempt = client[tag]!(input) as
            | Effect.Effect<unknown, unknown>
            | Stream.Stream<unknown, unknown>;
          const refused = yield* (
            Stream.isStream(attempt)
              ? Stream.runDrain(attempt as Stream.Stream<unknown, unknown>)
              : (attempt as Effect.Effect<unknown, unknown>)
          ).pipe(Effect.flip);
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
 * The wire. `RpcTest.makeClient` passes the payload through unserialized, so it never runs the server's decode. These cases serve the REAL `WsRpcGroup` request over `RpcServer.toHttpEffect` with JSON
 * serialization: the server decodes the payload from bytes with the parse options the Rpc carries, then hands it to the handler. They show what a client is told when it sends a field the contract does not
 * declare; they do not show T3's websocket transport (the same decode, a different protocol).
 */
describe("a payload with a field the contract does not declare is refused at the wire decode", () => {
  const callOverWire = (tag: (typeof TAGS)[number], wirePayload: unknown) =>
    Effect.gen(function* () {
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
        return tag === M.inspectRequests
          ? Stream.empty
          : Effect.succeed({ ok: true, value: { accepted: false } });
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
      ) as ReadonlyArray<{ _tag: string; exit?: { _tag: string } }>;
      return { replies, handled };
    }).pipe(Effect.scoped);

  it.effect("accepts the exact-empty subscription and a well-formed reply: the handler runs", () =>
    Effect.gen(function* () {
      const subscription = yield* callOverWire(M.inspectRequests, {});
      expect(subscription.handled).toEqual([{}]);
      const reply = yield* callOverWire(M.inspectReply, okReply);
      expect(reply.handled).toHaveLength(1);
      expect(reply.replies[0]).toMatchObject({
        _tag: "Exit",
        exit: { _tag: "Success", value: { ok: true, value: { accepted: false } } },
      });
    }),
  );

  it.effect("refuses a subscription that carries any key at all: the handler never runs", () =>
    Effect.gen(function* () {
      for (const forged of [
        { threadId: "forged-thread" },
        { clientId: "client-bob-0000000001" },
        { connectionId: "conn-2" },
        { principal: { subject: "bob" } },
      ]) {
        const { replies, handled } = yield* callOverWire(M.inspectRequests, forged);
        expect(handled).toEqual([]);
        expect(replies).toHaveLength(1);
        expect(replies[0]).toMatchObject({ _tag: "Exit", exit: { _tag: "Failure" } });
        expect(JSON.stringify(replies[0])).not.toMatch(/forged-thread|client-bob|conn-2/);
      }
    }),
  );

  it.effect(
    "refuses a reply that names a connection, client, thread or actor: the handler never runs",
    () =>
      Effect.gen(function* () {
        for (const forged of [
          { ...okReply, connectionId: "conn-2" },
          { ...okReply, clientId: "client-bob-0000000001" },
          { ...okReply, threadId: "forged-thread" },
          { ...okReply, actor: { sessionId: "forged" } },
          { requestId: "req-1", outcome: "unavailable", principal: { subject: "bob" } },
        ]) {
          const { replies, handled } = yield* callOverWire(M.inspectReply, forged);
          expect(handled).toEqual([]);
          expect(replies[0]).toMatchObject({ _tag: "Exit", exit: { _tag: "Failure" } });
          expect(JSON.stringify(replies[0])).not.toMatch(/forged|client-bob|conn-2/);
        }
      }),
  );
});

describe("the handlers re-read the device session on every call", () => {
  it.effect(
    "a revoked device session refuses the reply, closes the connection and settles nothing",
    () =>
      Effect.gen(function* () {
        const registry = registryOf();
        const connection = registry.openConnection({
          subject: "alice",
          deviceSessionId: "device-1",
        });
        const { queries, replies } = fakeQueries();
        const actor = yield* actorOf(SESSION, () => Effect.succeedSome(revokedRow()));
        expect(registry.stats().connections).toBe(1);
        const result = yield* inspectReply(connection, actor, queries, okReply as never);
        expect(decodeReply(result)).toMatchObject({
          ok: false,
          code: "INSPECT_CLIENT_DEVICE_REVOKED",
        });
        expect(registry.stats().connections).toBe(0);
        expect(replies).toEqual([]);
      }),
  );

  it.effect("a missing or expired device session is refused the same way", () =>
    Effect.gen(function* () {
      for (const read of [
        () => Effect.succeedNone,
        () => Effect.succeedSome({ revokedAt: null, expiresAt: DateTime.makeUnsafe(0) }),
      ] as const) {
        const registry = registryOf();
        const connection = registry.openConnection({
          subject: "alice",
          deviceSessionId: "device-1",
        });
        const { queries, replies } = fakeQueries();
        const actor = yield* actorOf(SESSION, read as never);
        const result = yield* inspectReply(connection, actor, queries, okReply as never);
        expect(result).toMatchObject({ ok: false, code: "INSPECT_CLIENT_DEVICE_REVOKED" });
        expect(replies).toEqual([]);
      }
    }),
  );

  it.effect("a device session that cannot be read refuses the reply as unavailable", () =>
    Effect.gen(function* () {
      const registry = registryOf();
      const connection = registry.openConnection({ subject: "alice", deviceSessionId: "device-1" });
      const { queries, replies } = fakeQueries();
      const actor = yield* actorOf(SESSION, () => Effect.fail({ _tag: "RepositoryUnreadable" }));
      const result = yield* inspectReply(connection, actor, queries, okReply as never);
      expect(result).toMatchObject({ ok: false, code: "INSPECT_CLIENT_UNAVAILABLE" });
      expect(replies).toEqual([]);
    }),
  );

  it.effect("a connection without the read scope is refused, and its stream is empty", () =>
    Effect.gen(function* () {
      const registry = registryOf();
      const connection = registry.openConnection({ subject: "alice", deviceSessionId: "device-1" });
      const transport = createInspectClientTransport(registry);
      const { queries, replies } = fakeQueries();
      const actor = yield* actorOf(OPERATE_ONLY);
      expect(yield* inspectReply(connection, actor, queries, okReply as never)).toMatchObject({
        ok: false,
        code: "INSPECT_CLIENT_NOT_AUTHORIZED",
      });
      const items = yield* Stream.runCollect(
        inspectRequests(connection, actor, transport, queries, {}),
      );
      expect([...items]).toEqual([]);
      expect(transport.openStreams()).toBe(0);
      expect(replies).toEqual([]);
    }),
  );

  it.effect("a revoked device session gives an empty stream and opens none", () =>
    Effect.gen(function* () {
      const registry = registryOf();
      const connection = registry.openConnection({ subject: "alice", deviceSessionId: "device-1" });
      const transport = createInspectClientTransport(registry);
      const { queries } = fakeQueries();
      const actor = yield* actorOf(SESSION, () => Effect.succeedSome(revokedRow()));
      const items = yield* Stream.runCollect(
        inspectRequests(connection, actor, transport, queries, {}),
      );
      expect([...items]).toEqual([]);
      expect(transport.openStreams()).toBe(0);
    }),
  );

  it.effect(
    "a standing connection's reply reaches the resolver under the connection's own id only",
    () =>
      Effect.gen(function* () {
        const registry = registryOf();
        const connection = registry.openConnection({
          subject: "alice",
          deviceSessionId: "device-1",
        });
        const { queries, replies } = fakeQueries();
        const actor = yield* actorOf();
        const result = yield* inspectReply(connection, actor, queries, {
          ...okReply,
          connectionId: "conn-forged",
        } as never);
        expect(result).toEqual({ ok: true, value: { accepted: true } });
        expect(replies).toHaveLength(1);
        expect(replies[0]!.connectionId).toBe(connection.id);
        expect(replies[0]!.requestId).toBe("req-1");
      }),
  );
});

describe("the seams are marked and wired in the T3 files (IP-63, IP-64, IP-65)", () => {
  // Built from two parts so this test file is not itself read as an integration-point marker.
  const marker = (id: string) => ["AETHERIA-IP", id].join(":");
  const KEYS = ["inspectRequests", "inspectReply"];

  it("has a read-scope row for each method under IP-63", () => {
    const text = source("../auth/RpcAuthorization.ts");
    expect(text).toContain(marker("IP-63"));
    for (const key of KEYS)
      expect(text).toContain(`[AETHERIA_WS_METHODS.${key}]: AuthOrchestrationReadScope`);
  });

  it("has an instrumentation label for each method under IP-64", () => {
    const text = source("../observability/RpcInstrumentation.ts");
    expect(text).toContain(marker("IP-64"));
    for (const key of KEYS) expect(text).toContain(`[AETHERIA_WS_METHODS.${key}]: "aetheria"`);
  });

  it("hands each method to its handler with the connection's handle, the actor and the shared pair, under IP-65", () => {
    const text = source("../ws.ts");
    expect(text).toContain(marker("IP-65"));
    expect(text).toMatch(/const aetheriaInspectClients = getSharedInspectClients\(\);/);
    const requests = text.indexOf("[AETHERIA_WS_METHODS.inspectRequests]");
    expect(requests).toBeGreaterThan(-1);
    expect(text.slice(requests, requests + 400)).toMatch(
      /AetheriaInspect\.inspectRequests\(\s*aetheriaRegionConnection,\s*aetheriaActor,\s*aetheriaInspectClients\.transport,\s*aetheriaInspectClients\.queries,\s*input,?\s*\)/,
    );
    const reply = text.indexOf("[AETHERIA_WS_METHODS.inspectReply]");
    expect(reply).toBeGreaterThan(-1);
    expect(text.slice(reply, reply + 400)).toMatch(
      /AetheriaInspect\.inspectReply\(\s*aetheriaRegionConnection,\s*aetheriaActor,\s*aetheriaInspectClients\.queries,\s*input,?\s*\)/,
    );
  });
});
