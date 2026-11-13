import { assert, it } from "@effect/vitest";
import {
  CheckpointScopeId,
  CommandId,
  MessageId,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2CheckpointScope,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type OrchestrationV2RunAttempt,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import * as CheckpointService from "./CheckpointService.ts";
import * as EventSink from "./EventSink.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderEventIngestor from "./ProviderEventIngestor.ts";
import * as McpAppModelContext from "../mcpApps/McpAppModelContext.ts";
import * as PreviewAgentActivity from "../preview/PreviewAgentActivity.ts";
import * as RunExecutionService from "./RunExecutionService.ts";
import * as RunFinalizationService from "./RunFinalizationService.ts";
import * as TurnItemPositionStore from "./TurnItemPositionStore.ts";

// The Aetheria-owned tests of RunExecutionService. Upstream's own test file stays untouched;
// the helpers below are the minimal private copies these tests need.
const driver = ProviderDriverKind.make("codex");

const rootAppThread = (id: ThreadId) =>
  ({
    id,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
  }) as OrchestrationV2AppThread;

interface ScenarioIds {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly attemptId: RunAttemptId;
  readonly providerThreadId: ProviderThreadId;
  readonly rootProviderTurnId: ProviderTurnId;
  readonly rootNodeId: NodeId;
}

const scenarioIds = (key: string): ScenarioIds => ({
  threadId: ThreadId.make(`thread:${key}`),
  runId: RunId.make(`run:${key}`),
  attemptId: RunAttemptId.make(`attempt:${key}`),
  providerThreadId: ProviderThreadId.make(`provider-thread:${key}`),
  rootProviderTurnId: ProviderTurnId.make(`provider-turn:${key}`),
  rootNodeId: NodeId.make(`node:${key}`),
});

const rootTerminalEvent = (
  ids: ScenarioIds,
  status: "interrupted",
): ProviderAdapter.ProviderAdapterV2Event => ({
  type: "turn.terminal",
  driver,
  providerThreadId: ids.providerThreadId,
  providerTurnId: ids.rootProviderTurnId,
  runOrdinal: 1,
  threadDisposition: "reusable",
  status,
  failure: null,
});

// A Stop that settled the run before its provider turn was projected leaves the provider turn running; the first root turn event interrupts it by its real id.
const rootTurnEvent = (
  ids: ScenarioIds,
  status: "running" | "completed",
): ProviderAdapter.ProviderAdapterV2Event =>
  ({
    type: "provider_turn.updated",
    driver,
    providerTurn: {
      id: ids.rootProviderTurnId,
      providerThreadId: ids.providerThreadId,
      nodeId: ids.rootNodeId,
      runAttemptId: ids.attemptId,
      status,
    },
  }) as ProviderAdapter.ProviderAdapterV2Event;

type InterruptRequest = Parameters<
  ProviderAdapter.ProviderAdapterV2SessionRuntime["interruptTurn"]
>[0];

// Starts a root run over a scripted provider event stream and waits for its consumer to end.
const runRootEvents = (input: {
  readonly key: string;
  readonly runCurrent: boolean;
  readonly events: (ids: ScenarioIds) => ReadonlyArray<ProviderAdapter.ProviderAdapterV2Event>;
  readonly interruptTurn: (request: InterruptRequest) => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const ids = scenarioIds(input.key);
    const providerInstanceId = ProviderInstanceId.make("codex");
    const ingestionDone = yield* Deferred.make<void>();
    const layerTest = RunExecutionService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(McpAppModelContext.McpAppModelContext)({
            forThread: () => Effect.succeed([]),
          }),
          Layer.mock(CheckpointService.CheckpointServiceV2)({ captureBaseline: () => Effect.void }),
          Layer.mock(TurnItemPositionStore.TurnItemPositionStoreV2)({
            allocate: () => Effect.succeed(1),
          }),
          Layer.mock(EventSink.EventSinkV2)({
            write: () => Effect.succeed([]),
            writeWithEffects: () => Effect.succeed([]),
            writeIfRunCurrent: () => Effect.succeed({ committed: true, storedEvents: [] }),
          }),
          IdAllocator.layer,
          Layer.mock(ProviderEventIngestor.ProviderEventIngestorV2)({
            ingestNormalized: () => Effect.succeed([]),
          }),
          ServerSettings.layerTest(),
          Layer.succeed(RunFinalizationService.RunFinalizationObserver, {
            refresh: () => Effect.void,
            refreshAfterTurn: () => Effect.void,
          }),
        ),
      ),
      Layer.provideMerge(PreviewAgentActivity.layer),
    );

    yield* Effect.gen(function* () {
      const runExecution = yield* RunExecutionService.RunExecutionServiceV2;
      yield* runExecution.startRootRun({
        commandId: CommandId.make(`command:${input.key}`),
        appThread: rootAppThread(ids.threadId),
        providerSessionId: ProviderSessionId.make(`session:${input.key}`),
        session: {
          events: Stream.empty,
          subscribeEvents: Effect.succeed({
            events: Stream.fromIterable(input.events(ids)),
            close: Deferred.succeed(ingestionDone, undefined),
          }),
          startTurn: () => Effect.void,
          interruptTurn: input.interruptTurn,
        } as unknown as ProviderAdapter.ProviderAdapterV2SessionRuntime,
        run: {
          id: ids.runId,
          threadId: ids.threadId,
          ordinal: 1,
          providerInstanceId,
        } as OrchestrationV2Run,
        rootNode: {
          id: ids.rootNodeId,
          providerTurnId: ids.rootProviderTurnId,
        } as OrchestrationV2ExecutionNode,
        checkpointScope: {
          id: CheckpointScopeId.make(`checkpoint-scope:${input.key}`),
        } as OrchestrationV2CheckpointScope,
        providerThread: {
          id: ids.providerThreadId,
          driver,
        } as OrchestrationV2ProviderThread,
        attempt: {
          id: ids.attemptId,
          providerTurnId: ids.rootProviderTurnId,
        } as OrchestrationV2RunAttempt,
        attemptId: ids.attemptId,
        providerTurnOrdinal: 1,
        shouldFinalizeRun: () => Effect.succeed(input.runCurrent),
        message: {
          messageId: MessageId.make(`message:${input.key}`),
          text: "interrupt projection",
          attachments: [],
          createdBy: "user",
          creationSource: "web",
        },
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
        runtimePolicy: {
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: process.cwd(),
          approvalPolicy: "never",
          sandboxPolicy: {
            type: "readOnly",
            access: { type: "fullAccess" },
            networkAccess: false,
          },
        },
      });
      yield* Deferred.await(ingestionDone);
    }).pipe(Effect.provide(layerTest));
  });

