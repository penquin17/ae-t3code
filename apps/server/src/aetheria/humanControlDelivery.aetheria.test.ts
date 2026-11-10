// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M06 Plan step 6 (D5, IP-23) — the late-answer delivery adapter over T3's REAL message dispatch and command receipts.
//
// Boundary: `makeThreadTurnDispatch` (the adapter the Backend wrapper uses) over the real ThreadManagementService, Orchestrator, EventSink, stores
// and CommandReceiptStoreV2 on one in-memory SQLite database (T3's `ProviderReplayHarness`, the layout the sub-phase 1 probe uses). The ONLY double
// is the provider: a scripted adapter that records `startTurn`. It shows: the decided command (`message.dispatch`, automatic intent, user/server
// provenance, a stable commandId) arrives at the intended thread once; the receipt it reads is T3's own; a repeat of the same commandId has no second
// effect; the same id aimed at another thread is refused; a never-sent id has no receipt. It does NOT show the service's own retry rules (the
// interaction core's suites), a running thread or a Stop window (the probe), or the production layer graph (server.ts, IP-23, is type-checked and
// covered by the built-stack step).
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import { lateAnswerCommand, makeThreadTurnDispatch } from "./humanControlDelivery.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test-model" };

/** Replaced by the mutation check: a new id for the repeat would create a second effect. */
const REPEAT_SUFFIX = "";

const scriptedProvider = Effect.fn("humanControlDelivery.scriptedProvider")(function* (
  name: string,
) {
  const cwd = yield* checkpointWorkspace(name);
  const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
  const started: ProviderAdapter.ProviderAdapterV2TurnInput[] = [];
  const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (input) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        return {
          instanceId,
          driver,
          providerSessionId: input.providerSessionId,
          providerSession: {
            id: input.providerSessionId,
            driver,
            providerInstanceId: instanceId,
            status: "ready",
            cwd,
            model: modelSelection.model,
            capabilities: CodexProviderCapabilitiesV2,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
          events: Stream.fromQueue(events),
          ensureThread: ({ threadId }) =>
            Effect.succeed({
              id: ProviderThreadId.make(`provider-thread:${threadId}`),
              driver,
              providerInstanceId: instanceId,
              providerSessionId: input.providerSessionId,
              appThreadId: threadId,
              ownerNodeId: null,
              nativeThreadRef: { driver, nativeId: "native-thread", strength: "strong" },
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: null,
              lastRunOrdinal: null,
              handoffIds: [],
              forkedFrom: null,
              createdAt: now,
              updatedAt: now,
            }),
          resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
          startTurn: (turn) =>
            Effect.sync(() => {
              started.push(turn);
            }).pipe(
              Effect.andThen(
                Queue.offer(events, {
                  type: "provider_turn.updated",
                  driver,
                  providerTurn: {
                    id: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
                    providerThreadId: turn.providerThread.id,
                    nodeId: turn.rootNodeId,
                    runAttemptId: turn.attemptId,
                    nativeTurnRef: {
                      driver,
                      nativeId: `native:${turn.attemptId}`,
                      strength: "strong",
                    },
                    ordinal: turn.providerTurnOrdinal,
                    status: "running",
                    startedAt: now,
                    completedAt: null,
                  },
                }),
              ),
            ),
          steerTurn: () => Effect.void,
          interruptTurn: () => Effect.void,
          respondToRuntimeRequest: () => Effect.void,
          readThreadSnapshot: () => Effect.die("unused"),
          rollbackThread: () => Effect.die("unused"),
          forkThread: () => Effect.die("unused"),
        };
      }),
  };
  return { cwd, started, adapter };
});

