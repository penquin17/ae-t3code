// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M05 Plan step 2 (D9, D19 seam b, R2) — child restart probe. A mechanism probe, not an M05 feature.
//
// Question. With `continueThreadsAfterServerUpdate` on, does T3 re-run a running child or fork run after a restart (startup reconcile) or arrange
// to at graceful shutdown (prepareForShutdown), while a running main thread keeps its continuation? And with the child's continuation suppressed,
// does T3 still write a `RestartCancelledBackgroundWork` note for the parent that names the app-owned child (which decides whether M05's step 13
// sends its own outbox notice)?
//
// Boundary. The real ProviderRuntimeRecoveryService.reconcile("startup") and .prepareForShutdown over projections supplied by a mocked
// ProjectionStore, a mocked EventSink that records what is committed or written, the real ServerSettings test service and the real IdAllocator
// (the layout ProviderRuntimeRecoveryService.test.ts uses). No provider, no Pi, no model. The projections are hand-built running threads that meet
// restartContinuationRun's preconditions (a started run, an active strong provider thread, a ready session, a running provider turn).
//
// Shows: for a main thread, a `subagent` child and a `fork` thread, each with a running run, whether a `provider-runtime.continue` effect is
// committed (startup) or written (shutdown); and which `run.background-work-cancelled` notes the same pass writes for a parent whose running run
// holds an app-owned subagent item, against a control parent holding a provider-native subagent item.
// Does NOT show: the effect worker acting on a continue effect, T3's note delivery to the agent at the next turn (ProviderTurnStartService), a
// real database projection, or any behaviour of a real provider after restart.
import { assert, it } from "@effect/vitest";
import {
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderRuntimeRecovery from "../orchestration-v2/ProviderRuntimeRecoveryService.ts";
import * as ServerSettings from "../serverSettings.ts";

const driver = ProviderDriverKind.make("pi");
const instanceId = ProviderInstanceId.make("pi");
const projectId = ProjectId.make("project:child-restart-probe");

type Relationship = "subagent" | "fork" | null;

/** A running thread that restartContinuationRun accepts: started run, active strong provider thread, ready session, running provider turn. */
const runningThread = (
  name: string,
  relationship: Relationship,
  now: DateTime.Utc,
  extras: {
    readonly subagentOrigin?: "app_owned" | "provider_native";
    readonly childOf?: ThreadId;
  } = {},
) => {
  const threadId = ThreadId.make(`thread:${name}`);
  const runId = RunId.make(`run:${name}`);
  const attemptId = RunAttemptId.make(`attempt:${name}`);
  const providerThreadId = ProviderThreadId.make(`provider-thread:${name}`);
  const sessionId = ProviderSessionId.make(`session:${name}`);
  const subagentNodeId = NodeId.make(`node:${name}:subagent`);
  const subagentItem =
    extras.subagentOrigin === undefined
      ? []
      : [
          {
            id: TurnItemId.make(`item:${name}:subagent`),
            threadId,
            runId,
            nodeId: subagentNodeId,
            providerThreadId,
            type: "subagent",
            status: "running",
            subagentId: subagentNodeId,
            origin: extras.subagentOrigin,
            childThreadId:
              extras.subagentOrigin === "app_owned" ? ThreadId.make("thread:child-a") : null,
            providerInstanceId: instanceId,
            title: `subagent of ${name}`,
          },
        ];
  const projection = {
    thread: {
      id: threadId,
      projectId,
      providerInstanceId: instanceId,
      archivedAt: null,
      deletedAt: null,
      settledOverride: null,
      snoozedUntil: null,
      lineage: {
        parentThreadId: extras.childOf ?? null,
        relationshipToParent: relationship,
        rootThreadId: extras.childOf ?? threadId,
      },
    },
    runtimeRequests: [],
    providerSessions: [{ id: sessionId, driver, providerInstanceId: instanceId, status: "ready" }],
    providerThreads: [
      {
        id: providerThreadId,
        appThreadId: threadId,
        driver,
        providerInstanceId: instanceId,
        providerSessionId: sessionId,
        ownerNodeId: null,
        status: "active",
        nativeThreadRef: { driver, nativeId: `/pi/${name}.jsonl`, strength: "strong" },
        pendingBackgroundTasks: [],
      },
    ],
    providerTurns: [
      {
        id: ProviderTurnId.make(`turn:${name}`),
        providerThreadId,
        runAttemptId: attemptId,
        nodeId: NodeId.make(`node:${name}:root`),
        status: "running",
      },
    ],
    runs: [
      {
        id: runId,
        threadId,
        ordinal: 1,
        status: "running",
        providerThreadId,
        providerInstanceId: instanceId,
        activeAttemptId: attemptId,
        rootNodeId: NodeId.make(`node:${name}:root`),
        requestedAt: now,
        startedAt: now,
        completedAt: null,
      },
    ],
    attempts: [],
    nodes: [],
    subagents:
      extras.subagentOrigin === undefined
        ? []
        : [
            {
              id: subagentNodeId,
              runId,
              origin: extras.subagentOrigin,
              childThreadId:
                extras.subagentOrigin === "app_owned" ? ThreadId.make("thread:child-a") : null,
              driver,
              providerInstanceId: instanceId,
              status: "running",
            },
          ],
    messages: [],
    turnItems: subagentItem,
  } as unknown as OrchestrationV2ThreadProjection;
  return { threadId, runId, projection };
};

interface Observed {
  readonly continued: Set<string>;
  readonly notes: Map<string, Array<ReadonlyArray<unknown>>>;
  readonly cancelledRuns: Set<string>;
}

/** Runs one recovery pass over the threads and reports what was committed (startup) or written (shutdown). */
const observe = (
  trigger: "startup" | "shutdown",
  threads: ReadonlyArray<ReturnType<typeof runningThread>>,
) =>
  Effect.gen(function* () {
    const seen: Observed = { continued: new Set(), notes: new Map(), cancelledRuns: new Set() };
    const projections = new Map(threads.map((t) => [t.threadId, t.projection] as const));
    const record = (
      events: ReadonlyArray<{ type: string; payload?: unknown }>,
      effects: ReadonlyArray<{ threadId: string; request: { type: string } }>,
    ) => {
      for (const effect of effects)
        if (effect.request.type === "provider-runtime.continue")
          seen.continued.add(effect.threadId);
      for (const event of events) {
        const threadId = (event as unknown as { threadId: string }).threadId;
        const payload = event.payload as {
          restartCancelledBackgroundWork?: ReadonlyArray<unknown>;
          id?: string;
          status?: string;
        };
        if (event.type === "run.background-work-cancelled")
          seen.notes.set(threadId, [
            ...(seen.notes.get(threadId) ?? []),
            payload.restartCancelledBackgroundWork ?? [],
          ]);
        if (event.type === "run.updated" && payload.status === "cancelled")
          seen.cancelledRuns.add(threadId);
      }
    };
    const layer = ProviderRuntimeRecovery.layer.pipe(
      Layer.provide(ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true })),
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getRecoveryThreadIds: () => Effect.succeed(threads.map((t) => t.threadId)),
            getRuntimeRecoveryProjection: (threadId) =>
              Effect.succeed(projections.get(threadId) as never),
          }),
          Layer.mock(EventSink.EventSinkV2)({
            commitCommand: (input) => {
              record(input.events as never, (input.effects ?? []) as never);
              return Effect.succeed({ committed: true, cancelledEffectCount: 0 } as never);
            },
            writeWithEffects: (input) => {
              record((input.events ?? []) as never, (input.effects ?? []) as never);
              return Effect.succeed({} as never);
            },
          }),
          IdAllocator.layer,
          Layer.mock(EffectWorker.OrchestrationEffectWorkerV2)({
            runRecoveryOnce: Effect.succeed(false),
          }),
          Layer.mock(EffectOutbox.EffectOutboxV2)({
            listByCommandId: () => Effect.succeed([]),
            cancelUnsettled: () => Effect.succeed([]),
            signalCancellations: () => Effect.void,
            reconcileAfterProcessLoss: Effect.succeed({ requeued: 0, cancelled: 0 }),
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const service = yield* ProviderRuntimeRecovery.ProviderRuntimeRecoveryService;
      if (trigger === "startup") yield* service.reconcile("startup");
      else yield* service.prepareForShutdown;
    }).pipe(Effect.provide(layer));
    return seen;
  });

