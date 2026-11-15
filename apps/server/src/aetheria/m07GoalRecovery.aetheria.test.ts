// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M07 Plan step 14 (IP-24 extended; DV2, N1) — T3's REAL ProviderRuntimeRecoveryService (`make`, `reconcile("startup")`, `prepareForShutdown`) with continuation enabled, over the same mocked
// projection, event-sink, worker and outbox layers its own tests use, now WITH the optional goal-round guard service. It shows: with no guard registered (bare T3) a main thread is continued
// at startup and prepared at shutdown exactly as before; a guard that answers `in-flight`, `unknown` (the slot is empty or the predicate cannot answer) or throws suppresses both; a guard that
// answers `none` leaves an ordinary main thread unchanged; the guard is per thread; and a child stays excluded whatever the guard says. It does NOT show the Backend filling the slot from the
// goal journal (m07GoalsBackend.aetheria.test.ts), T3's real startup ordering in the full server graph, or a native restart.
import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";

import * as GoalRoundGuard from "./goalRoundGuard.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderRuntimeRecovery from "../orchestration-v2/ProviderRuntimeRecoveryService.ts";

const goalThread = ThreadId.make("thread:m07-goal-main");
const ordinaryThread = ThreadId.make("thread:m07-ordinary-main");
const runId = RunId.make("run:m07-round");
const instanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const providerThreadId = ProviderThreadId.make("provider-thread:m07");
const sessionId = ProviderSessionId.make("session:m07");
const attemptId = RunAttemptId.make("attempt:m07");
const now = DateTime.makeUnsafe("2026-11-15T12:00:00.000Z");

const projectionOf = (threadId: ThreadId, relationship: "subagent" | "fork" | null) =>
  ({
    thread: {
      id: threadId,
      projectId: ProjectId.make("m07-project"),
      providerInstanceId: instanceId,
      archivedAt: null,
      deletedAt: null,
      lineage: {
        parentThreadId: relationship === null ? null : "thread:parent",
        relationshipToParent: relationship,
      },
      forkedFrom: null,
    },
    runs: [
      {
        id: runId,
        ordinal: 7,
        providerInstanceId: instanceId,
        modelSelection: { instanceId, model: "gpt-6" },
        providerThreadId,
        activeAttemptId: attemptId,
        status: "running",
        requestedAt: now,
        completedAt: null,
      },
    ],
    providerThreads: [
      {
        id: providerThreadId,
        appThreadId: threadId,
        ownerNodeId: null,
        driver,
        providerInstanceId: instanceId,
        providerSessionId: sessionId,
        nativeThreadRef: { driver, nativeId: "native-thread", strength: "strong" },
        status: "active",
      },
    ],
    providerSessions: [
      { id: sessionId, driver, providerInstanceId: instanceId, status: "running" },
    ],
    providerTurns: [
      {
        id: ProviderTurnId.make("turn:m07"),
        providerThreadId,
        runAttemptId: attemptId,
        status: "running",
      },
    ],
    runtimeRequests: [],
    attempts: [],
    nodes: [],
    subagents: [],
    messages: [],
    turnItems: [],
  }) as unknown as OrchestrationV2ThreadProjection;

type Commit = Parameters<EventSink.EventSinkV2["Service"]["commitCommand"]>[0];

const recoveryFor = (
  threads: ReadonlyArray<readonly [ThreadId, "subagent" | "fork" | null]>,
  commits: Commit[],
  guard: GoalRoundGuard.GoalRoundGuardShape | undefined,
) =>
  ProviderRuntimeRecovery.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getRecoveryThreadIds: () => Effect.succeed(threads.map(([id]) => id)),
          getRuntimeRecoveryProjection: (id: ThreadId) =>
            Effect.succeed(
              projectionOf(id, threads.find(([candidate]) => candidate === id)?.[1] ?? null),
            ),
        }),
        Layer.mock(EventSink.EventSinkV2)({
          commitCommand: (input) => {
            commits.push(input);
            return Effect.succeed({ committed: true, cancelledEffectCount: 1 } as never);
          },
          writeWithEffects: ((input: Commit) => {
            commits.push(input);
            return Effect.succeed({} as never);
          }) as never,
        }),
        IdAllocator.layer,
        Layer.mock(EffectWorker.OrchestrationEffectWorkerV2)({
          runRecoveryOnce: Effect.succeed(false),
        }),
        Layer.mock(EffectOutbox.EffectOutboxV2)({
          reconcileAfterProcessLoss: Effect.succeed({ requeued: 0, cancelled: 0 }),
        }),
        guard === undefined ? Layer.empty : Layer.succeed(GoalRoundGuard.GoalRoundGuard, guard),
      ),
    ),
  );

