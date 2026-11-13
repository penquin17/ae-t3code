// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 14 (D7, D11, D12, R3, XC-20; IP-51 to IP-53) — the deliverable cards and the offered edit paths of a root, through T3's REAL group, scope map and scope middleware.
//
// Boundary: T3's real `WsRpcGroup` (carrying `aetheria.deliverables.list` and `.offeredPaths`), the real exhaustive scope map and scope middleware over an in-process RPC client, and
// `deliverablesRpc.ts` over a FAKE declaration store, a FAKE board read, a FAKE thread index and a FAKE host access rule, with the REAL per-call device check (a fake `auth_sessions` row store).
// It shows: each method's scope and a refusal before the handler runs; a revoked, expired, missing or unreadable device session reaches no store or board call; the same gate as the
// children handlers (a main root the connection may reach, a child never a root, an unreadable index or identity is unavailable, never absent); a card carries the declaring session's thread
// and `supersededBy` and never a snapshot id; a declaration the connection may not reach, or whose session has no thread, is not listed; offered ids are stable and a function of the root and
// the path; known, unknown and unavailable edits stay apart. It does NOT show a real WebSocket, the assembled Backend or the web client.
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthTerminalReadScope,
  WsRpcGroup,
} from "@t3tools/contracts";
import {
  AETHERIA_WS_METHODS,
  ClientDeliverablesListResult,
  ClientOfferedPathsResult,
} from "@t3tools/aetheria-contracts";
import type { DeliverableEntry, EditsRead } from "@t3tools/aetheria-server";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as RpcTest from "effect/rpc/RpcTest";

