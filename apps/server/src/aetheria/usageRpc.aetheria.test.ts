// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 18 (D14, D20, XC-11; IP-54 to IP-56) — `aetheria.usage.read`: the providers' usage and the route availability of a root's children.
//
// Boundary: `usageRpc.ts` over a FAKE thread index, a FAKE host access rule, FAKE M05 direct calls (`listChildren`, `currentRoute`) and FAKE M09 availability (`usage`, `routeStates`), with the
// REAL per-call device check (a fake `auth_sessions` row store). The scope row and the group are checked with the jobs handlers' file (`jobsRpc.aetheria.test.ts`), which runs T3's real middleware
// over all five step-18 methods.
// It shows: the same gate as the children handlers (device session, read scope, a main root the connection may reach, a child never a root) before anything is read; the usage readings pass as
// M09 supplied them (a failed reading is unavailable and carries no window); each known child route is asked about once, in Pi's vocabulary, with purpose `display`; the main thread's own
// route is "not supplied", never guessed or asked about; a child route that is none or unknown has no availability; a read that fails or does not fit the contract is `unavailable`, never an
// empty or zero reading. It does NOT show real credentials, the real M09 service, or the web rendering.
import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import { ClientUsageReadResult } from "@t3tools/aetheria-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { AuthSessionRepository } from "../persistence/AuthSessions.ts";
import { connectionActor } from "./humanControlRpc.ts";
import { usageRead } from "./usageRpc.ts";

const ROOT = "thread-root";
const OTHER_ROOT = "thread-other";
const CHILD = "thread-child";
const AT = "2026-11-14T10:00:00Z";
type Session = { sessionId: string; scopes: ReadonlyArray<string> };
const SESSION: Session = { sessionId: "device-1", scopes: [AuthOrchestrationReadScope] };
const OPERATE_ONLY: Session = { sessionId: "device-1", scopes: [AuthOrchestrationOperateScope] };
const decodeResult = Schema.decodeUnknownSync(ClientUsageReadResult as never, {
  onExcessProperty: "error",
});

const OK_READING = {
  provider: "anthropic",
  observedAt: AT,
  fetchedAt: AT,
  status: "ok",
  stale: false,
  lastGoodAt: AT,
  windows: [{ id: "5h", usedPercent: 42.5, resetsAt: AT }],
};
const FAILED_READING = {
  provider: "openai-codex",
  observedAt: AT,
  fetchedAt: AT,
  status: "unavailable",
  stale: false,
  lastGoodAt: null,
  failure: "timeout",
  windows: [],
};
const stateOf = (reasonClass: string) => ({
  state: "available",
  reasonClass,
  observedAt: AT,
  basis: [{ signal: "credential", result: "signed-in", at: AT }],
});
const OUT_STATE = {
  state: "out",
  reasonClass: "limit-remembered",
  observedAt: AT,
  basis: [],
  resetsAt: AT,
};
const T3_ROUTE = (slug: string, effort?: string) => ({
  kind: "route",
  index: 1,
  route: { provider: "pi", model: slug, ...(effort === undefined ? {} : { effort }) },
});
const ROW = (childId: string) => ({
  childId,
  parentId: ROOT,
  depth: 1,
  role: null,
  mode: "continuable",
  state: "running",
  lastOutcome: null,
  route: null,
});

type Call = { readonly method: string; readonly args: readonly unknown[] };
interface Options {
  readonly deniedRoots?: ReadonlyArray<string>;
  readonly bindings?: Record<string, { sessionId: string; subagent: boolean | null }>;
  readonly sessionKinds?: Record<string, "not-child" | "child" | "unavailable">;
  readonly noInteractions?: boolean;
  readonly noOrchestration?: boolean;
  readonly noDirect?: boolean;
  readonly children?: ReadonlyArray<string>;
  readonly routes?: Record<string, unknown | (() => unknown)>;
  readonly list?: () => Promise<unknown>;
  readonly usage?: () => Promise<unknown>;
  readonly routeStates?: (routes: readonly unknown[]) => Promise<unknown>;
}