const captureInterruptsOfRootTurns = (input: {
  readonly key: string;
  readonly runCurrent: boolean;
  readonly turns: ReadonlyArray<"running" | "completed">;
}) =>
  Effect.gen(function* () {
    const interrupts = yield* Ref.make<ReadonlyArray<InterruptRequest>>([]);
    yield* runRootEvents({
      key: input.key,
      runCurrent: input.runCurrent,
      events: (ids) => [
        ...input.turns.map((status) => rootTurnEvent(ids, status)),
        rootTerminalEvent(ids, "interrupted"),
      ],
      interruptTurn: (request) => Ref.update(interrupts, (current) => [...current, request]),
    });
    return yield* Ref.get(interrupts);
  });

it.effect(
  "interrupts the provider turn that first appears after Stop settled its run, by the id the provider reported",
  () =>
    Effect.gen(function* () {
      const calls = yield* captureInterruptsOfRootTurns({
        key: "late-first-turn-after-stop",
        runCurrent: false,
        turns: ["running"],
      });
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0]?.providerTurnId,
        scenarioIds("late-first-turn-after-stop").rootProviderTurnId,
      );
      assert.equal(calls[0]?.requestRuntimeRestart, true);
    }),
);

it.effect("does not interrupt the first provider turn of a run that is still current", () =>
  Effect.gen(function* () {
    const calls = yield* captureInterruptsOfRootTurns({
      key: "first-turn-run-current",
      runCurrent: true,
      turns: ["running"],
    });
    assert.deepEqual(calls, []);
  }),
);

it.effect("does not interrupt a root turn that arrives already ended, or any later root turn", () =>
  Effect.gen(function* () {
    const ended = yield* captureInterruptsOfRootTurns({
      key: "late-first-turn-already-ended",
      runCurrent: false,
      turns: ["completed"],
    });
    assert.deepEqual(ended, []);
    // Only an attempt's first root turn qualifies: a continuation turn on a settled run is left alone.
    const later = yield* captureInterruptsOfRootTurns({
      key: "late-second-turn",
      runCurrent: false,
      turns: ["completed", "running"],
    });
    assert.deepEqual(later, []);
  }),
);
