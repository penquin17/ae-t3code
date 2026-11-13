// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 7 (D3, D4, R3, XC-22; IP-47 to IP-49) — the session-group client methods through T3's REAL group, scope map and scope middleware.
//
// Boundary: T3's real `WsRpcGroup` (carrying `aetheria.groups.read` and `.apply`), the real exhaustive scope map and scope middleware over an in-process RPC client, and `groupsRpc.ts` over the REAL
// group store on a temporary state root, a FAKE thread index and a FAKE host access rule, with the REAL per-call device check (a fake `auth_sessions` row store).
// It shows: each method's scope and a refusal before the handler runs; a revoked, expired, missing or unreadable device session reaches no store call; a body outside the five shapes or over
// 8 KiB is refused before any session or file is touched; a session the connection may not reach is refused and nothing is written; a valid change is exactly ONE store call and the file holds the
// confirmed record; the read is a view that omits links to unreachable sessions while the file keeps them; a store that throws is an unknown outcome, never retried.
// It does NOT show a real WebSocket, the Backend lifecycle, or the web client (the native driver reads the stored file).
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthTerminalReadScope,
  WsRpcGroup,
} from "@t3tools/contracts";
import { AETHERIA_WS_METHODS } from "@t3tools/aetheria-contracts";
import { createGroupsStore, type GroupsService } from "@t3tools/aetheria-server";
import { describe, expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as RpcTest from "effect/rpc/RpcTest";
import { afterEach } from "vite-plus/test";

import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import { RPC_REQUIRED_SCOPES, requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import { AuthSessionRepository } from "../persistence/AuthSessions.ts";
import { groupsApply, groupsRead } from "./groupsRpc.ts";
import { connectionActor } from "./humanControlRpc.ts";

const M = AETHERIA_WS_METHODS;
const SESSION = {
  sessionId: "device-1",
  scopes: [AuthOrchestrationOperateScope, AuthOrchestrationReadScope],
};
const READ_ONLY = { sessionId: "device-1", scopes: [AuthOrchestrationReadScope] };
const OPERATE_ONLY = { sessionId: "device-1", scopes: [AuthOrchestrationOperateScope] };

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});
const rootOf = (): string => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m10-groups-rpc-"));
  roots.push(root);
  return root;
};
const fileOf = (root: string) => NodePath.join(root, "aetheria-ui", "session-groups.json");