import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import { RPC_REQUIRED_SCOPES, requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import { AuthSessionRepository } from "../persistence/AuthSessions.ts";
import { deliverablesList, offeredIdOf, offeredPathsRead } from "./deliverablesRpc.ts";
import { connectionActor } from "./humanControlRpc.ts";

const M = AETHERIA_WS_METHODS;
const strict = { onExcessProperty: "error" } as const;
const decodeListResult = Schema.decodeUnknownSync(ClientDeliverablesListResult as never, strict);
const decodeOfferedResult = Schema.decodeUnknownSync(ClientOfferedPathsResult as never, strict);
const SESSION = { sessionId: "device-1", scopes: [AuthOrchestrationReadScope] };
const OPERATE_ONLY = { sessionId: "device-1", scopes: [AuthOrchestrationOperateScope] };

describe("the two methods are in T3's group with one explicit scope each", () => {
  it("joins WsRpcGroup and the scope map exhaustively: both read", () => {
    for (const tag of [M.deliverablesList, M.deliverablesOfferedPaths])
      expect(WsRpcGroup.requests.has(tag)).toBe(true);
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(WsRpcGroup.requests.keys()));
    expect(requiredScopeForRpcMethod(M.deliverablesList)).toBe(AuthOrchestrationReadScope);
    expect(requiredScopeForRpcMethod(M.deliverablesOfferedPaths)).toBe(AuthOrchestrationReadScope);
  });

  it.effect("refuses a token without orchestration:read before any handler runs", () =>
    Effect.gen(function* () {
      for (const tag of [M.deliverablesList, M.deliverablesOfferedPaths]) {
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
          const refused = yield* client[tag]!({ rootThreadId: "t-a" }).pipe(Effect.flip);
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

const DIGEST = `sha256:${"a".repeat(64)}`;
const SNAPSHOT = `snap_${"b".repeat(64)}`;
const entry = (over: Partial<DeliverableEntry> & { id: string }): DeliverableEntry => ({
  requestId: "r",
  requestedPath: "/w/a.md",
  requestedTitle: null,
  sessionId: "pi-a",
  rootSessionId: "pi-a",
  turnId: "run-1",
  canonicalPath: "/w/a.md",
  title: "A",
  kind: "markdown",
  size: 3,
  digest: DIGEST,
  declaredAt: 10,
  snapshot: { state: "attached", snapshotId: SNAPSHOT, digest: DIGEST, size: 3 },
  supersededBy: null,
  ...over,
});
const id = (n: number) => `dlv_${n.toString(16).padStart(32, "0")}`;

type Call = { readonly method: string; readonly args: readonly unknown[] };
interface Options {
  readonly entries?: ReadonlyArray<DeliverableEntry>;
  readonly storeFails?:
    | "DELIVERABLES_STORE_UNUSABLE"
    | "DELIVERABLES_FORMAT_NEWER"
    | "DELIVERABLES_NOT_RUNNING";
  readonly bindings?: Record<
    string,
    {
      sessionId: string;
      subagent: boolean | null;
      threadId?: string;
      /** Pi sessions this thread held before and has since replaced: read-only aliases of the thread. */
      retired?: ReadonlyArray<string>;
    }
  >;
  readonly corruptThreads?: ReadonlyArray<string>;
  readonly denied?: ReadonlyArray<string>;
  readonly kind?: Record<string, "child" | "not-child" | "unavailable">;
  readonly noStore?: boolean;
  readonly noInteractions?: boolean;
  readonly canAccessThrows?: boolean;
  readonly edits?: EditsRead;
  readonly editsThrows?: boolean;
}

const fakeBackend = (options: Options = {}) => {
  const calls: Call[] = [];
  const bindings = options.bindings ?? {
    "t-a": { sessionId: "pi-a", subagent: false },
    "t-sub": { sessionId: "pi-sub", subagent: true },
    "t-child": { sessionId: "pi-child", subagent: null },
    "t-denied": { sessionId: "pi-denied", subagent: false },
  };
  const byThread = new Map(Object.entries(bindings));
  /** The index's binding of a thread: its live session, and the replaced ones as the index lists them. */
  const bindingOf = (threadId: string, held: (typeof bindings)[string]) => {
    const { retired, ...rest } = held;
    return {
      ...rest,
      threadId,
      ...(retired === undefined ? {} : { retired: retired.map((sessionId) => ({ sessionId })) }),
    };
  };
  const bySession = new Map(
    Object.entries(bindings).map(([threadId, value]) => [value.sessionId, { threadId, ...value }]),
  );
  const store = {
    list: async (root: string) => {
      calls.push({ method: "store.list", args: [root] });
      if (options.storeFails !== undefined) return { ok: false as const, code: options.storeFails };
      return {
        ok: true as const,
        value: (options.entries ?? []).filter((e) => e.rootSessionId === root),
      };
    },
  };
  const backend = Option.some({
    deliverables: () => (options.noStore === true ? undefined : store),
    interactions: () =>
      options.noInteractions === true
        ? undefined
        : {
            canAccess: async (...args: unknown[]) => {
              calls.push({ method: "canAccess", args });
              if (options.canAccessThrows === true) throw new Error("rule down");
              return !(options.denied ?? []).includes((args[1] as { sessionId: string }).sessionId);
            },
          },
    index: {
      lookup: (threadId: string) => {
        calls.push({ method: "lookup", args: [threadId] });
        if ((options.corruptThreads ?? []).includes(threadId))
          return { status: "corrupt", problem: "unreadable" };
        const found = byThread.get(threadId);
        return found === undefined
          ? { status: "absent" }
          : { status: "ok", binding: bindingOf(threadId, found) };
      },
      bindingOfSession: (sessionId: string) => {
        calls.push({ method: "bindingOfSession", args: [sessionId] });
        const found = bySession.get(sessionId);
        return found === undefined ? undefined : { ...found };
      },
      aliasOfSession: (sessionId: string) => {
        calls.push({ method: "aliasOfSession", args: [sessionId] });
        const live = bySession.get(sessionId);
        if (live !== undefined) return { retired: false, binding: bindingOf(live.threadId, live) };
        for (const [threadId, held] of byThread)
          if (held.retired?.includes(sessionId) === true)
            return {
              retired: true,
              binding: bindingOf(threadId, held),
              retiredSession: { sessionId },
            };
        return undefined;
      },
    },
    identityKind: (sessionId: string) =>
      options.kind?.[sessionId] ?? (sessionId === "pi-child" ? "child" : "not-child"),
    board: {
      editsOf: async (root: string) => {
        calls.push({ method: "board.editsOf", args: [root] });
        if (options.editsThrows === true) throw new Error("board down");
        return options.edits ?? ({ status: "unknown", reason: "no-record" } as EditsRead);
      },
    },
  });
  return { backend: backend as never, calls };
};
const reads = (calls: ReadonlyArray<Call>) =>
  calls.filter((c) => c.method === "store.list" || c.method === "board.editsOf");

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

type Run = (b: never, a: never) => Effect.Effect<any>;
const bothReads: ReadonlyArray<{ readonly name: string; readonly run: Run }> = [
  { name: "list", run: (b, a) => deliverablesList(b, a, { rootThreadId: "t-a" }) },
  { name: "offered", run: (b, a) => offeredPathsRead(b, a, { rootThreadId: "t-a" }) },
];
const named = (name: string, backend: never, actor: never, threadId: string) =>
  (name === "list"
    ? deliverablesList(backend, actor, { rootThreadId: threadId })
    : offeredPathsRead(backend, actor, { rootThreadId: threadId })) as Effect.Effect<unknown>;

describe("the gate in front of both reads", () => {
  it.effect.each(bothReads)(
    "$name: a revoked, expired, missing or unreadable device session reaches no read",
    ({ run }) =>
      Effect.gen(function* () {
        // `it.effect` runs on the test clock, which starts at 0: an expiry at 0 is not after "now".
        const cases: ReadonlyArray<[() => Effect.Effect<Option.Option<Row>, unknown>, string]> = [
          [
            () => Effect.succeedSome({ ...live(), revokedAt: "2026-01-01" }),
            "DELIVERABLES_DEVICE_REVOKED",
          ],
          [
            () => Effect.succeedSome({ ...live(), expiresAt: DateTime.makeUnsafe(0) }),
            "DELIVERABLES_DEVICE_REVOKED",
          ],
          [() => Effect.succeedNone, "DELIVERABLES_DEVICE_REVOKED"],
          [() => Effect.fail("db down"), "DELIVERABLES_UNAVAILABLE"],
        ];
        for (const [read, code] of cases) {
          const fake = fakeBackend();
          const reply = yield* withDevice(
            Effect.gen(function* () {
              return yield* run(fake.backend, (yield* actorOf()) as never);
            }),
            read,
          );
          expect(reply).toMatchObject({ ok: false, code });
          expect(fake.calls).toEqual([]);
        }
      }),
  );

  it.effect.each(bothReads)(
    "$name: re-checks the scope itself, so a connection without orchestration:read is refused",
    ({ run }) =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend();
          const reply = yield* run(fake.backend, (yield* actorOf(OPERATE_ONLY)) as never);
          expect(reply).toMatchObject({ ok: false, code: "DELIVERABLES_NOT_AUTHORIZED" });
          expect(fake.calls).toEqual([]);
        }),
      ),
  );

  it.effect.each(bothReads)(
    "$name: refuses an unknown thread, a subagent thread, a child identity and a root the connection may not reach as not found, and reads nothing",
    ({ name }) =>
      withDevice(
        Effect.gen(function* () {
          const actor = (yield* actorOf()) as never;
          for (const threadId of ["t-none", "t-sub", "t-child"]) {
            const fake = fakeBackend();
            const reply = yield* named(name, fake.backend, actor, threadId);
            expect(reply).toMatchObject({ ok: false, code: "DELIVERABLES_NOT_FOUND" });
            expect(reads(fake.calls)).toEqual([]);
          }
          const fake = fakeBackend({ denied: ["pi-denied"] });
          const reply = yield* named(name, fake.backend, actor, "t-denied");
          expect(reply).toMatchObject({ ok: false, code: "DELIVERABLES_NOT_FOUND" });
          expect(reads(fake.calls)).toEqual([]);
        }),
      ),
  );

  it.effect.each(bothReads)(
    "$name: an index, identity record, access rule or store that cannot answer is unavailable, never absent",
    ({ name, run }) =>
      withDevice(
        Effect.gen(function* () {
          const actor = (yield* actorOf()) as never;
          const unavailable: ReadonlyArray<Options> = [
            { corruptThreads: ["t-a"] },
            { kind: { "pi-a": "unavailable" } },
            { canAccessThrows: true },
            { noInteractions: true },
            // `noStore` only affects the list: the offered read does not use the declaration store.
            ...(name === "list" ? [{ noStore: true }] : []),
          ];
          for (const options of unavailable) {
            const fake = fakeBackend(options);
            const reply = yield* run(fake.backend, actor);
            expect(reply).toMatchObject({ ok: false, code: "DELIVERABLES_UNAVAILABLE" });
            expect(reads(fake.calls)).toEqual([]);
          }
          const none = yield* run(Option.none() as never, actor);
          expect(none).toMatchObject({ ok: false, code: "DELIVERABLES_UNAVAILABLE" });
        }),
      ),
  );
});

describe("aetheria.deliverables.list", () => {
  it.effect(
    "answers a root's cards oldest first with the declaring session's thread, supersededBy, and never a snapshot id",
    () =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend({
            bindings: {
              "t-a": { sessionId: "pi-a", subagent: false },
              "t-kid": { sessionId: "pi-kid", subagent: null },
            },
            kind: { "pi-kid": "child" },
            entries: [
              entry({ id: id(1), supersededBy: id(2) }),
              entry({ id: id(2), declaredAt: 20 }),
              entry({
                id: id(3),
                sessionId: "pi-kid",
                snapshot: { state: "unavailable", code: "SNAPSHOT_CHANGED" },
                kind: "other",
                declaredAt: 30,
              }),
              entry({ id: id(4), snapshot: { state: "pending" }, declaredAt: 40 }),
              // another root's declaration is never listed
              entry({ id: id(5), rootSessionId: "pi-other", sessionId: "pi-other" }),
            ],
          });
          const reply = yield* deliverablesList(fake.backend, (yield* actorOf()) as never, {
            rootThreadId: "t-a",
          });
          expect(fake.calls.filter((c) => c.method === "store.list").map((c) => c.args)).toEqual([
            ["pi-a"],
          ]);
          expect(reply.ok).toBe(true);
          const cards = (reply as Extract<typeof reply, { ok: true }>).value.deliverables;
          expect(cards.map((c) => c.id)).toEqual([id(1), id(2), id(3), id(4)]);
          expect(cards.map((c) => c.threadId)).toEqual(["t-a", "t-a", "t-kid", "t-a"]);
          expect(cards.map((c) => c.supersededBy)).toEqual([id(2), null, null, null]);
          expect(cards.map((c) => c.snapshot)).toEqual([
            { state: "attached", digest: DIGEST, size: 3 },
            { state: "attached", digest: DIGEST, size: 3 },
            { state: "unavailable", code: "SNAPSHOT_CHANGED" },
            { state: "pending" },
          ]);
          // No snapshot id, no session or root id, anywhere in the reply.
          const text = JSON.stringify(reply);
          for (const secret of [SNAPSHOT, "snap_", "pi-a", "pi-kid", "rootSessionId", "sessionId"])
            expect(text).not.toContain(secret);
          // The reply fits the contract exactly.
          expect(() => decodeListResult(reply)).not.toThrow();
        }),
      ),
  );

  it.effect(
    "does not list a declaration whose session the connection may not reach, or whose session has no thread",
    () =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend({
            denied: ["pi-hidden"],
            bindings: {
              "t-a": { sessionId: "pi-a", subagent: false },
              "t-hidden": { sessionId: "pi-hidden", subagent: null },
            },
            entries: [
              entry({ id: id(1) }),
              entry({ id: id(2), sessionId: "pi-hidden" }),
              entry({ id: id(3), sessionId: "pi-gone" }),
            ],
          });
          const reply = yield* deliverablesList(fake.backend, (yield* actorOf()) as never, {
            rootThreadId: "t-a",
          });
          expect(
            (reply as Extract<typeof reply, { ok: true }>).value.deliverables.map((c) => c.id),
          ).toEqual([id(1)]);
        }),
      ),
  );

  it.effect(
    "lists the deliverables a replaced root left, with the thread now bound, after the live root's own, oldest first (review 1, follow-up 4c)",
    () =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend({
            bindings: { "t-a": { sessionId: "pi-b", subagent: false, retired: ["pi-a0"] } },
            entries: [
              entry({ id: id(1), rootSessionId: "pi-a0", sessionId: "pi-a0", declaredAt: 10 }),
              entry({ id: id(2), rootSessionId: "pi-b", sessionId: "pi-b", declaredAt: 20 }),
              // a root the thread never held is still not listed
              entry({ id: id(3), rootSessionId: "pi-other", sessionId: "pi-other" }),
            ],
          });
          const reply = yield* deliverablesList(fake.backend, (yield* actorOf()) as never, {
            rootThreadId: "t-a",
          });
          expect(fake.calls.filter((c) => c.method === "store.list").map((c) => c.args)).toEqual([
            ["pi-b"],
            ["pi-a0"],
          ]);
          const cards = (reply as Extract<typeof reply, { ok: true }>).value.deliverables;
          expect(cards.map((c) => [c.id, c.threadId])).toEqual([
            [id(1), "t-a"],
            [id(2), "t-a"],
          ]);
          expect(() => decodeListResult(reply)).not.toThrow();
        }),
      ),
  );

  it.effect("a replaced root the connection may not reach lists nothing", () =>
    withDevice(
      Effect.gen(function* () {
        const fake = fakeBackend({
          denied: ["pi-a0"],
          bindings: { "t-a": { sessionId: "pi-b", subagent: false, retired: ["pi-a0"] } },
          entries: [
            entry({ id: id(1), rootSessionId: "pi-a0", sessionId: "pi-a0" }),
            entry({ id: id(2), rootSessionId: "pi-b", sessionId: "pi-b", declaredAt: 20 }),
          ],
        });
        const reply = yield* deliverablesList(fake.backend, (yield* actorOf()) as never, {
          rootThreadId: "t-a",
        });
        expect(
          (reply as Extract<typeof reply, { ok: true }>).value.deliverables.map((c) => c.id),
        ).toEqual([id(2)]);
      }),
    ),
  );

  it.effect("an empty root is a known empty list", () =>
    withDevice(
      Effect.gen(function* () {
        const fake = fakeBackend();
        const reply = yield* deliverablesList(fake.backend, (yield* actorOf()) as never, {
          rootThreadId: "t-a",
        });
        expect(reply).toEqual({ ok: true, value: { rootThreadId: "t-a", deliverables: [] } });
      }),
    ),
  );

  it.effect("a store that cannot be used is a coded failure, never an empty list", () =>
    withDevice(
      Effect.gen(function* () {
        for (const [storeFails, code] of [
          ["DELIVERABLES_STORE_UNUSABLE", "DELIVERABLES_STORE_UNUSABLE"],
          ["DELIVERABLES_FORMAT_NEWER", "DELIVERABLES_FORMAT_NEWER"],
          ["DELIVERABLES_NOT_RUNNING", "DELIVERABLES_UNAVAILABLE"],
        ] as const) {
          const fake = fakeBackend({ storeFails, entries: [entry({ id: id(1) })] });
          const reply = yield* deliverablesList(fake.backend, (yield* actorOf()) as never, {
            rootThreadId: "t-a",
          });
          expect(reply).toMatchObject({ ok: false, code });
        }
      }),
    ),
  );
});