const fakeBackend = (options: Options = {}) => {
  const calls: Array<Call> = [];
  const bindings = options.bindings ?? {
    [ROOT]: { sessionId: "pi-root", subagent: false },
    [OTHER_ROOT]: { sessionId: "pi-other", subagent: false },
    [CHILD]: { sessionId: "pi-child", subagent: true },
  };
  const children = options.children ?? ["child-a", "child-b", "child-c"];
  const routes = options.routes ?? {
    "child-a": T3_ROUTE("anthropic/claude-x", "high"),
    "child-b": { kind: "none" },
    "child-c": { kind: "unknown", detail: "the route state cannot be read" },
  };
  const direct = {
    listChildren: async (...args: unknown[]) => {
      calls.push({ method: "listChildren", args });
      return options.list === undefined
        ? { ok: true, value: { rows: children.map(ROW), diagnostics: [] } }
        : options.list();
    },
    currentRoute: (...args: unknown[]) => {
      calls.push({ method: "currentRoute", args });
      const route = routes[args[0] as string];
      if (typeof route === "function") return (route as () => unknown)();
      return route ?? { kind: "none" };
    },
    cancelTree: async (...args: unknown[]) => {
      calls.push({ method: "cancelTree", args });
      return { ok: true, value: {} };
    },
  };
  const routeAvailability = {
    usage: async (...args: unknown[]) => {
      calls.push({ method: "usage", args });
      return options.usage === undefined ? [OK_READING, FAILED_READING] : options.usage();
    },
    routeStates: async (...args: unknown[]) => {
      calls.push({ method: "routeStates", args });
      const asked = args[0] as readonly unknown[];
      return options.routeStates === undefined
        ? asked.map(() => stateOf("signed-in-window-ok"))
        : options.routeStates(asked);
    },
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
    routeAvailability,
    index: {
      lookup: (threadId: string) => {
        calls.push({ method: "lookup", args: [threadId] });
        const found = bindings[threadId];
        return found === undefined
          ? { status: "absent" }
          : { status: "ok", binding: { threadId, ...found } };
      },
    },
  });
  return { backend: backend as never, calls };
};
const READS = ["listChildren", "currentRoute", "usage", "routeStates"];
const reading = (calls: ReadonlyArray<Call>) => calls.filter((call) => READS.includes(call.method));
const named = (calls: ReadonlyArray<Call>, method: string) =>
  calls.filter((call) => call.method === method);

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

type Value = {
  usage: { status: string; readings?: unknown[]; detail?: string };
  main: unknown;
  children: { status: string; rows?: Array<Record<string, any>>; detail?: string };
};
const valueOf = (reply: unknown): Value => {
  expect(reply).toMatchObject({ ok: true });
  return (reply as { value: Value }).value;
};

describe("a root's usage is the providers' readings, the children's routes and each route's availability", () => {
  it.effect(
    "reads once in the contract's own shape, and asks M09 about each known child route in Pi's vocabulary with purpose display",
    () =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend();
          const reply = yield* usageRead(fake.backend, yield* actorOf(), {
            rootThreadId: ROOT,
            ...({
              caller: { user: false },
              provider: "anthropic",
              routes: [{ provider: "x", model: "y" }],
            } as object),
          });
          // The reply is a value of the contract, with no extra field.
          decodeResult(reply);
          const value = valueOf(reply);
          expect(value).toMatchObject({
            usage: { status: "read", readings: [OK_READING, FAILED_READING] },
            main: { threadId: ROOT, route: { status: "not-supplied" } },
          });
          expect(value.children.status).toBe("listed");
          expect(value.children.rows).toEqual([
            {
              childThreadId: "child-a",
              route: {
                status: "known",
                index: 1,
                provider: "anthropic",
                model: "claude-x",
                effort: "high",
              },
              availability: { status: "read", state: stateOf("signed-in-window-ok") },
            },
            { childThreadId: "child-b", route: { status: "none" } },
            {
              childThreadId: "child-c",
              route: { status: "unknown", detail: "the route state cannot be read" },
            },
          ]);
          // M05: one user list of the named root; one route lookup per child.
          expect(named(fake.calls, "listChildren")).toEqual([
            {
              method: "listChildren",
              args: [
                { caller: { user: true }, args: { scope: "descendants", rootThreadId: ROOT } },
              ],
            },
          ]);
          expect(named(fake.calls, "currentRoute").map((call) => call.args)).toEqual([
            ["child-a"],
            ["child-b"],
            ["child-c"],
          ]);
          // M09: usage for every provider (no filter from the payload), route states once, display, only the one known route, in Pi's form and without the effort.
          expect(named(fake.calls, "usage")).toEqual([{ method: "usage", args: [] }]);
          expect(named(fake.calls, "routeStates")).toEqual([
            {
              method: "routeStates",
              args: [[{ provider: "anthropic", model: "claude-x" }], "display"],
            },
          ]);
          // Order: the gate before every read.
          const order = fake.calls.map((call) => call.method);
          expect(order.indexOf("canAccess")).toBeLessThan(order.indexOf("usage"));
          expect(order.indexOf("canAccess")).toBeLessThan(order.indexOf("listChildren"));
          // Nothing mutating was called.
          expect(named(fake.calls, "cancelTree")).toEqual([]);
        }),
      ),
  );

  it.effect(
    "never guesses the main thread's route: it is not supplied and nothing is asked about it",
    () =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend({ children: [] });
          const value = valueOf(
            yield* usageRead(fake.backend, yield* actorOf(), { rootThreadId: ROOT }),
          );
          expect(value.main).toEqual({ threadId: ROOT, route: { status: "not-supplied" } });
          expect(value.children).toEqual({ status: "listed", rows: [] });
          // With no child route there is nothing to ask M09 about, and the root's own thread was never given to `currentRoute`.
          expect(named(fake.calls, "routeStates")).toEqual([]);
          expect(named(fake.calls, "currentRoute")).toEqual([]);
        }),
      ),
  );

  it.effect("asks about each distinct route once and answers every child that holds it", () =>
    withDevice(
      Effect.gen(function* () {
        const fake = fakeBackend({
          children: ["child-a", "child-b", "child-c"],
          routes: {
            "child-a": T3_ROUTE("anthropic/claude-x"),
            "child-b": T3_ROUTE("anthropic/claude-x", "low"),
            "child-c": T3_ROUTE("openai-codex/gpt-y"),
          },
          routeStates: async (asked) =>
            asked.map((_, i) => (i === 0 ? OUT_STATE : stateOf("signed-in-no-quota-reader"))),
        });
        const value = valueOf(
          yield* usageRead(fake.backend, yield* actorOf(), { rootThreadId: ROOT }),
        );
        expect(named(fake.calls, "routeStates")[0]!.args[0]).toEqual([
          { provider: "anthropic", model: "claude-x" },
          { provider: "openai-codex", model: "gpt-y" },
        ]);
        const states = value.children.rows!.map((row) => row.availability.state.reasonClass);
        expect(states).toEqual([
          "limit-remembered",
          "limit-remembered",
          "signed-in-no-quota-reader",
        ]);
      }),
    ),
  );

  it.effect("a route that is already in Pi's form is shown and asked about as it is", () =>
    withDevice(
      Effect.gen(function* () {
        const fake = fakeBackend({
          children: ["child-a"],
          routes: {
            "child-a": {
              kind: "route",
              index: 2,
              route: { provider: "anthropic", model: "claude-x" },
            },
          },
        });
        const value = valueOf(
          yield* usageRead(fake.backend, yield* actorOf(), { rootThreadId: ROOT }),
        );
        expect(value.children.rows![0]!.route).toEqual({
          status: "known",
          index: 2,
          provider: "anthropic",
          model: "claude-x",
        });
        expect(named(fake.calls, "routeStates")[0]!.args[0]).toEqual([
          { provider: "anthropic", model: "claude-x" },
        ]);
      }),
    ),
  );
});