const continuedThreads = (commits: readonly Commit[]) =>
  commits.flatMap((commit) =>
    (commit.effects ?? [])
      .filter(
        (effect) =>
          (effect as { request?: { type?: string } }).request?.type === "provider-runtime.continue",
      )
      .map((effect) => String((effect as { threadId?: unknown }).threadId)),
  );

const guardWith = (predicate: GoalRoundGuard.GoalRoundPredicate | undefined) => {
  const guard = GoalRoundGuard.makeGoalRoundGuard();
  // No predicate: the Backend layer ended without filling the slot (DV8), so the pass is released and the empty slot answers `unknown`.
  if (predicate !== undefined) guard.install(predicate);
  else guard.settle();
  return guard;
};

const startup = (
  threads: ReadonlyArray<readonly [ThreadId, "subagent" | "fork" | null]>,
  guard: GoalRoundGuard.GoalRoundGuardShape | undefined,
) =>
  Effect.gen(function* () {
    const commits: Commit[] = [];
    yield* (yield* recoveryFor(threads, commits, guard)).reconcile("startup");
    return continuedThreads(commits);
  });

const shutdown = (
  threads: ReadonlyArray<readonly [ThreadId, "subagent" | "fork" | null]>,
  guard: GoalRoundGuard.GoalRoundGuardShape | undefined,
) =>
  Effect.gen(function* () {
    const commits: Commit[] = [];
    yield* (yield* recoveryFor(threads, commits, guard)).prepareForShutdown;
    return commits.length;
  });

it.effect(
  "with no guard registered (bare T3) a main thread is continued at startup and prepared at shutdown, unchanged",
  () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* startup([[goalThread, null]], undefined), [goalThread]);
      assert.isAbove(yield* shutdown([[goalThread, null]], undefined), 0);
    }),
);

it.effect(
  "a goal round in flight, an answer the guard cannot give, an empty slot and a throwing predicate are each NOT continued and NOT prepared (fail closed)",
  () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [string, GoalRoundGuard.GoalRoundPredicate | undefined]> =
        [
          ["in-flight", () => "in-flight"],
          ["unknown", () => "unknown"],
          ["empty slot", undefined],
          [
            "throws",
            () => {
              throw new Error("journal unreadable");
            },
          ],
        ];
      for (const [name, predicate] of cases) {
        assert.deepEqual(yield* startup([[goalThread, null]], guardWith(predicate)), [], name);
        assert.equal(yield* shutdown([[goalThread, null]], guardWith(predicate)), 0, name);
      }
    }),
);

it.effect(
  "the guard is per thread: an ordinary main thread beside a goal thread is continued, the goal thread is not; `none` changes nothing",
  () =>
    Effect.gen(function* () {
      const guard = guardWith((threadId) => (threadId === goalThread ? "in-flight" : "none"));
      const threads = [
        [goalThread, null],
        [ordinaryThread, null],
      ] as const;
      assert.deepEqual(yield* startup(threads, guard), [ordinaryThread]);
      assert.deepEqual(
        yield* startup(
          [[ordinaryThread, null]],
          guardWith(() => "none"),
        ),
        [ordinaryThread],
      );
      assert.isAbove(
        yield* shutdown(
          [[ordinaryThread, null]],
          guardWith(() => "none"),
        ),
        0,
      );
    }),
);

