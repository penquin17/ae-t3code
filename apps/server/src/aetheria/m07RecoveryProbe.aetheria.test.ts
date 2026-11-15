// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M07 Plan step 3 (T3 half) — probe of IP-24: does anything today stop T3's restart pass from continuing a MAIN thread whose goal round was cut?
//
// Boundary: T3's REAL ProviderRuntimeRecoveryService (`make`, `reconcile("startup")` and `prepareForShutdown`) with continuation enabled, over mocked projection, event-sink, worker and outbox
// layers (the same layers the service's own tests mock). The mock set is exactly the service's requirements: no goal or M07 service is among them. It shows, as facts about the tree at fork 5bd72c71:
//   (1) a main thread with an unfinished run IS continued at startup (a `provider-runtime.continue` effect is committed) and IS prepared for continuation at shutdown;
//   (2) subagent and fork threads are not (IP-24 as built, `isChildLineage`);
//   (3) the service has no injection point a persisted M07 running-round predicate could answer through: `make` runs with no such service, and the only inputs that exclude a thread are
//       its lineage and the settings. So "a predicate available before the pass, fail closed on unreadable" is NOT satisfied by the tree as it stands — the exact finding step 3 must return.
// It does NOT show: T3's real startup ordering against the Backend composition (apps/server wiring, serverRuntimeStartup.ts), a native restart, or any M07 code (none exists yet). A
// recovery pass that skipped a goal round would be a SEPARATE green test once the predicate exists; this file records the red.
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
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";

import * as ServerSettings from "../serverSettings.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderRuntimeRecovery from "../orchestration-v2/ProviderRuntimeRecoveryService.ts";

const threadId = ThreadId.make("thread:m07-goal-main");
const runId = RunId.make("run:m07-goal-round");
const instanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const providerThreadId = ProviderThreadId.make("provider-thread:m07");
const sessionId = ProviderSessionId.make("session:m07");
const attemptId = RunAttemptId.make("attempt:m07");
const now = DateTime.makeUnsafe("2026-11-15T12:00:00.000Z");

const projectionOf = (relationship: "subagent" | "fork" | null) =>
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

/** The recovery service built over exactly the layers its own tests mock — nothing from M07 can be among them, because `make` takes no such service. */
const recoveryFor = (relationship: "subagent" | "fork" | null, commits: Commit[]) =>
  ProviderRuntimeRecovery.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getRecoveryThreadIds: () => Effect.succeed([threadId]),
          getRuntimeRecoveryProjection: () => Effect.succeed(projectionOf(relationship)),
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

const continues = (commits: readonly Commit[]) =>
  commits.flatMap((commit) =>
    (commit.effects ?? []).filter(
      (effect) =>
        (effect as { request?: { type?: string } }).request?.type === "provider-runtime.continue",
    ),
  );

it.effect(
  "startup: a main thread whose run was cut is continued today — nothing can ask M07 first (the hazard, N1)",
  () =>
    Effect.gen(function* () {
      const commits: Commit[] = [];
      const recovery = yield* recoveryFor(null, commits);
      yield* recovery.reconcile("startup");
      assert.lengthOf(continues(commits), 1, "a main thread is continued at startup");
    }),
);

it.effect(
  "startup: subagent and fork threads are not continued (IP-24 as built) — the ONLY exclusions are lineage and settings",
  () =>
    Effect.gen(function* () {
      for (const relationship of ["subagent", "fork"] as const) {
        const commits: Commit[] = [];
        const recovery = yield* recoveryFor(relationship, commits);
        yield* recovery.reconcile("startup");
        assert.lengthOf(continues(commits), 0, relationship);
      }
    }),
);

it.effect(
  "shutdown: a main thread is prepared for continuation (a restart-prepare write), a child is not",
  () =>
    Effect.gen(function* () {
      const mainCommits: Commit[] = [];
      yield* (yield* recoveryFor(null, mainCommits)).prepareForShutdown;
      const childCommits: Commit[] = [];
      yield* (yield* recoveryFor("subagent", childCommits)).prepareForShutdown;
      assert.isAbove(mainCommits.length, 0, "main: prepared");
      assert.lengthOf(childCommits, 0, "child: not prepared");
    }),
);
