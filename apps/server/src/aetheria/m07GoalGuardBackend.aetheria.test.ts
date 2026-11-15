// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
// AETHERIA M07 Plan step 14 (IP-24 extended; DV2, DV8) — the Backend LAYER against the goal-round guard, over the real layer (`makeLayer`, `layer`), the real service and the real recovery layer,
// with T3's event stream, credential store and delivery services replaced by doubles. It shows: a started Backend fills the guard and releases a waiting pass; the slot is NOT emptied when the layer
// closes (so shutdown preparation still answers per thread); a layer that fails, before or during its start, settles the guard with an empty slot (unknown, nothing continued) and the waiting pass
// ends instead of hanging; with no goals configured an ordinary main thread is answered `none` and is continued after restart; the real `layer` and the real recovery layer share ONE guard
// instance through the exported constant; and with no state root there is no guard and no wait. It does NOT show goals in flight through this layer (m07GoalsBackend.aetheria.test.ts shows the
// journal side), T3's full server graph, or a native restart.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { McpProviderSessions } from "@t3tools/provider-core/server/McpProviderSessions";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderRuntimeRecovery from "../orchestration-v2/ProviderRuntimeRecoveryService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Live from "./aetheriaBackend.ts";
import * as GoalRoundGuard from "./goalRoundGuard.ts";

const THREAD = "mcp:6f1c2d3e-0a4b-4c5d-8e9f-a1b2c3d4e5f6";

/** Every state root this file made: each is under the system temp folder and is removed once the file's tests are done. */
const roots: string[] = [];
const makeRoot = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m07-guard-layer-"));
  roots.push(root);
  return root;
};
afterAll(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

const layerSink = Layer.mock(EventSink.EventSinkV2)({
  latestSequence: () => Effect.succeed(0),
  stream: () => Stream.never,
});
const layerMcp = Layer.mock(McpProviderSessions)({ read: () => Effect.sync(() => undefined) });
const layerDelivery = Layer.mergeAll(
  Layer.mock(ThreadManagementService.ThreadManagementService)({}),
  Layer.mock(CommandReceiptStore.CommandReceiptStoreV2)({}),
);
const layerSupplies = Layer.mergeAll(layerSink, layerMcp, layerDelivery);
const withEnv = (env: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env }));
/** The guard supplied from outside, as the recovery layer and `layer` share it through the exported constant. */
const guardLayer = (guard: GoalRoundGuard.GoalRoundGuardShape) =>
  Layer.succeed(GoalRoundGuard.GoalRoundGuard, guard);

const settlesWithin = (guard: GoalRoundGuard.GoalRoundGuardShape) =>
  guard.awaitReady.pipe(
    Effect.as(true),
    Effect.timeoutOption("3 seconds"),
    Effect.map((outcome) => outcome._tag === "Some"),
  );