it.effect(
  "a child stays excluded whatever the guard says, and the guard is not consulted to include it",
  () =>
    Effect.gen(function* () {
      for (const relationship of ["subagent", "fork"] as const) {
        assert.deepEqual(
          yield* startup(
            [[goalThread, relationship]],
            guardWith(() => "none"),
          ),
          [],
        );
        assert.equal(
          yield* shutdown(
            [[goalThread, relationship]],
            guardWith(() => "none"),
          ),
          0,
        );
      }
    }),
);

it("the guard slot: install fills it, the returned release empties only its own predicate, and a predicate that returns anything else is unknown", () => {
  const guard = GoalRoundGuard.makeGoalRoundGuard();
  assert.equal(guard.inFlight("t"), "unknown", "not filled yet");
  const releaseA = guard.install(() => "none");
  assert.equal(guard.inFlight("t"), "none");
  const releaseB = guard.install(() => "in-flight");
  releaseA(); // an older release must not empty a newer predicate
  assert.equal(guard.inFlight("t"), "in-flight");
  releaseB();
  assert.equal(guard.inFlight("t"), "unknown", "emptied before the Backend drains");
  guard.install((() => "maybe") as never);
  assert.equal(guard.inFlight("t"), "unknown");
});

// Startup order (DV8): T3's startup fiber runs the recovery pass before the Backend layer is built. The guard's `awaitReady` is what orders them: the pass waits for the Backend to fill the slot, or for the Backend
// layer to end without filling it. These cases drive the REAL recovery service against the REAL guard and the real shared layer constant; the Backend layer itself (its start, its failure, its
// teardown) is shown in aetheriaBackend.aetheria.test.ts. They do not show the full server graph.
const settleSoon = Effect.gen(function* () {
  for (let i = 0; i < 30; i++) yield* Effect.yieldNow;
});

it.effect(
  "the startup pass WAITS for the Backend: nothing is decided while the slot is unfilled, then an ordinary main thread is continued and a goal thread is not",
  () =>
    Effect.gen(function* () {
      const commits: Commit[] = [];
      const guard = GoalRoundGuard.makeGoalRoundGuard();
      const recovery = yield* recoveryFor(
        [
          [goalThread, null],
          [ordinaryThread, null],
        ],
        commits,
        guard,
      );
      const pass = yield* Effect.forkChild(recovery.reconcile("startup"));
      yield* settleSoon;
      assert.deepEqual(
        continuedThreads(commits),
        [],
        "nothing is continued before the Backend is ready",
      );
      assert.equal(commits.length, 0, "and nothing at all is committed");
      guard.install((threadId) => (threadId === goalThread ? "in-flight" : "none"));
      yield* Fiber.join(pass);
      assert.deepEqual(continuedThreads(commits), [ordinaryThread]);
    }),
);

it.effect(
  "a Backend that ends WITHOUT filling the slot releases the pass, which then continues nothing (unknown) and never hangs; a later shutdown preparation is suppressed too",
  () =>
    Effect.gen(function* () {
      const commits: Commit[] = [];
      const guard = GoalRoundGuard.makeGoalRoundGuard();
      const recovery = yield* recoveryFor([[ordinaryThread, null]], commits, guard);
      const pass = yield* Effect.forkChild(recovery.reconcile("startup"));
      yield* settleSoon;
      assert.equal(commits.length, 0);
      guard.settle();
      yield* Fiber.join(pass);
      assert.deepEqual(continuedThreads(commits), []);
      const afterStartup = commits.length; // the pass still finishes its own bookkeeping (terminalizing the cut run); it only continues nothing
      yield* recovery.prepareForShutdown;
      assert.equal(commits.length, afterStartup, "shutdown preparation prepares no thread either");
      guard.settle(); // idempotent
    }),
);

it.effect("settling after the slot was filled changes nothing: the installed answers stand", () =>
  Effect.gen(function* () {
    const guard = GoalRoundGuard.makeGoalRoundGuard();
    guard.install(() => "none");
    guard.settle();
    assert.equal(guard.inFlight("t"), "none");
    assert.deepEqual(yield* startup([[ordinaryThread, null]], guard), [ordinaryThread]);
  }),
);

