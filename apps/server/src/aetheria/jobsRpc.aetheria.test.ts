// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 18 (D14, D20, R3, XC-15, XC-16; IP-54 to IP-56) — a root's jobs, one job's output, its completion-outbox rows and the user's kill, through T3's REAL group, scope map
// and scope middleware.
//
// Boundary: T3's real `WsRpcGroup` (carrying the five step-18 methods), the real exhaustive scope map and scope middleware over an in-process RPC client, and `jobsRpc.ts` over FAKE M05
// user-call functions (`listJobs`, `readJobOutput`, `killJob`, `listOutbox`) shaped as M05's real ones answer (`{jobs, unreadable}`, one stream per read at one offset, `{rows, unreadable}` with an
// owner on each row), a FAKE thread index and a FAKE host access rule, with the REAL per-call device check (a fake `auth_sessions` row store). They are doubles of M05's SHAPE, not of the real service.
// It shows: each method's scope and a refusal before the handler runs; the actor only from the connection; a revoked, expired, missing or unreadable device session reaches no M05 call; a
// root the connection may not reach, a child named as a root and a job that is not one of the root's reach no read or kill; an output read is one M05 call per stream with the user caller and that stream's explicit offset
// and nothing that moves the agent's cursor; M05's `unreadable` count travels, so an incomplete list says so, and an outbox row's owner stays out of the client's reply; a kill is exactly one call and a lost reply is an unknown outcome that is not retried; M05 without the four calls answers "not connected yet".
// It does NOT show the real M05 service, a real WebSocket, stored job state, or the cursor behaviour of the real read (the caller cross-checks that after M05 lands).
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
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import { RPC_REQUIRED_SCOPES, requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import { AuthSessionRepository } from "../persistence/AuthSessions.ts";
import { connectionActor } from "./humanControlRpc.ts";
import { jobsKill, jobsList, jobsOutboxList, jobsOutput } from "./jobsRpc.ts";

const M = AETHERIA_WS_METHODS;
const READS = [M.jobsList, M.jobsOutput, M.jobsOutboxList, M.usageRead] as const;
const ROOT = "thread-root";
const OTHER_ROOT = "thread-other";
const CHILD = "thread-child";
const JOB = "job-1";
type Session = { sessionId: string; scopes: ReadonlyArray<string> };
const SESSION: Session = {
  sessionId: "device-1",
  scopes: [AuthOrchestrationOperateScope, AuthOrchestrationReadScope],
};
const READ_ONLY = { sessionId: "device-1", scopes: [AuthOrchestrationReadScope] };
const OPERATE_ONLY = { sessionId: "device-1", scopes: [AuthOrchestrationOperateScope] };
const OFFSETS = { stdout: 10, stderr: 0 };

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const source = (relative: string) => NodeFS.readFileSync(NodePath.join(here, relative), "utf8");

describe("the five methods are in T3's group with one explicit scope each (IP-54)", () => {
  it("joins WsRpcGroup and the scope map exhaustively: the reads read, the kill operates", () => {
    for (const tag of [...READS, M.jobsKill]) expect(WsRpcGroup.requests.has(tag)).toBe(true);
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(WsRpcGroup.requests.keys()));
    for (const tag of READS)
      expect(requiredScopeForRpcMethod(tag)).toBe(AuthOrchestrationReadScope);
    expect(requiredScopeForRpcMethod(M.jobsKill)).toBe(AuthOrchestrationOperateScope);
  });

  it.effect("refuses a token without the scope before any handler runs", () =>
    Effect.gen(function* () {
      const payloads: ReadonlyArray<readonly [string, unknown, string]> = [
        [M.jobsList, { rootThreadId: ROOT }, AuthOrchestrationReadScope],
        [
          M.jobsOutput,
          { rootThreadId: ROOT, jobId: JOB, offsets: OFFSETS },
          AuthOrchestrationReadScope,
        ],
        [M.jobsOutboxList, { rootThreadId: ROOT }, AuthOrchestrationReadScope],
        [M.usageRead, { rootThreadId: ROOT }, AuthOrchestrationReadScope],
        [M.jobsKill, { rootThreadId: ROOT, jobId: JOB }, AuthOrchestrationOperateScope],
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

describe("the seams are marked and wired in the three T3 files (IP-54, IP-55, IP-56)", () => {
  // Built from two parts so this test file is not itself read as an integration-point marker.
  const marker = (id: string) => ["AETHERIA-IP", id].join(":");
  const METHODS = [M.jobsList, M.jobsOutput, M.jobsOutboxList, M.jobsKill, M.usageRead];
  const KEYS = ["jobsList", "jobsOutput", "jobsOutboxList", "jobsKill", "usageRead"];

  it("has a scope row for each method under IP-54", () => {
    const text = source("../auth/RpcAuthorization.ts");
    expect(text).toContain(marker("IP-54"));
    for (const key of KEYS) expect(text).toContain(`[AETHERIA_WS_METHODS.${key}]`);
    expect(METHODS).toHaveLength(5);
  });

  it("has an instrumentation label for each method under IP-55", () => {
    const text = source("../observability/RpcInstrumentation.ts");
    expect(text).toContain(marker("IP-55"));
    for (const key of KEYS) expect(text).toContain(`[AETHERIA_WS_METHODS.${key}]: "aetheria"`);
  });

  it("hands each method to its Aetheria handler with the connection's actor under IP-56", () => {
    const text = source("../ws.ts");
    expect(text).toContain(marker("IP-56"));
    for (const [key, handler] of [
      ["jobsList", "AetheriaJobs.jobsList"],
      ["jobsOutput", "AetheriaJobs.jobsOutput"],
      ["jobsOutboxList", "AetheriaJobs.jobsOutboxList"],
      ["jobsKill", "AetheriaJobs.jobsKill"],
      ["usageRead", "AetheriaUsage.usageRead"],
    ] as const) {
      const at = text.indexOf(`[AETHERIA_WS_METHODS.${key}]`);
      expect(at, key).toBeGreaterThan(-1);
      expect(text.slice(at, at + 200), key).toContain(
        `${handler}(aetheriaBackend, aetheriaActor, input)`,
      );
    }
  });
});

type Call = { readonly method: string; readonly args: readonly unknown[] };
type OutputInput = {
  readonly caller: unknown;
  readonly args: { readonly stream?: string; readonly offset?: number };
};
interface Options {
  readonly deniedRoots?: ReadonlyArray<string>;
  readonly bindings?: Record<string, { sessionId: string; subagent: boolean | null }>;
  readonly corruptThreads?: ReadonlyArray<string>;
  readonly sessionKinds?: Record<string, "not-child" | "child" | "unavailable">;
  readonly noInteractions?: boolean;
  readonly noOrchestration?: boolean;
  readonly noDirect?: boolean;
  /** Which of M05's four user calls exist; default all. */
  readonly without?: ReadonlyArray<"listJobs" | "readJobOutput" | "killJob" | "listOutbox">;
  readonly list?: () => Promise<unknown>;
  readonly output?: (input: OutputInput) => Promise<unknown>;
  readonly kill?: () => Promise<unknown>;
  readonly outbox?: () => Promise<unknown>;
}
const JOB_ROW = (jobId: string) => ({
  jobId,
  ownerSessionId: "pi-child",
  label: "npm test",
  state: "running",
  completion: "pending",
});
/** One stream's chunk as M05's user read answers it for a read at `offset`: six bytes of text, the stream's size, nothing more waiting. */
const CHUNK = (stream: string, offset: number) => ({
  stream,
  from: offset,
  to: offset + 6,
  text: "hello\n",
  truncated: false,
  size: offset + 6,
});
const OUTPUT_FOR = async (input: OutputInput) => ({
  ok: true,
  value: {
    jobId: JOB,
    state: "running",
    streams: [CHUNK(input.args.stream ?? "stdout", input.args.offset ?? 0)],
  },
});
const KILL_VALUE = { jobId: JOB, state: "killed", exit: { code: null, signal: "SIGKILL" } };
const OUTBOX_ROW = {
  key: "job:job-1:completion",
  kind: "job-completion",
  state: "pending",
  delivery: "delivery-uncertain",
  attempts: 2,
  uncertainSince: 1700000000000,
  nextAttemptAt: 1700000005000,
};
/** M05's outbox row names the owner whose record holds it; the client's row does not carry it. */
const OWNED_OUTBOX_ROW = { ...OUTBOX_ROW, owner: { kind: "job", jobId: JOB } };

const fakeBackend = (options: Options = {}) => {
  const calls: Array<Call> = [];
  const note =
    (method: string, result: (...args: never[]) => Promise<unknown>) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return (result as (...given: unknown[]) => Promise<unknown>)(...args);
    };
  const bindings = options.bindings ?? {
    [ROOT]: { sessionId: "pi-root", subagent: false },
    [OTHER_ROOT]: { sessionId: "pi-other", subagent: false },
    [CHILD]: { sessionId: "pi-child", subagent: true },
  };
  const all: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    listJobs: note(
      "listJobs",
      options.list ??
        (async () => ({
          ok: true,
          value: { jobs: [JOB_ROW(JOB), JOB_ROW("job-2")], unreadable: 0 },
        })),
    ),
    readJobOutput: note("readJobOutput", options.output ?? OUTPUT_FOR),
    killJob: note("killJob", options.kill ?? (async () => ({ ok: true, value: KILL_VALUE }))),
    listOutbox: note(
      "listOutbox",
      options.outbox ??
        (async () => ({ ok: true, value: { rows: [OWNED_OUTBOX_ROW], unreadable: 0 } })),
    ),
  };
  const direct: Record<string, unknown> = {
    // M05's committed calls are present beside the four, and a jobs handler never touches them.
    cancelTree: note("cancelTree", async () => ({ ok: true, value: {} })),
    closeChild: note("closeChild", async () => ({ ok: true, value: {} })),
  };
  for (const [name, fn] of Object.entries(all))
    if (!(options.without ?? []).includes(name as never)) direct[name] = fn;
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
const M05 = ["listJobs", "readJobOutput", "killJob", "listOutbox", "cancelTree", "closeChild"];
const reaching = (calls: ReadonlyArray<Call>) => calls.filter((call) => M05.includes(call.method));
const killing = (calls: ReadonlyArray<Call>) => calls.filter((call) => call.method === "killJob");

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

const USER = { user: true };

describe("the reads are one M05 call each with the user caller", () => {
  it.effect(
    "lists a root's jobs: one listJobs, the root named, the payload cannot supply a caller",
    () =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend();
          const reply = yield* jobsList(fake.backend, yield* actorOf(), {
            rootThreadId: ROOT,
            ...({
              caller: { user: false },
              user: true,
              actor: { clientSessionId: "someone" },
            } as object),
          });
          expect(reply).toEqual({
            ok: true,
            value: { jobs: [JOB_ROW(JOB), JOB_ROW("job-2")], unreadable: 0 },
          });
          expect(reaching(fake.calls)).toEqual([
            { method: "listJobs", args: [{ caller: USER, args: { rootThreadId: ROOT } }] },
          ]);
          // The root was read from the index and the host rule asked about its session BEFORE the call.
          const order = fake.calls.map((call) => call.method);
          expect(order.indexOf("lookup")).toBeLessThan(order.indexOf("canAccess"));
          expect(order.indexOf("canAccess")).toBeLessThan(order.indexOf("listJobs"));
          expect(fake.calls.find((call) => call.method === "canAccess")?.args[1]).toEqual({
            sessionId: "pi-root",
            rootSessionId: "pi-root",
          });
          expect(JSON.stringify(fake.calls)).not.toContain("someone");
        }),
      ),
  );

  it.effect(
    "keeps what M05 supplied: lost, indeterminate and uncertain flags travel, a field outside the contract does not",
    () =>
      withDevice(
        Effect.gen(function* () {
          const row = {
            ...JOB_ROW("job-3"),
            state: "lost",
            completion: "none",
            livenessIndeterminate: true,
            terminationUnconfirmed: true,
            deliveryUncertain: true,
            command: "rm -rf /",
          };
          const fake = fakeBackend({
            list: async () => ({ ok: true, value: { jobs: [row], unreadable: 0 } }),
          });
          const reply = yield* jobsList(fake.backend, yield* actorOf(), { rootThreadId: ROOT });
          const { command: _dropped, ...kept } = row;
          expect(reply).toEqual({ ok: true, value: { jobs: [kept], unreadable: 0 } });
        }),
      ),
  );

  it.effect(
    "carries M05's count of unreadable records to the client: an incomplete list is said to be incomplete, never shown as the whole",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          const listed = fakeBackend({
            list: async () => ({ ok: true, value: { jobs: [JOB_ROW(JOB)], unreadable: 2 } }),
          });
          expect(yield* jobsList(listed.backend, actor, { rootThreadId: ROOT })).toEqual({
            ok: true,
            value: { jobs: [JOB_ROW(JOB)], unreadable: 2 },
          });
          const outbox = fakeBackend({
            outbox: async () => ({ ok: true, value: { rows: [OWNED_OUTBOX_ROW], unreadable: 1 } }),
          });
          expect(yield* jobsOutboxList(outbox.backend, actor, { rootThreadId: ROOT })).toEqual({
            ok: true,
            value: { rows: [OUTBOX_ROW], unreadable: 1 },
          });
        }),
      ),
  );

  it.effect(
    "reads one job's output at the explicit offsets: one readJobOutput per stream at that stream's offset, nothing that kills or moves a cursor",
    () =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend();
          const reply = yield* jobsOutput(fake.backend, yield* actorOf(), {
            rootThreadId: ROOT,
            jobId: JOB,
            offsets: OFFSETS,
          });
          // M05's one `offset` serves both streams, so two different offsets are two reads; the chunks are merged stdout first, the envelope is the later read's.
          expect(reply).toEqual({
            ok: true,
            value: {
              jobId: JOB,
              state: "running",
              streams: [CHUNK("stdout", OFFSETS.stdout), CHUNK("stderr", OFFSETS.stderr)],
            },
          });
          const read = fake.calls.filter((call) => call.method === "readJobOutput");
          expect(read).toEqual([
            {
              method: "readJobOutput",
              args: [
                {
                  caller: USER,
                  args: {
                    rootThreadId: ROOT,
                    jobId: JOB,
                    offset: OFFSETS.stdout,
                    stream: "stdout",
                  },
                },
              ],
            },
            {
              method: "readJobOutput",
              args: [
                {
                  caller: USER,
                  args: {
                    rootThreadId: ROOT,
                    jobId: JOB,
                    offset: OFFSETS.stderr,
                    stream: "stderr",
                  },
                },
              ],
            },
          ]);
          expect(killing(fake.calls)).toEqual([]);
          // Two reads at the same offsets are two independent calls with the same arguments: the browser holds its position, the handler none.
          const again = fakeBackend();
          const actor = yield* actorOf();
          yield* jobsOutput(again.backend, actor, {
            rootThreadId: ROOT,
            jobId: JOB,
            offsets: OFFSETS,
          });
          yield* jobsOutput(again.backend, actor, {
            rootThreadId: ROOT,
            jobId: JOB,
            offsets: OFFSETS,
          });
          const reads = again.calls.filter((call) => call.method === "readJobOutput");
          expect(reads).toHaveLength(4);
          expect(reads.slice(2)).toEqual(reads.slice(0, 2));
        }),
      ),
  );

  it.effect("shows truncation, a running job and a final job's exit as M05 supplied them", () =>
    withDevice(
      Effect.gen(function* () {
        const chunks = {
          stdout: {
            stream: "stdout",
            from: 0,
            to: 65536,
            text: "x".repeat(8),
            truncated: true,
            size: 70000,
          },
          stderr: { stream: "stderr", from: 0, to: 0, text: "", truncated: false, size: 0 },
        } as const;
        const fake = fakeBackend({
          output: async (input) => ({
            ok: true,
            value: {
              jobId: JOB,
              state: "failed",
              streams: [chunks[input.args.stream as "stdout" | "stderr"]],
              exit: { code: 2, signal: null },
              livenessIndeterminate: true,
            },
          }),
        });
        expect(
          yield* jobsOutput(fake.backend, yield* actorOf(), {
            rootThreadId: ROOT,
            jobId: JOB,
            offsets: { stdout: 0, stderr: 0 },
          }),
        ).toEqual({
          ok: true,
          value: {
            jobId: JOB,
            state: "failed",
            streams: [chunks.stdout, chunks.stderr],
            exit: { code: 2, signal: null },
            livenessIndeterminate: true,
          },
        });
      }),
    ),
  );

  it.effect(
    "a failure of either stream's read is the whole read's failure: no half of the output is shown as the output",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          for (const failing of ["stdout", "stderr"] as const) {
            const fake = fakeBackend({
              output: async (input) =>
                input.args.stream === failing
                  ? { ok: false, code: "ORCHESTRATION_UNAVAILABLE", detail: "stream unreadable" }
                  : OUTPUT_FOR(input),
            });
            expect(
              yield* jobsOutput(fake.backend, actor, {
                rootThreadId: ROOT,
                jobId: JOB,
                offsets: OFFSETS,
              }),
            ).toEqual({
              ok: false,
              code: "ORCHESTRATION_UNAVAILABLE",
              detail: "stream unreadable",
            });
          }
        }),
      ),
  );

  it.effect("lists the completion outbox's rows without acknowledging anything", () =>
    withDevice(
      Effect.gen(function* () {
        const fake = fakeBackend();
        const reply = yield* jobsOutboxList(fake.backend, yield* actorOf(), { rootThreadId: ROOT });
        // M05's row names its owner; the client's row does not carry it.
        expect(reply).toEqual({ ok: true, value: { rows: [OUTBOX_ROW], unreadable: 0 } });
        expect(reaching(fake.calls)).toEqual([
          { method: "listOutbox", args: [{ caller: USER, args: { rootThreadId: ROOT } }] },
        ]);
      }),
    ),
  );

  it.effect(
    "passes M05's known refusals through and turns an unknown code, a throw or a malformed value into unavailable, never an empty read",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          const run = (options: Options) =>
            jobsList(fakeBackend(options).backend, actor, { rootThreadId: ROOT });
          expect(
            yield* run({
              list: async () => ({
                ok: false,
                code: "ORCHESTRATION_UNAVAILABLE",
                detail: "store unreadable",
              }),
            }),
          ).toEqual({ ok: false, code: "ORCHESTRATION_UNAVAILABLE", detail: "store unreadable" });
          for (const list of [
            async () => ({ ok: false, code: "SOMETHING_NEW" }),
            async () => "nonsense",
            async () => ({ ok: true, value: { jobs: [{ jobId: "x" }] } }),
            async () => {
              throw new Error("boom");
            },
          ])
            expect(yield* run({ list })).toMatchObject({ ok: false, code: "JOBS_UNAVAILABLE" });
          const garbled = yield* jobsOutput(
            fakeBackend({ output: async () => ({ ok: true, value: { jobId: JOB } }) }).backend,
            actor,
            { rootThreadId: ROOT, jobId: JOB, offsets: OFFSETS },
          );
          expect(garbled).toMatchObject({ ok: false, code: "JOBS_UNAVAILABLE" });
          const threw = yield* jobsOutboxList(
            fakeBackend({
              outbox: async () => {
                throw new Error("socket closed");
              },
            }).backend,
            actor,
            { rootThreadId: ROOT },
          );
          expect(threw).toMatchObject({ ok: false, code: "JOBS_UNAVAILABLE" });
          expect(JSON.stringify(threw)).not.toContain("socket closed");
        }),
      ),
  );
});