describe("the group methods are in T3's group with one explicit scope each", () => {
  it("joins WsRpcGroup and the scope map exhaustively: read reads, apply operates", () => {
    for (const tag of [M.groupsRead, M.groupsApply])
      expect(WsRpcGroup.requests.has(tag)).toBe(true);
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(WsRpcGroup.requests.keys()));
    expect(requiredScopeForRpcMethod(M.groupsRead)).toBe(AuthOrchestrationReadScope);
    expect(requiredScopeForRpcMethod(M.groupsApply)).toBe(AuthOrchestrationOperateScope);
    expect(requiredScopeForRpcMethod(M.childrenReport)).toBe(AuthOrchestrationReadScope);
  });

  it.effect("refuses a token without the scope before any handler runs", () =>
    Effect.gen(function* () {
      const payloads: ReadonlyArray<readonly [string, unknown, string]> = [
        [M.groupsRead, {}, AuthOrchestrationReadScope],
        [M.groupsApply, { op: "detach", a: "a" }, AuthOrchestrationOperateScope],
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

interface Options {
  /** Thread ids the fake index knows → their Pi session (default: t-a, t-b, t-c are mains; t-sub is a subagent). */
  readonly bindings?: Record<string, { sessionId: string; subagent: boolean | null }>;
  readonly corruptThreads?: ReadonlyArray<string>;
  /** Pi sessions the host's access rule refuses. */
  readonly denied?: ReadonlyArray<string>;
  readonly noGroups?: boolean;
  readonly noInteractions?: boolean;
  /** Replace the store (to count calls or to make it throw). */
  readonly store?: (real: GroupsService) => GroupsService;
}
type Call = { readonly method: string; readonly args: readonly unknown[] };

const fakeBackend = (root: string, options: Options = {}) => {
  const calls: Call[] = [];
  const bindings = options.bindings ?? {
    "t-a": { sessionId: "pi-a", subagent: false },
    "t-b": { sessionId: "pi-b", subagent: false },
    "t-c": { sessionId: "pi-c", subagent: false },
    "t-denied": { sessionId: "pi-denied", subagent: false },
    "t-sub": { sessionId: "pi-sub", subagent: true },
  };
  const real = createGroupsStore({ stateRoot: root });
  const store: GroupsService = options.store === undefined ? real : options.store(real);
  const counted: GroupsService = {
    read: async () => {
      calls.push({ method: "store.read", args: [] });
      return store.read();
    },
    apply: async (body) => {
      calls.push({ method: "store.apply", args: [body] });
      return store.apply(body);
    },
  };
  const interactions = {
    canAccess: async (...args: unknown[]) => {
      calls.push({ method: "canAccess", args });
      return !(options.denied ?? []).includes((args[1] as { sessionId: string }).sessionId);
    },
  };
  const backend = Option.some({
    groups: () => (options.noGroups === true ? undefined : counted),
    interactions: () => (options.noInteractions === true ? undefined : interactions),
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
  return { backend: backend as never, calls, real };
};
const stored = (calls: ReadonlyArray<Call>) =>
  calls.filter((call) => call.method.startsWith("store."));

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
const actorOf = (session: { sessionId: string; scopes: ReadonlyArray<string> } = SESSION) =>
  connectionActor(session as never);

describe("a valid change is one store call and the file holds the confirmed record", () => {
  it.effect(
    "applies a pair, answers the record, and a scoped key and a bare thread id are the same session",
    () =>
      withDevice(
        Effect.gen(function* () {
          const root = rootOf();
          const fake = fakeBackend(root);
          const actor = yield* actorOf();
          const reply = yield* groupsApply(fake.backend, actor, {
            op: "group",
            a: "env-1:t-b",
            b: "t-a",
          });
          expect(reply).toMatchObject({
            ok: true,
            value: { version: 2, links: [{ a: "env-1:t-b", b: "t-a", kind: "grouped" }] },
          });
          expect(stored(fake.calls).map((call) => call.method)).toEqual(["store.apply"]);
          expect(JSON.parse(NodeFS.readFileSync(fileOf(root), "utf8"))).toEqual(
            (reply as { value: unknown }).value,
          );
          // The thread index was asked, and the host's rule was asked about the Pi session as its own root, BEFORE the store.
          const order = fake.calls.map((call) => call.method);
          expect(order.indexOf("lookup")).toBeLessThan(order.indexOf("canAccess"));
          expect(order.indexOf("canAccess")).toBeLessThan(order.indexOf("store.apply"));
          expect(fake.calls.find((call) => call.method === "canAccess")?.args[1]).toEqual({
            sessionId: "pi-b",
            rootSessionId: "pi-b",
          });
        }),
      ),
  );

  it.effect(
    "the payload cannot supply an actor: a forged field changes nothing about the check",
    () =>
      withDevice(
        Effect.gen(function* () {
          const root = rootOf();
          const fake = fakeBackend(root, { denied: ["pi-a"] });
          const reply = yield* groupsApply(fake.backend, yield* actorOf(), {
            op: "detach",
            a: "t-a",
            ...({ actor: { clientSessionId: "someone" }, user: true } as object),
          } as never);
          expect(reply).toMatchObject({ ok: false, code: "GROUPS_INVALID_REQUEST" });
          expect(stored(fake.calls)).toEqual([]);
        }),
      ),
  );

  it.effect("a rename sorts the members and a no-op writes nothing", () =>
    withDevice(
      Effect.gen(function* () {
        const root = rootOf();
        const fake = fakeBackend(root);
        const actor = yield* actorOf();
        yield* groupsApply(fake.backend, actor, {
          op: "rename",
          members: ["t-c", "t-a"],
          name: " Plans ",
        });
        const bytes = NodeFS.readFileSync(fileOf(root), "utf8");
        const again = yield* groupsApply(fake.backend, actor, {
          op: "rename",
          members: ["t-a", "t-c"],
          name: "Plans",
        });
        expect(again).toMatchObject({
          ok: true,
          value: { names: [{ members: ["t-a", "t-c"], name: "Plans" }] },
        });
        expect(NodeFS.readFileSync(fileOf(root), "utf8")).toBe(bytes);
      }),
    ),
  );
});

describe("a request the Backend refuses reaches no session and no file", () => {
  it.effect(
    "a body outside the five shapes and a body over 8 KiB are refused before any lookup",
    () =>
      withDevice(
        Effect.gen(function* () {
          const root = rootOf();
          const fake = fakeBackend(root);
          const actor = yield* actorOf();
          const invalid = yield* groupsApply(fake.backend, actor, {
            op: "group",
            a: "t-a",
            b: "t-a",
          });
          expect(invalid).toMatchObject({ ok: false, code: "GROUPS_INVALID_REQUEST" });
          const members = Array.from(
            { length: 200 },
            (_, i) => `${String(i).padStart(4, "0")}-${"x".repeat(40)}`,
          );
          const big = yield* groupsApply(fake.backend, actor, {
            op: "rename",
            members,
            name: "Big",
          });
          expect(big).toMatchObject({ ok: false, code: "GROUPS_REQUEST_TOO_LARGE" });
          expect(fake.calls).toEqual([]);
          expect(NodeFS.existsSync(NodePath.join(root, "aetheria-ui"))).toBe(false);
        }),
      ),
  );

  it.effect(
    "a session the connection may not reach, an unknown one and a subagent are refused as GROUPS_SESSION_NOT_FOUND and nothing is written",
    () =>
      withDevice(
        Effect.gen(function* () {
          const root = rootOf();
          const fake = fakeBackend(root, { denied: ["pi-denied"] });
          const actor = yield* actorOf();
          for (const other of ["t-denied", "t-unknown", "t-sub"]) {
            const reply = yield* groupsApply(fake.backend, actor, {
              op: "group",
              a: "t-a",
              b: other,
            });
            expect(reply).toMatchObject({ ok: false, code: "GROUPS_SESSION_NOT_FOUND" });
            expect(JSON.stringify(reply)).not.toContain(other);
          }
          expect(stored(fake.calls)).toEqual([]);
          expect(NodeFS.existsSync(fileOf(root))).toBe(false);
        }),
      ),
  );

  it.effect("an index that cannot answer is GROUPS_UNAVAILABLE, never absent", () =>
    withDevice(
      Effect.gen(function* () {
        const root = rootOf();
        const fake = fakeBackend(root, { corruptThreads: ["t-b"] });
        const reply = yield* groupsApply(fake.backend, yield* actorOf(), {
          op: "group",
          a: "t-a",
          b: "t-b",
        });
        expect(reply).toMatchObject({ ok: false, code: "GROUPS_UNAVAILABLE" });
        expect(stored(fake.calls)).toEqual([]);
      }),
    ),
  );

  it.effect(
    "a stopped Backend, a missing store and a missing access rule answer unavailable and call nothing",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          const none = yield* groupsRead(Option.none() as never, actor, {});
          expect(none).toMatchObject({ ok: false, code: "GROUPS_UNAVAILABLE" });
          for (const options of [{ noGroups: true }, { noInteractions: true }]) {
            const fake = fakeBackend(rootOf(), options);
            expect(yield* groupsRead(fake.backend, actor, {})).toMatchObject({
              ok: false,
              code: "GROUPS_UNAVAILABLE",
            });
            expect(fake.calls).toEqual([]);
          }
        }),
      ),
  );
});

describe("the device session is re-read on every call", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly read: () => Effect.Effect<Option.Option<Row>, unknown>;
    readonly code: string;
  }> = [
    {
      name: "revoked",
      read: () => Effect.succeedSome({ ...live(), revokedAt: "2026-01-01" }),
      code: "GROUPS_DEVICE_REVOKED",
    },
    // `it.effect` runs on the test clock, which starts at 0: an expiry at 0 is not after "now".
    {
      name: "expired",
      read: () => Effect.succeedSome({ ...live(), expiresAt: DateTime.makeUnsafe(0) }),
      code: "GROUPS_DEVICE_REVOKED",
    },
    { name: "missing", read: () => Effect.succeedNone, code: "GROUPS_DEVICE_REVOKED" },
    { name: "unreadable", read: () => Effect.fail("db down"), code: "GROUPS_UNAVAILABLE" },
  ];
  it.effect.each(cases)("$name: read and apply answer $code and reach no store", ({ read, code }) =>
    withDevice(
      Effect.gen(function* () {
        const root = rootOf();
        const fake = fakeBackend(root);
        const actor = yield* actorOf();
        expect(yield* groupsRead(fake.backend, actor, {})).toMatchObject({ ok: false, code });
        expect(
          yield* groupsApply(fake.backend, actor, { op: "group", a: "t-a", b: "t-b" }),
        ).toMatchObject({ ok: false, code });
        expect(fake.calls).toEqual([]);
        expect(NodeFS.existsSync(fileOf(root))).toBe(false);
      }),
      read,
    ),
  );

  it.effect(
    "a scope the connection lacks is GROUPS_NOT_AUTHORIZED even if the middleware were bypassed",
    () =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend(rootOf());
          expect(
            yield* groupsApply(fake.backend, yield* actorOf(READ_ONLY), {
              op: "group",
              a: "t-a",
              b: "t-b",
            }),
          ).toMatchObject({ ok: false, code: "GROUPS_NOT_AUTHORIZED" });
          expect(yield* groupsRead(fake.backend, yield* actorOf(OPERATE_ONLY), {})).toMatchObject({
            ok: false,
            code: "GROUPS_NOT_AUTHORIZED",
          });
          expect(fake.calls).toEqual([]);
        }),
      ),
  );
});