const world = Effect.gen(function* () {
  const now = yield* DateTime.now;
  const main = runningThread("main", null, now);
  const child = runningThread("child-a", "subagent", now, { childOf: main.threadId });
  const fork = runningThread("fork-a", "fork", now, { childOf: main.threadId });
  // A parent whose running run holds an app-owned subagent item for child-a (the shape delegate_task leaves), and a control parent whose item is a
  // provider-native subagent, which T3 does record in its restart note.
  const parent = runningThread("parent", null, now, { subagentOrigin: "app_owned" });
  const control = runningThread("native-parent", null, now, { subagentOrigin: "provider_native" });
  return { main, child, fork, parent, control };
});

it.effect(
  "startup: a running main thread continues; a running subagent child and a fork do not",
  () =>
    Effect.gen(function* () {
      const { main, child, fork } = yield* world;
      const seen = yield* observe("startup", [main, child, fork]);
      // Every running run is cut by the restart, child or not.
      assert.deepEqual(
        [...seen.cancelledRuns].sort(),
        [main.threadId, child.threadId, fork.threadId].sort(),
      );
      // The main thread keeps T3's continuation; a child (lineage subagent) and a fork get none.
      assert.deepEqual([...seen.continued].sort(), [main.threadId]);
    }),
);

it.effect(
  "shutdown: a running main thread is prepared for continuation; a subagent child and a fork are not",
  () =>
    Effect.gen(function* () {
      const { main, child, fork } = yield* world;
      const seen = yield* observe("shutdown", [main, child, fork]);
      assert.deepEqual([...seen.continued].sort(), [main.threadId]);
    }),
);

it.effect(
  "restart note: T3 writes none for an app-owned child, with or without child continuation, but does for a native subagent",
  () =>
    Effect.gen(function* () {
      const { parent, control, child } = yield* world;
      const seen = yield* observe("startup", [parent, control, child]);
      // The control proves the harness can see a note: a provider-native subagent item in a cut run is recorded for the parent.
      assert.isAbove((seen.notes.get(control.threadId) ?? []).length, 0);
      // Observed result that decides step 13: nothing names the app-owned child, on the parent or on the child itself.
      assert.deepEqual(seen.notes.get(parent.threadId) ?? [], []);
      assert.deepEqual(seen.notes.get(child.threadId) ?? [], []);
      // And the parent's own continuation is unchanged by the child rule.
      assert.isTrue(seen.continued.has(parent.threadId));
      assert.isFalse(seen.continued.has(child.threadId));
    }),
);