describe("a job is acted on only if the root's own list shows it", () => {
  it.effect(
    "a job that is not one of the root's is JOBS_NOT_FOUND for the output read and the kill; nothing is read or killed",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          const fake = fakeBackend();
          expect(
            yield* jobsOutput(fake.backend, actor, {
              rootThreadId: ROOT,
              jobId: "job-of-another-root",
              offsets: OFFSETS,
            }),
          ).toMatchObject({ ok: false, code: "JOBS_NOT_FOUND" });
          expect(
            yield* jobsKill(fake.backend, actor, {
              rootThreadId: ROOT,
              jobId: "job-of-another-root",
            }),
          ).toMatchObject({ ok: false, code: "JOBS_NOT_FOUND" });
          expect(fake.calls.filter((c) => ["readJobOutput", "killJob"].includes(c.method))).toEqual(
            [],
          );
          // The membership check is the root's own list, asked once per call.
          expect(fake.calls.filter((c) => c.method === "listJobs")).toHaveLength(2);
        }),
      ),
  );

  it.effect(
    "a list that cannot be had is unavailable for the read and the kill: the job's membership is unproven, so nothing is read or killed",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          for (const list of [
            async () => ({ ok: false, code: "ORCHESTRATION_UNAVAILABLE" }),
            async () => {
              throw new Error("down");
            },
          ]) {
            const fake = fakeBackend({ list });
            expect(
              yield* jobsOutput(fake.backend, actor, {
                rootThreadId: ROOT,
                jobId: JOB,
                offsets: OFFSETS,
              }),
            ).toMatchObject({ ok: false, code: "JOBS_UNAVAILABLE" });
            expect(
              yield* jobsKill(fake.backend, actor, { rootThreadId: ROOT, jobId: JOB }),
            ).toMatchObject({
              ok: false,
              code: "JOBS_UNAVAILABLE",
            });
            expect(
              fake.calls.filter((c) => ["readJobOutput", "killJob"].includes(c.method)),
            ).toEqual([]);
          }
        }),
      ),
  );
});