describe("the read is a view of what the connection may see", () => {
  it.effect(
    "omits links, dismissals and names that touch an unreachable session; the file keeps them",
    () =>
      withDevice(
        Effect.gen(function* () {
          const root = rootOf();
          const fake = fakeBackend(root);
          const writer = yield* actorOf();
          yield* groupsApply(fake.backend, writer, { op: "group", a: "t-a", b: "t-b" });
          yield* groupsApply(fake.backend, writer, { op: "group", a: "t-a", b: "t-denied" }).pipe(
            Effect.ignore,
          );
          // The denied session is linked straight into the file (as another device with wider reach could have).
          yield* Effect.promise(() => fake.real.apply({ op: "group", a: "t-a", b: "t-denied" }));
          yield* Effect.promise(() =>
            fake.real.apply({ op: "rename", members: ["t-a", "t-denied"], name: "Hidden" }),
          );
          yield* Effect.promise(() =>
            fake.real.apply({ op: "rename", members: ["t-b", "t-c"], name: "Visible" }),
          );
          const narrow = fakeBackend(root, { denied: ["pi-denied"] });
          const view = yield* groupsRead(narrow.backend, writer, {});
          expect(view).toMatchObject({ ok: true });
          const record = (
            view as unknown as {
              value: { links: Array<{ a: string; b: string }>; names: Array<{ name: string }> };
            }
          ).value;
          expect(record.links.map((link) => `${link.a}|${link.b}`)).toEqual(["t-a|t-b"]);
          expect(record.names.map((saved) => saved.name)).toEqual(["Visible"]);
          const onDisk = JSON.parse(NodeFS.readFileSync(fileOf(root), "utf8")) as {
            links: unknown[];
            names: unknown[];
          };
          expect(onDisk.links).toHaveLength(2);
          expect(onDisk.names).toHaveLength(2);
        }),
      ),
  );

  it.effect("an unusable file is GROUPS_STORE_UNUSABLE and stays as it was", () =>
    withDevice(
      Effect.gen(function* () {
        const root = rootOf();
        NodeFS.mkdirSync(NodePath.dirname(fileOf(root)), { recursive: true });
        NodeFS.writeFileSync(fileOf(root), "{not json");
        const fake = fakeBackend(root);
        const actor = yield* actorOf();
        expect(yield* groupsRead(fake.backend, actor, {})).toMatchObject({
          ok: false,
          code: "GROUPS_STORE_UNUSABLE",
        });
        expect(
          yield* groupsApply(fake.backend, actor, { op: "group", a: "t-a", b: "t-b" }),
        ).toMatchObject({ ok: false, code: "GROUPS_STORE_UNUSABLE" });
        expect(NodeFS.readFileSync(fileOf(root), "utf8")).toBe("{not json");
      }),
    ),
  );
});