describe("aetheria.deliverables.offeredPaths", () => {
  it("derives a stable id from the root session and the canonical path alone", () => {
    const a = offeredIdOf("pi-a", "/w/a.txt");
    expect(a).toMatch(/^off_[0-9a-f]{32}$/);
    expect(offeredIdOf("pi-a", "/w/a.txt")).toBe(a);
    expect(offeredIdOf("pi-a", "/w/b.txt")).not.toBe(a);
    expect(offeredIdOf("pi-b", "/w/a.txt")).not.toBe(a);
  });

  it.effect("names the known paths with ids and reads the board for the root session once", () =>
    withDevice(
      Effect.gen(function* () {
        const fake = fakeBackend({
          edits: { status: "known", workspace: "/w", paths: ["/w/a.txt", "/w/b.txt"] },
        });
        const actor = (yield* actorOf()) as never;
        const reply = yield* offeredPathsRead(fake.backend, actor, { rootThreadId: "t-a" });
        expect(fake.calls.filter((c) => c.method === "board.editsOf").map((c) => c.args)).toEqual([
          ["pi-a"],
        ]);
        expect(reply).toEqual({
          ok: true,
          value: {
            rootThreadId: "t-a",
            edits: {
              status: "known",
              paths: [
                { id: offeredIdOf("pi-a", "/w/a.txt"), canonicalPath: "/w/a.txt" },
                { id: offeredIdOf("pi-a", "/w/b.txt"), canonicalPath: "/w/b.txt" },
              ],
            },
          },
        });
        expect(() => decodeOfferedResult(reply)).not.toThrow();
        // The workspace is the Backend's, not the browser's.
        expect(JSON.stringify(reply)).not.toContain("workspace");
      }),
    ),
  );

  it.effect("keeps known empty, unknown and unavailable apart", () =>
    withDevice(
      Effect.gen(function* () {
        const actor = (yield* actorOf()) as never;
        const status = (edits: EditsRead) =>
          offeredPathsRead(fakeBackend({ edits }).backend, actor, { rootThreadId: "t-a" }).pipe(
            Effect.map((r) => (r as Extract<typeof r, { ok: true }>).value.edits),
          );
        expect(yield* status({ status: "known", workspace: "/w", paths: [] })).toEqual({
          status: "known",
          paths: [],
        });
        expect(yield* status({ status: "unknown", reason: "no-record" })).toEqual({
          status: "unknown",
        });
        expect(yield* status({ status: "unknown", reason: "no-workspace" })).toEqual({
          status: "unknown",
        });
        expect(yield* status({ status: "unavailable", detail: "board down /secret/path" })).toEqual(
          {
            status: "unavailable",
          },
        );
      }),
    ),
  );

  it.effect("a board read that throws is unavailable, never an empty list", () =>
    withDevice(
      Effect.gen(function* () {
        const fake = fakeBackend({ editsThrows: true });
        const reply = yield* offeredPathsRead(fake.backend, (yield* actorOf()) as never, {
          rootThreadId: "t-a",
        });
        expect(reply).toMatchObject({ ok: true, value: { edits: { status: "unavailable" } } });
      }),
    ),
  );
});