describe("a kill is exactly one M05 call", () => {
  it.effect("kills a listed job once with the user caller and shows M05's final state", () =>
    withDevice(
      Effect.gen(function* () {
        const fake = fakeBackend();
        const reply = yield* jobsKill(fake.backend, yield* actorOf(), {
          rootThreadId: ROOT,
          jobId: JOB,
          ...({ caller: { user: false } } as object),
        });
        expect(reply).toEqual({ ok: true, value: KILL_VALUE });
        expect(killing(fake.calls)).toEqual([
          {
            method: "killJob",
            args: [{ caller: USER, args: { rootThreadId: ROOT, jobId: JOB } }],
          },
        ]);
      }),
    ),
  );

  it.effect("shows an unconfirmed termination as M05 reported it and never claims more", () =>
    withDevice(
      Effect.gen(function* () {
        const value = { jobId: JOB, state: "lost", terminationUnconfirmed: true };
        const fake = fakeBackend({ kill: async () => ({ ok: true, value }) });
        expect(
          yield* jobsKill(fake.backend, yield* actorOf(), { rootThreadId: ROOT, jobId: JOB }),
        ).toEqual({ ok: true, value });
      }),
    ),
  );

  it.effect(
    "a lost reply is an unknown outcome and the kill is never repeated; an unknown code or a malformed value is unknown too",
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          const threw = fakeBackend({
            kill: async () => {
              throw new Error("socket closed");
            },
          });
          const reply = yield* jobsKill(threw.backend, actor, { rootThreadId: ROOT, jobId: JOB });
          expect(reply).toMatchObject({ ok: false, code: "JOBS_OUTCOME_UNKNOWN" });
          expect(killing(threw.calls)).toHaveLength(1);
          expect(JSON.stringify(reply)).not.toContain("socket closed");
          for (const kill of [
            async () => ({ ok: false, code: "SOMETHING_NEW" }),
            async () => "nonsense",
            async () => ({ ok: true, value: { jobId: JOB, state: "running" } }),
          ]) {
            const fake = fakeBackend({ kill });
            expect(
              yield* jobsKill(fake.backend, actor, { rootThreadId: ROOT, jobId: JOB }),
            ).toMatchObject({ ok: false, code: "JOBS_OUTCOME_UNKNOWN" });
            expect(killing(fake.calls)).toHaveLength(1);
          }
        }),
      ),
  );

  it.effect("passes M05's refusals through with their detail", () =>
    withDevice(
      Effect.gen(function* () {
        const actor = yield* actorOf();
        for (const code of [
          "NOT_AUTHORIZED",
          "JOB_NOT_FOUND",
          "JOB_CONFLICT",
          "JOB_IDENTITY_MISMATCH",
          "ORCHESTRATION_UNAVAILABLE",
        ]) {
          const fake = fakeBackend({ kill: async () => ({ ok: false, code, detail: "why" }) });
          expect(yield* jobsKill(fake.backend, actor, { rootThreadId: ROOT, jobId: JOB })).toEqual({
            ok: false,
            code,
            detail: "why",
          });
        }
      }),
    ),
  );
});