describe("a lost reply is an unknown outcome and is not retried", () => {
  it.effect(
    "a store that throws after it was reached is GROUPS_OUTCOME_UNKNOWN, with exactly one store call",
    () =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend(rootOf(), {
            store: (real) => ({
              read: real.read,
              apply: async () => {
                throw new Error("the connection to the store dropped");
              },
            }),
          });
          const reply = yield* groupsApply(fake.backend, yield* actorOf(), {
            op: "group",
            a: "t-a",
            b: "t-b",
          });
          expect(reply).toMatchObject({ ok: false, code: "GROUPS_OUTCOME_UNKNOWN" });
          expect(stored(fake.calls).map((call) => call.method)).toEqual(["store.apply"]);
        }),
      ),
  );
});

describe("what the store answers reaches the client as the contract says", () => {
  it.effect(
    "a store refusal passes its code and detail; a read that throws changed nothing and is unavailable",
    () =>
      withDevice(
        Effect.gen(function* () {
          const refused = fakeBackend(rootOf(), {
            store: () => ({
              read: async () => ({ ok: false, code: "GROUPS_STORE_UNUSABLE", detail: "not JSON" }),
              apply: async () => ({ ok: false, code: "GROUPS_STORE_UNUSABLE", detail: "not JSON" }),
            }),
          });
          const actor = yield* actorOf();
          expect(yield* groupsRead(refused.backend, actor, {})).toEqual({
            ok: false,
            code: "GROUPS_STORE_UNUSABLE",
            detail: "not JSON",
          });
          expect(
            yield* groupsApply(refused.backend, actor, { op: "group", a: "t-a", b: "t-b" }),
          ).toEqual({ ok: false, code: "GROUPS_STORE_UNUSABLE", detail: "not JSON" });
          expect(stored(refused.calls).map((call) => call.method)).toEqual([
            "store.read",
            "store.apply",
          ]);
          const thrown = fakeBackend(rootOf(), {
            store: () => ({
              read: async () => {
                throw new Error("boom");
              },
              apply: async () => {
                throw new Error("boom");
              },
            }),
          });
          const reply = yield* groupsRead(thrown.backend, actor, {});
          expect(reply).toMatchObject({ ok: false, code: "GROUPS_UNAVAILABLE" });
          expect(JSON.stringify(reply)).not.toContain("boom");
          expect(stored(thrown.calls)).toHaveLength(1);
        }),
      ),
  );

  it.effect(
    "a malformed body of any shape (extra key, wrong op, short rename, non-object) is refused before any lookup",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          for (const body of [
            null,
            [],
            {},
            { op: "merge", a: "t-a", b: "t-b" },
            { op: "detach", a: "t-a", b: "t-b" },
            { op: "group", a: "t-a", b: "t-b", user: true },
            { op: "rename", members: ["t-a"], name: "n" },
            { op: "rename", members: ["t-a", "t-b"], name: 7 },
          ]) {
            const fake = fakeBackend(rootOf());
            expect(
              yield* groupsApply(fake.backend, actor, body as never),
              JSON.stringify(body),
            ).toMatchObject({ ok: false, code: "GROUPS_INVALID_REQUEST" });
            expect(fake.calls, JSON.stringify(body)).toEqual([]);
          }
        }),
      ),
  );
});