describe("missing or failed data is unavailable, never zero or empty", () => {
  it.effect(
    "a failed provider reading stays unavailable with no window; an empty list is a known empty",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          const failed = valueOf(
            yield* usageRead(fakeBackend({ usage: async () => [FAILED_READING] }).backend, actor, {
              rootThreadId: ROOT,
            }),
          );
          expect(failed.usage).toEqual({ status: "read", readings: [FAILED_READING] });
          const empty = valueOf(
            yield* usageRead(fakeBackend({ usage: async () => [] }).backend, actor, {
              rootThreadId: ROOT,
            }),
          );
          expect(empty.usage).toEqual({ status: "read", readings: [] });
        }),
      ),
  );

  it.effect(
    "usage that throws, is not an array or has a reading outside the contract is unavailable with a reason, and the rest of the reply stands",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          for (const usage of [
            async () => {
              throw new Error("providers service is not running");
            },
            async () => "nonsense",
            // A reading that names a 0 percent window while claiming unavailable is not a reading.
            async () => [{ ...FAILED_READING, windows: [{ id: "5h", usedPercent: 0 }] }],
            async () => [{ ...OK_READING, windows: [{ id: "5h" }] }],
          ]) {
            const reply = yield* usageRead(fakeBackend({ usage }).backend, actor, {
              rootThreadId: ROOT,
            });
            decodeResult(reply);
            const value = valueOf(reply);
            expect(value.usage.status).toBe("unavailable");
            expect(value.usage.detail).toEqual(expect.any(String));
            expect(value.usage).not.toHaveProperty("readings");
            expect(value.children.status).toBe("listed");
            expect(JSON.stringify(reply)).not.toContain("providers service is not running");
          }
        }),
      ),
  );

  it.effect(
    "route states that throw, come back short or do not fit the contract leave that route's availability unavailable, not a state",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          for (const routeStates of [
            async () => {
              throw new Error("down");
            },
            async () => [],
            async () => "nonsense",
            async () => [
              { state: "out", reasonClass: "signed-in-window-ok", observedAt: AT, basis: [] },
            ],
          ]) {
            const reply = yield* usageRead(fakeBackend({ routeStates }).backend, actor, {
              rootThreadId: ROOT,
            });
            decodeResult(reply);
            const rows = valueOf(reply).children.rows!;
            expect(rows[0]!.availability).toEqual({
              status: "unavailable",
              detail: expect.any(String),
            });
            expect(rows[0]!.route.status).toBe("known");
            // The rows with no known route keep having none.
            expect(rows[1]).toEqual({ childThreadId: "child-b", route: { status: "none" } });
          }
        }),
      ),
  );

  it.effect(
    "children that cannot be listed are unavailable, not none: the usage is still read",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          for (const options of [
            { noOrchestration: true },
            { noDirect: true },
            { list: async () => ({ ok: false, code: "ORCHESTRATION_UNAVAILABLE" }) },
            {
              list: async () => {
                throw new Error("down");
              },
            },
            { list: async () => "nonsense" },
            { list: async () => ({ ok: true, value: { rows: [{ childId: "" }] } }) },
          ] as Options[]) {
            const reply = yield* usageRead(fakeBackend(options).backend, actor, {
              rootThreadId: ROOT,
            });
            decodeResult(reply);
            const value = valueOf(reply);
            expect(value.children).toEqual({ status: "unavailable", detail: expect.any(String) });
            expect(value.usage.status).toBe("read");
          }
        }),
      ),
  );

  it.effect(
    "a route lookup that throws or answers nothing readable is that child's unknown route, never a guessed one",
    () =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend({
            children: ["child-a", "child-b"],
            routes: {
              "child-a": () => {
                throw new Error("down");
              },
              "child-b": "nonsense",
            },
          });
          const rows = valueOf(
            yield* usageRead(fake.backend, yield* actorOf(), { rootThreadId: ROOT }),
          ).children.rows!;
          expect(rows.map((row) => row.route.status)).toEqual(["unknown", "unknown"]);
          expect(rows.every((row) => row.availability === undefined)).toBe(true);
          expect(named(fake.calls, "routeStates")).toEqual([]);
        }),
      ),
  );
});