describe("nothing reaches M05 unless the connection may make the call", () => {
  it.effect(
    "a read-only device cannot kill, an operate-only device cannot read; the handler re-checks what T3 checked",
    () =>
      withDevice(
        Effect.gen(function* () {
          const fake = fakeBackend();
          const readOnly = yield* actorOf(READ_ONLY);
          expect(
            yield* jobsKill(fake.backend, readOnly, { rootThreadId: ROOT, jobId: JOB }),
          ).toMatchObject({ ok: false, code: "JOBS_NOT_AUTHORIZED" });
          const operateOnly = yield* actorOf(OPERATE_ONLY);
          for (const reply of [
            yield* jobsList(fake.backend, operateOnly, { rootThreadId: ROOT }),
            yield* jobsOutput(fake.backend, operateOnly, {
              rootThreadId: ROOT,
              jobId: JOB,
              offsets: OFFSETS,
            }),
            yield* jobsOutboxList(fake.backend, operateOnly, { rootThreadId: ROOT }),
          ])
            expect(reply).toMatchObject({ ok: false, code: "JOBS_NOT_AUTHORIZED" });
          expect(fake.calls).toEqual([]);
          // A device with neither scope is refused in the same way, for every method.
          const none = yield* actorOf({ sessionId: "device-1", scopes: [AuthTerminalReadScope] });
          expect(
            yield* jobsKill(fake.backend, none, { rootThreadId: ROOT, jobId: JOB }),
          ).toMatchObject({
            ok: false,
            code: "JOBS_NOT_AUTHORIZED",
          });
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
        // `it.effect` runs on the test clock, which starts at 0: an expiry at 0 is not after "now".
        [
          "expired",
          () => Effect.succeedSome({ revokedAt: null, expiresAt: DateTime.makeUnsafe(0) }),
        ],
      ];
      for (const [label, read] of cases) {
        const fake = fakeBackend();
        yield* withDevice(
          Effect.gen(function* () {
            const actor = yield* actorOf();
            for (const reply of [
              yield* jobsList(fake.backend, actor, { rootThreadId: ROOT }),
              yield* jobsOutput(fake.backend, actor, {
                rootThreadId: ROOT,
                jobId: JOB,
                offsets: OFFSETS,
              }),
              yield* jobsOutboxList(fake.backend, actor, { rootThreadId: ROOT }),
              yield* jobsKill(fake.backend, actor, { rootThreadId: ROOT, jobId: JOB }),
            ])
              expect(reply, label).toMatchObject({ ok: false, code: "JOBS_DEVICE_REVOKED" });
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
          yield* jobsKill(fake.backend, actor, { rootThreadId: ROOT, jobId: JOB }),
        ).toMatchObject({
          ok: false,
          code: "JOBS_UNAVAILABLE",
        });
        expect(yield* jobsList(fake.backend, actor, { rootThreadId: ROOT })).toMatchObject({
          ok: false,
          code: "JOBS_UNAVAILABLE",
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
            // M05 children carry `subagent: null` in the index; the identity record is the proof.
            [
              "child by identity record",
              CHILD,
              { bindings: { [CHILD]: { sessionId: "pi-child", subagent: null } } },
            ],
          ] as const) {
            const fake = fakeBackend(options as Options);
            for (const reply of [
              yield* jobsList(fake.backend, actor, { rootThreadId: root }),
              yield* jobsOutboxList(fake.backend, actor, { rootThreadId: root }),
              yield* jobsKill(fake.backend, actor, { rootThreadId: root, jobId: JOB }),
              yield* jobsOutput(fake.backend, actor, {
                rootThreadId: root,
                jobId: JOB,
                offsets: OFFSETS,
              }),
            ])
              expect(reply, label).toMatchObject({ ok: false, code: "JOBS_NOT_FOUND" });
            expect(reaching(fake.calls), label).toEqual([]);
          }
          for (const options of [
            { corruptThreads: [ROOT] },
            { sessionKinds: { "pi-root": "unavailable" as const } },
            { noInteractions: true },
          ]) {
            const fake = fakeBackend(options);
            expect(
              yield* jobsKill(fake.backend, actor, { rootThreadId: ROOT, jobId: JOB }),
            ).toMatchObject({
              ok: false,
              code: "JOBS_UNAVAILABLE",
            });
            expect(yield* jobsList(fake.backend, actor, { rootThreadId: ROOT })).toMatchObject({
              ok: false,
              code: "JOBS_UNAVAILABLE",
            });
            expect(reaching(fake.calls)).toEqual([]);
          }
        }),
      ),
  );
});

describe("a Backend that cannot serve the call says so", () => {
  it.effect("a stopped Backend, no children service or no direct API is unavailable", () =>
    withDevice(
      Effect.gen(function* () {
        const actor = yield* actorOf();
        for (const options of [{ noOrchestration: true }, { noDirect: true }]) {
          const fake = fakeBackend(options);
          expect(yield* jobsList(fake.backend, actor, { rootThreadId: ROOT })).toMatchObject({
            ok: false,
            code: "JOBS_UNAVAILABLE",
          });
          expect(
            yield* jobsKill(fake.backend, actor, { rootThreadId: ROOT, jobId: JOB }),
          ).toMatchObject({
            ok: false,
            code: "JOBS_UNAVAILABLE",
          });
        }
        expect(yield* jobsList(Option.none(), actor, { rootThreadId: ROOT })).toMatchObject({
          ok: false,
          code: "JOBS_UNAVAILABLE",
        });
      }),
    ),
  );

  it.effect(
    'M05 without the four user calls answers "not connected yet (M05 user read)" for each method and calls nothing',
    () =>
      withDevice(
        Effect.gen(function* () {
          const actor = yield* actorOf();
          const without = ["listJobs", "readJobOutput", "killJob", "listOutbox"] as const;
          const fake = fakeBackend({ without });
          const replies = [
            yield* jobsList(fake.backend, actor, { rootThreadId: ROOT }),
            yield* jobsOutput(fake.backend, actor, {
              rootThreadId: ROOT,
              jobId: JOB,
              offsets: OFFSETS,
            }),
            yield* jobsOutboxList(fake.backend, actor, { rootThreadId: ROOT }),
            yield* jobsKill(fake.backend, actor, { rootThreadId: ROOT, jobId: JOB }),
          ];
          for (const reply of replies)
            expect(reply).toEqual({
              ok: false,
              code: "JOBS_UNAVAILABLE",
              detail: "not connected yet (M05 user read)",
            });
          expect(reaching(fake.calls)).toEqual([]);
          // One missing call stops only the methods that need it: the output read and the kill need the list for membership, the list and the outbox do not need each other.
          const noOutbox = fakeBackend({ without: ["listOutbox"] });
          expect(yield* jobsList(noOutbox.backend, actor, { rootThreadId: ROOT })).toMatchObject({
            ok: true,
          });
          expect(
            yield* jobsOutboxList(noOutbox.backend, actor, { rootThreadId: ROOT }),
          ).toMatchObject({
            ok: false,
            code: "JOBS_UNAVAILABLE",
          });
          const noList = fakeBackend({ without: ["listJobs"] });
          expect(
            yield* jobsOutput(noList.backend, actor, {
              rootThreadId: ROOT,
              jobId: JOB,
              offsets: OFFSETS,
            }),
          ).toMatchObject({ ok: false, code: "JOBS_UNAVAILABLE" });
          expect(
            yield* jobsOutboxList(noList.backend, actor, { rootThreadId: ROOT }),
          ).toMatchObject({ ok: true });
          expect(reaching(noList.calls).map((c) => c.method)).toEqual(["listOutbox"]);
        }),
      ),
  );
});
