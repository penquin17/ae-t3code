// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M05 step 6 — the boot LineageReaderPort and the launch facts, over T3's real services (one in-memory database, a scripted provider).
// Shows: a created child is listed with its parent, root and relationship, the session the index reports for it (null, a session, or "unknown"), and not closed;
// a failing listing is unavailable, never empty; a caller's launch facts come from its thread's model and modes. Does NOT show a real Pi session or any restart.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as DocumentText from "../provider/DocumentText.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import { makeLaunchFacts } from "./launchFacts.ts";
import { makeLineageReader } from "./lineageReader.ts";
import { makeChildThreadPort } from "./threadPort.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test-model" };

const scripted = Effect.fn("lineageReader.scripted")(function* (name: string) {
  const cwd = yield* checkpointWorkspace(name);
  const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
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
          ensureThread: ({ threadId, existingProviderThread }) =>
            Effect.succeed({
              id: ProviderThreadId.make(`provider-thread:${threadId}`),
              driver,
              providerInstanceId: instanceId,
              providerSessionId: input.providerSessionId,
              appThreadId: threadId,
              ownerNodeId: null,
              nativeThreadRef: {
                driver,
                nativeId: `native-thread:${threadId}`,
                strength: "strong" as const,
              },
              nativeConversationHeadRef: null,
              status: "idle" as const,
              firstRunOrdinal: null,
              lastRunOrdinal: null,
              handoffIds: [],
              forkedFrom: null,
              createdAt: now,
              updatedAt: now,
              ...(existingProviderThread === undefined ? {} : { ...existingProviderThread }),
            }),
          resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
          startTurn: (turn) =>
            Effect.gen(function* () {
              const at = yield* DateTime.now;
              yield* Queue.offer(events, {
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
                  startedAt: at,
                  completedAt: null,
                },
              });
            }),
          steerTurn: () => Effect.void,
          interruptTurn: () => Effect.void,
          respondToRuntimeRequest: () => Effect.void,
          readThreadSnapshot: () => Effect.die("unused"),
          rollbackThread: () => Effect.die("unused"),
          forkThread: () => Effect.die("unused"),
        };
      }),
  };
  return { cwd, adapter };
});

const layerRuntime = (name: string, adapter: ProviderAdapter.ProviderAdapterV2["Service"]) => {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerIntake = ServerConfig.layerTest(process.cwd(), { prefix: "t3-lineage-" }).pipe(
    Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  );
  const layerThreads = ThreadManagementService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        layerDatabase,
        EventStore.layer.pipe(Layer.provide(layerDatabase)),
        ProviderReplayHarness.layerWithRegistry(
          { name },
          ProviderAdapterRegistry.layerSingle(adapter),
          {
            databaseLayer: layerDatabase,
            runEffectWorker: false,
          },
        ),
      ),
    ),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
  );
  return Layer.mergeAll(layerThreads, layerIntake, IdAllocator.layer);
};

const scenario = <A, E>(name: string, body: (cwd: string) => Effect.Effect<A, E, any>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const script = yield* scripted(name);
      return yield* body(script.cwd).pipe(Effect.provide(layerRuntime(name, script.adapter)));
    }),
  );

const startParent = (cwd: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
    const parent = ThreadId.make("thread:parent");
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create:parent"),
      threadId: parent,
      projectId: ProjectId.make("project:lineage"),
      title: "parent",
      modelSelection: { ...modelSelection, options: [{ id: "thinking", value: "high" }] } as never,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: cwd,
      createdBy: "user",
      creationSource: "web",
    });
    const running = yield* orchestrator.streamDomainEvents.pipe(
      Stream.filter(
        (event) => event.type === "provider-turn.updated" && event.payload.status === "running",
      ),
      Stream.take(1),
      Stream.runDrain,
      Effect.forkScoped,
    );
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("first:parent"),
      threadId: parent,
      messageId: MessageId.make("message:first:parent"),
      text: "first",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "web",
    });
    yield* worker.drain();
    yield* Fiber.join(running);
    const run = (yield* orchestrator.getThreadProjection(parent)).runs[0]!;
    return { parent, runId: String(run.id), nodeId: String(run.rootNodeId) };
  });

it.effect(
  "lists a created child with its lineage and the index's answer for its session, and reports a failing listing as unavailable",
  () =>
    scenario("lineage", (cwd) =>
      Effect.gen(function* () {
        const threads = yield* ThreadManagementService.ThreadManagementService;
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const port = yield* makeChildThreadPort({
          threads,
          orchestrator,
          sessions: yield* ProviderSessionManager.ProviderSessionManagerV2,
          sink: yield* EventSink.EventSinkV2,
          ids: yield* IdAllocator.IdAllocatorV2,
        });
        const parent = yield* startParent(cwd);
        const created = yield* Effect.promise(() =>
          port.createChildThread({
            commandId: "m05-lineage-spawn:1",
            parentThreadId: String(parent.parent),
            parentRunId: parent.runId,
            parentNodeId: parent.nodeId,
            task: "the task",
            modelSelection: { provider: "codex", model: "test-model" },
            runtimeMode: "full-access",
            interactionMode: "default",
            workingFolder: cwd,
            completionWake: "always",
          }),
        );
        if (!created.ok) return assert.fail(JSON.stringify(created));

        const reader = yield* makeLineageReader(threads, (threadId) =>
          threadId === created.threadId ? "0197d3c0-0000-7000-8000-000000000001" : null,
        );
        const listed = yield* Effect.promise(() => reader.listChildThreads());
        assert.isTrue(listed.ok);
        if (!listed.ok) return;
        assert.deepEqual(listed.threads, [
          {
            threadId: created.threadId,
            parentThreadId: "thread:parent",
            rootThreadId: "thread:parent",
            relationshipToParent: "subagent",
            sessionId: "0197d3c0-0000-7000-8000-000000000001",
            closed: false,
          },
        ]);

        // The index's "unknown" is carried through, never turned into an empty or absent binding.
        const unsure = yield* makeLineageReader(threads, () => "unknown");
        const unsureListing = yield* Effect.promise(() => unsure.listChildThreads());
        assert.isTrue(unsureListing.ok && unsureListing.threads[0]?.sessionId === "unknown");
        const unreadable = yield* makeLineageReader(
          { ...threads, listProjectThreads: () => Effect.die("unreadable") } as never,
          () => null,
        );
        assert.deepEqual(yield* Effect.promise(() => unreadable.listChildThreads()), {
          ok: false,
          reason: "unavailable",
        });

        const facts = yield* makeLaunchFacts(orchestrator, (sessionId) =>
          sessionId === "session-of-parent" ? "thread:parent" : undefined,
        );
        assert.deepEqual(yield* Effect.promise(() => facts("session-of-parent")), {
          routes: [{ provider: "codex", model: "test-model", effort: "high" }],
          runtimeMode: "full-access",
          interactionMode: "default",
        });
        assert.isUndefined(yield* Effect.promise(() => facts("someone-else")));
      }),
    ),
);