const layerRuntime = (name: string, adapter: ProviderAdapter.ProviderAdapterV2["Service"]) => {
  const layerDatabase = SqlitePersistence.layerMemory;
  return ThreadManagementService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        layerDatabase,
        EventStore.layer.pipe(Layer.provide(layerDatabase)),
        ProviderReplayHarness.layerWithRegistry(
          { name },
          ProviderAdapterRegistry.layerSingle(adapter),
          { databaseLayer: layerDatabase, runEffectWorker: false },
        ),
      ),
    ),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
  );
};

const createThread = (id: string, cwd: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make(id);
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${id}`),
      threadId,
      projectId: ProjectId.make("project:human-control-delivery"),
      title: id,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: cwd,
      createdBy: "user",
      creationSource: "web",
    });
    return threadId;
  });

it.effect(
  "delivers a late answer once through T3's real dispatch, reads T3's real receipt, and refuses a repeat's second effect",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const script = yield* scriptedProvider("hc-delivery");
        yield* Effect.gen(function* () {
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
          const port = yield* makeThreadTurnDispatch(
            yield* ThreadManagementService.ThreadManagementService,
            yield* CommandReceiptStore.CommandReceiptStoreV2,
          );
          const target = yield* createThread("thread:hc-target", script.cwd);
          const bystander = yield* createThread("thread:hc-bystander", script.cwd);
          const commandId = "m06-answer:int-1";
          const text = "Answer to question int-1: use the second option";
          const send = { commandId, threadId: target, text };
          const command = lateAnswerCommand(send);
          assert.equal(command.type, "message.dispatch");
          const messageId = command.type === "message.dispatch" ? command.messageId : "";
          // The decided provenance, intent and text; no other field names an author or a route.
          assert.deepInclude(command as object, {
            commandId,
            threadId: target,
            text,
            deliveryIntent: "auto",
            createdBy: "user",
            creationSource: "server",
          });

          assert.deepEqual(yield* Effect.promise(() => port.receipt(commandId)), {
            kind: "absent",
          });

          assert.deepEqual(yield* Effect.promise(() => port.dispatch(send)), { kind: "accepted" });
          yield* worker.drain();
          assert.deepEqual(yield* Effect.promise(() => port.receipt(commandId)), {
            kind: "accepted",
          });
          // One start, at the intended thread, with the answer text; nothing reached the bystander.
          assert.lengthOf(script.started, 1);
          const projection = yield* orchestrator.getThreadProjection(target);
          assert.deepEqual(
            projection.messages.filter((message) => message.id === messageId).map((m) => m.text),
            [text],
          );
          assert.lengthOf((yield* orchestrator.getThreadProjection(bystander)).messages, 0);

          // The identical command again: accepted as the original, no second start and no second message.
          assert.deepEqual(
            yield* Effect.promise(() =>
              port.dispatch({ ...send, commandId: `${commandId}${REPEAT_SUFFIX}` }),
            ),
            { kind: "accepted" },
          );
          yield* worker.drain();
          assert.lengthOf(script.started, 1);
          assert.lengthOf(
            (yield* orchestrator.getThreadProjection(target)).messages.filter(
              (message) => message.id === messageId,
            ),
            1,
          );

          // The same id aimed at another thread is refused by T3 before it commits, and nothing reaches that thread.
          const conflict = yield* Effect.promise(() =>
            port.dispatch({ ...send, threadId: bystander }),
          );
          assert.equal(conflict.kind, "rejected");
          assert.lengthOf((yield* orchestrator.getThreadProjection(bystander)).messages, 0);

          // A thread T3 does not know is never reported accepted, and leaves no receipt.
          const missing = yield* Effect.promise(() =>
            port.dispatch({
              commandId: "m06-answer:int-2",
              threadId: ThreadId.make("thread:hc-missing"),
              text,
            }),
          );
          assert.notEqual(missing.kind, "accepted");
          assert.deepEqual(yield* Effect.promise(() => port.receipt("m06-answer:int-2")), {
            kind: "absent",
          });
        }).pipe(Effect.provide(layerRuntime("hc-delivery", script.adapter)));
      }),
    ),
);