describe("nothing is read unless the connection may read the root", () => {
  it.effect("an operate-only device is refused by the handler's own scope check", () =>
    withDevice(
      Effect.gen(function* () {
        const fake = fakeBackend();
        expect(
          yield* usageRead(fake.backend, yield* actorOf(OPERATE_ONLY), { rootThreadId: ROOT }),
        ).toMatchObject({ ok: false, code: "USAGE_NOT_AUTHORIZED" });
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
          () => Effect.succeedSome({ revokedAt: null, expiresAt: DateTime.makeUnsafe(0) }),
        ],
      ];
      for (const [label, read] of cases) {
        const fake = fakeBackend();
        yield* withDevice(
          Effect.gen(function* () {
            expect(
              yield* usageRead(fake.backend, yield* actorOf(), { rootThreadId: ROOT }),
              label,
            ).toMatchObject({ ok: false, code: "USAGE_DEVICE_REVOKED" });
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
        expect(
          yield* usageRead(fake.backend, yield* actorOf(), { rootThreadId: ROOT }),
        ).toMatchObject({
          ok: false,
          code: "USAGE_UNAVAILABLE",
        });
        expect(fake.calls).toEqual([]);
      }),
      () => Effect.fail({ _tag: "RepositoryUnreadable" as const }),
    );
  });

  it.effect(
    "a wrong root reaches nothing: unknown thread, a child named as a root, a root the host rule refuses",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          for (const [label, root, options] of [
            ["unknown thread", "thread-nobody", {}],
            ["subagent flag", CHILD, {}],
            ["denied by the host rule", OTHER_ROOT, { deniedRoots: ["pi-other"] }],
            [
              "child by identity record",
              CHILD,
              { bindings: { [CHILD]: { sessionId: "pi-child", subagent: null } } },
            ],
          ] as const) {
            const fake = fakeBackend(options as Options);
            expect(
              yield* usageRead(fake.backend, actor, { rootThreadId: root }),
              label,
            ).toMatchObject({
              ok: false,
              code: "USAGE_NOT_FOUND",
            });
            expect(reading(fake.calls), label).toEqual([]);
          }
          for (const options of [
            { sessionKinds: { "pi-root": "unavailable" as const } },
            { noInteractions: true },
          ]) {
            const fake = fakeBackend(options);
            expect(yield* usageRead(fake.backend, actor, { rootThreadId: ROOT })).toMatchObject({
              ok: false,
              code: "USAGE_UNAVAILABLE",
            });
            expect(reading(fake.calls)).toEqual([]);
          }
          expect(yield* usageRead(Option.none(), actor, { rootThreadId: ROOT })).toMatchObject({
            ok: false,
            code: "USAGE_UNAVAILABLE",
          });
        }),
      ),
  );
});