it.effect(
  "the shutdown preparation still answers per thread after the Backend released everything but the slot: the journal answers, not an emptied slot",
  () =>
    Effect.gen(function* () {
      // The Backend layer installs once and never empties the slot at scope close (aetheriaBackend.ts): a predicate that reads a journal keeps answering after the service drained.
      const guard = guardWith((threadId) => (threadId === goalThread ? "in-flight" : "none"));
      assert.isAbove(yield* shutdown([[ordinaryThread, null]], guard), 0);
      assert.equal(yield* shutdown([[goalThread, null]], guard), 0);
    }),
);

const recoveryLayerWith = (commits: Commit[], threads: ReadonlyArray<readonly [ThreadId, null]>) =>
  ProviderRuntimeRecovery.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getRecoveryThreadIds: () => Effect.succeed(threads.map(([id]) => id)),
          getRuntimeRecoveryProjection: (id: ThreadId) => Effect.succeed(projectionOf(id, null)),
        }),
        Layer.mock(EventSink.EventSinkV2)({
          commitCommand: (input) => {
            commits.push(input);
            return Effect.succeed({ committed: true, cancelledEffectCount: 1 } as never);
          },
          writeWithEffects: ((input: Commit) => {
            commits.push(input);
            return Effect.succeed({} as never);
          }) as never,
        }),
        IdAllocator.layer,
        Layer.mock(EffectWorker.OrchestrationEffectWorkerV2)({
          runRecoveryOnce: Effect.succeed(false),
        }),
        Layer.mock(EffectOutbox.EffectOutboxV2)({
          reconcileAfterProcessLoss: Effect.succeed({ requeued: 0, cancelled: 0 }),
        }),
      ),
    ),
  );

const withEnv = (env: Record<string, string>) =>
  Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env }));

it.effect(
  "with AETHERIA_STATE_ROOT set, the recovery layer and the Backend side receive the SAME guard instance from the shared layer constant; the pass waits for it",
  () =>
    Effect.gen(function* () {
      const commits: Commit[] = [];
      // The merge stands for the server graph: the recovery layer provides the constant to itself, and the Backend layer provides the same constant to its own build.
      const graph = Layer.mergeAll(
        recoveryLayerWith(commits, [[ordinaryThread, null]]),
        GoalRoundGuard.layerWhenAetheria,
      ).pipe(Layer.provide(withEnv({ AETHERIA_STATE_ROOT: "/state" })));
      const context = yield* Layer.build(graph);
      const guard = Context.get(context, GoalRoundGuard.GoalRoundGuard);
      const recovery = Context.get(context, ProviderRuntimeRecovery.ProviderRuntimeRecoveryService);
      const pass = yield* Effect.forkChild(recovery.reconcile("startup"));
      yield* settleSoon;
      assert.equal(
        commits.length,
        0,
        "the recovery pass is waiting on the guard the Backend side holds",
      );
      guard.install(() => "none");
      yield* Fiber.join(pass);
      assert.deepEqual(continuedThreads(commits), [ordinaryThread]);
    }).pipe(Effect.scoped),
);

it.effect(
  "without AETHERIA_STATE_ROOT there is no guard and the real recovery layer waits for nothing: an ordinary main thread is continued as in upstream T3",
  () =>
    Effect.gen(function* () {
      const commits: Commit[] = [];
      const graph = Layer.mergeAll(
        recoveryLayerWith(commits, [[ordinaryThread, null]]),
        GoalRoundGuard.layerWhenAetheria,
      ).pipe(Layer.provide(withEnv({})));
      const context = yield* Layer.build(graph);
      assert.isTrue(Option.isNone(Context.getOption(context, GoalRoundGuard.GoalRoundGuard)));
      const recovery = Context.get(context, ProviderRuntimeRecovery.ProviderRuntimeRecoveryService);
      yield* recovery.reconcile("startup");
      assert.deepEqual(continuedThreads(commits), [ordinaryThread]);
      yield* recovery.prepareForShutdown;
    }).pipe(Effect.scoped),
);