describe("the Backend layer and the goal-round guard", () => {
  it.live(
    "a started Backend fills the guard, releases the waiting pass, and leaves the slot filled when the layer closes",
    () =>
      Effect.gen(function* () {
        const guard = GoalRoundGuard.makeGoalRoundGuard();
        expect(guard.inFlight("thread-x")).toBe("unknown");
        const scoped = yield* Effect.scoped(
          Layer.build(
            Live.makeLayer(makeRoot()).pipe(
              Layer.provide(guardLayer(guard)),
              Layer.provide(layerSupplies),
            ),
          ).pipe(
            Effect.flatMap((context) =>
              Effect.gen(function* () {
                const service = Context.get(context, Live.AetheriaBackend);
                expect(service.status().phase).toBe("running");
                expect(yield* settlesWithin(guard)).toBe(true);
                // Goals are not configured here (no managed-work services), so no round can exist: an ordinary thread is `none`, not `unknown`.
                expect(guard.inFlight("thread-x")).toBe("none");
                return service;
              }),
            ),
          ),
        );
        expect(scoped.status().phase).toBe("disposed");
        expect(guard.inFlight("thread-x")).toBe("none");
      }),
  );

  it.live(
    "a layer that fails before it can start (T3's delivery services missing) settles the guard EMPTY: the pass ends and the guard answers unknown",
    () =>
      Effect.gen(function* () {
        const guard = GoalRoundGuard.makeGoalRoundGuard();
        const waiting = yield* Effect.forkChild(settlesWithin(guard));
        const exit = yield* Effect.exit(
          Effect.scoped(
            Layer.build(
              Live.makeLayer(makeRoot()).pipe(
                Layer.provide(guardLayer(guard)),
                Layer.provide(Layer.mergeAll(layerSink, layerMcp)),
              ),
            ),
          ),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        expect(yield* Fiber.join(waiting)).toBe(true);
        expect(guard.inFlight("thread-x")).toBe("unknown");
      }),
  );

  it.live(
    "a Backend that does not start (its state root is a file, so the owner lock cannot be taken) settles the guard EMPTY and fails the layer",
    () =>
      Effect.gen(function* () {
        const guard = GoalRoundGuard.makeGoalRoundGuard();
        const notADirectory = NodePath.join(makeRoot(), "state-root-file");
        NodeFS.writeFileSync(notADirectory, "x");
        const waiting = yield* Effect.forkChild(settlesWithin(guard));
        const exit = yield* Effect.exit(
          Effect.scoped(
            Layer.build(
              Live.makeLayer(notADirectory).pipe(
                Layer.provide(guardLayer(guard)),
                Layer.provide(layerSupplies),
              ),
            ),
          ),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        expect(yield* Fiber.join(waiting)).toBe(true);
        expect(guard.inFlight("thread-x")).toBe("unknown");
      }),
  );

  it.live("a bare layer with no guard service installs nothing and waits for nothing", () =>
    Effect.gen(function* () {
      const service = yield* Effect.scoped(
        Layer.build(Live.makeLayer(makeRoot()).pipe(Layer.provide(layerSupplies))).pipe(
          Effect.map((context) => Context.get(context, Live.AetheriaBackend)),
        ),
      );
      expect(service.status().phase).toBe("disposed");
    }),
  );
});

describe("the real server pieces together: `layer`, the real recovery layer, one shared guard", () => {
  const thread = ThreadId.make(THREAD);
  const commits: Array<Parameters<EventSink.EventSinkV2["Service"]["commitCommand"]>[0]> = [];
  const recoveryOverMocks = (
    run: (
      id: ThreadId,
    ) => ReturnType<ProjectionStore.ProjectionStoreV2["Service"]["getRuntimeRecoveryProjection"]>,
  ) =>
    ProviderRuntimeRecovery.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getRecoveryThreadIds: () => Effect.succeed([thread]),
            getRuntimeRecoveryProjection: run,
          }),
          Layer.mock(EventSink.EventSinkV2)({
            commitCommand: (input) => {
              commits.push(input);
              return Effect.succeed({ committed: true, cancelledEffectCount: 1 } as never);
            },
            writeWithEffects: ((input: (typeof commits)[number]) => {
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

  // A minimal main thread whose run was cut: the pass would continue it.
  const cutRun = (id: ThreadId) =>
    Effect.succeed({
      thread: {
        id,
        projectId: ProjectId.make("m07-project"),
        providerInstanceId: "codex",
        archivedAt: null,
        deletedAt: null,
        lineage: { parentThreadId: null, relationshipToParent: null },
        forkedFrom: null,
      },
      runs: [
        {
          id: "run:1",
          ordinal: 1,
          providerInstanceId: "codex",
          modelSelection: { instanceId: "codex", model: "gpt-6" },
          providerThreadId: "pt:1",
          activeAttemptId: "attempt:1",
          status: "running",
          requestedAt: DateTime.makeUnsafe("2026-11-15T12:00:00.000Z"),
          completedAt: null,
        },
      ],
      providerThreads: [
        {
          id: "pt:1",
          appThreadId: id,
          ownerNodeId: null,
          driver: "codex",
          providerInstanceId: "codex",
          providerSessionId: "ps:1",
          nativeThreadRef: { driver: "codex", nativeId: "n", strength: "strong" },
          status: "active",
        },
      ],
      providerSessions: [
        { id: "ps:1", driver: "codex", providerInstanceId: "codex", status: "running" },
      ],
      providerTurns: [
        { id: "turn:1", providerThreadId: "pt:1", runAttemptId: "attempt:1", status: "running" },
      ],
      runtimeRequests: [],
      attempts: [],
      nodes: [],
      subagents: [],
      messages: [],
      turnItems: [],
    } as never);

  const continued = () =>
    commits.flatMap((commit) =>
      (commit.effects ?? [])
        .filter(
          (effect) =>
            (effect as { request?: { type?: string } }).request?.type ===
            "provider-runtime.continue",
        )
        .map((effect) => String((effect as { threadId?: unknown }).threadId)),
    );

  it.live(
    "with the state root set, the recovery pass waits for `layer`'s Backend, then an ordinary main thread (no goals configured) IS continued after restart",
    () =>
      Effect.gen(function* () {
        commits.length = 0;
        // The third member only exposes the guard the other two already share: layers memoize by reference, so it is the very instance `layer` fills and the recovery layer waits on.
        const graph = Layer.mergeAll(
          Live.layer,
          recoveryOverMocks(cutRun),
          GoalRoundGuard.layerWhenAetheria,
        ).pipe(
          Layer.provide(layerSupplies),
          Layer.provide(withEnv({ AETHERIA_STATE_ROOT: makeRoot() })),
        );
        yield* Effect.scoped(
          Layer.build(graph).pipe(
            Effect.flatMap((context) =>
              Effect.gen(function* () {
                const recovery = Context.get(
                  context,
                  ProviderRuntimeRecovery.ProviderRuntimeRecoveryService,
                );
                const guard = Context.get(context, GoalRoundGuard.GoalRoundGuard);
                expect(yield* settlesWithin(guard)).toBe(true);
                expect(guard.inFlight(THREAD)).toBe("none");
                yield* recovery.reconcile("startup");
                expect(continued()).toEqual([THREAD]);
              }),
            ),
          ),
        );
      }),
  );

  it.live(
    "with no state root there is no guard and no wait: the same pass continues the thread as upstream T3 does",
    () =>
      Effect.gen(function* () {
        commits.length = 0;
        const graph = Layer.mergeAll(
          recoveryOverMocks(cutRun),
          GoalRoundGuard.layerWhenAetheria,
        ).pipe(Layer.provide(layerSupplies), Layer.provide(withEnv({})));
        yield* Effect.scoped(
          Layer.build(graph).pipe(
            Effect.flatMap((context) =>
              Effect.gen(function* () {
                expect(Context.getOption(context, GoalRoundGuard.GoalRoundGuard)._tag).toBe("None");
                const recovery = Context.get(
                  context,
                  ProviderRuntimeRecovery.ProviderRuntimeRecoveryService,
                );
                yield* recovery.reconcile("startup");
                expect(continued()).toEqual([THREAD]);
              }),
            ),
          ),
        );
      }),
  );
});
