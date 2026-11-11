// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M05 Plan step 2 (D4, D14, D19 seam a, R1) — held child creation probe. A mechanism probe, not an M05 feature.
//
// Question. Can the Backend create a delegated child of an active parent run with its task recorded and NO provider work, learn the child's
// provider-session binding before the first prompt, and then release the first turn exactly once?
//
// Boundary. The real ThreadManagementService, Orchestrator, EventSink, EventStore, ProjectionStore, ProviderSessionManager and effect worker on one
// in-memory SQLite database (T3's ProviderReplayHarness.layerWithRegistry, as dispatchProbe.aetheria.test.ts uses it). The ONLY double is the
// provider: a scripted adapter that records openSession / ensureThread / resumeThread / startTurn per thread and holds no model and no credential.
// The held child is made by T3's own `delegated_task.request` with `workspaceStrategy: {type:"root"}` (the one field that makes T3 record the first
// message as `defer_start`), released by T3's own `prepared-run.release`; both go through `ThreadManagementService.dispatch`.
//
// Shows: (1) the held child, its lineage, task and `preparing` run are visible, and no provider session is opened and no turn started; (2) the
// native held path gives NO provider-session or native-thread binding (`nativeThreadRef` stays null), so a Pi session id is not knowable from
// held creation alone; (3) opening the session and ensuring the thread through T3's ProviderSessionManager BEFORE release yields the binding without
// a turn, and the later release reuses that session (no second open, no new native thread) and starts the first turn once; (4) releasing an
// already-released run, and an unknown run, is refused by T3 with a dispatch error, not an accepted no-op, while repeating the same commandId is a
// replay with no second effect.
// Does NOT show: real Pi (see piChildBoundary.aetheria.test.ts), the MCP delegate_task path, the Aetheria Backend adapter (none exists yet), or the
// workspace a held child runs in (the strategy sets `branch` and `worktreePath` to null; see the final test).
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
} from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";

import * as ServerConfig from "../config.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as DocumentText from "../provider/DocumentText.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";

/** Set to false to see the failure the persist step prevents (a second ensureThread at release). */
const PERSIST_BOUND_THREAD = true as boolean;

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test-model" };

/** A scripted provider: no model, no credential. Records which thread each provider call was for. */
const scriptedProvider = Effect.fn("heldChild.scriptedProvider")(function* (name: string) {
  const cwd = yield* checkpointWorkspace(name);
  const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
  const log = {
    opened: [] as string[],
    ensured: [] as string[],
    resumed: [] as string[],
    started: [] as ProviderAdapter.ProviderAdapterV2TurnInput[],
  };
  const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (input) =>
      Effect.gen(function* () {
        log.opened.push(`${input.threadId}`);
        const now = yield* DateTime.now;
        const thread = (threadId: ThreadId, providerSessionId: typeof input.providerSessionId) => ({
          id: ProviderThreadId.make(`provider-thread:${threadId}`),
          driver,
          providerInstanceId: instanceId,
          providerSessionId,
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
        });
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
          // Like the Pi adapter, an existing provider-thread row keeps its identity; only the native ref and status are filled in.
          ensureThread: ({ threadId, existingProviderThread }) =>
            Effect.sync(() => void log.ensured.push(`${threadId}`)).pipe(
              Effect.map(() => {
                const fresh = thread(threadId, input.providerSessionId);
                return existingProviderThread === undefined
                  ? fresh
                  : {
                      ...existingProviderThread,
                      providerSessionId: input.providerSessionId,
                      nativeThreadRef: fresh.nativeThreadRef,
                      status: "idle" as const,
                    };
              }),
            ),
          resumeThread: ({ providerThread }) =>
            Effect.sync(() => void log.resumed.push(`${providerThread.appThreadId}`)).pipe(
              Effect.as(providerThread),
            ),
          startTurn: (turn) =>
            Effect.gen(function* () {
              log.started.push(turn);
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
  return { cwd, log, adapter };
});

const layerRuntime = (name: string, adapter: ProviderAdapter.ProviderAdapterV2["Service"]) => {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerIntakeServices = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-held-child-probe-",
  }).pipe(Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))));
  const layerThreads = ThreadManagementService.layer.pipe(
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
  return Layer.mergeAll(layerThreads, layerIntakeServices, IdAllocator.layer);
};

/** A parent thread with a running turn (the active run and node a delegated task needs). */
const startParent = (cwd: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
    const parent = ThreadId.make("thread:parent");
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create:parent"),
      threadId: parent,
      projectId: ProjectId.make("project:held-child-probe"),
      title: "parent",
      modelSelection,
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
    const projection = yield* orchestrator.getThreadProjection(parent);
    const run = projection.runs[0]!;
    return { parent, runId: run.id, nodeId: run.rootNodeId as NodeId };
  });

/** The backend-created held child: T3's own delegated_task.request with the strategy that records the first message as defer_start. */
const holdChild = (
  parent: { parent: ThreadId; runId: never; nodeId: NodeId },
  commandKey: string,
) =>
  Effect.gen(function* () {
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const commandId = CommandId.make(`m05-probe-spawn:${commandKey}`);
    yield* threads.dispatch({
      type: "delegated_task.request",
      commandId,
      parentThreadId: parent.parent,
      parentRunId: parent.runId,
      parentNodeId: parent.nodeId,
      task: "the held task",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceStrategy: { type: "root" },
      createdBy: "agent",
      creationSource: "server",
    });
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const subagents = (yield* orchestrator.getThreadProjection(parent.parent)).subagents;
    const task = subagents.find((candidate) => candidate.prompt === "the held task")!;
    const child = task.childThreadId!;
    const projection = yield* orchestrator.getThreadProjection(child);
    return { commandId, child, projection, run: projection.runs[0]! };
  });

type Script = Effect.Success<ReturnType<typeof scriptedProvider>>;

const scenario = <A, E>(name: string, body: (script: Script) => Effect.Effect<A, E, any>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const script = yield* scriptedProvider(name);
      return yield* body(script).pipe(Effect.provide(layerRuntime(name, script.adapter)));
    }),
  );

it.effect(
  "a backend-created child is held: task, lineage and a preparing run are visible, no provider work happens",
  () =>
    scenario("held-visible", (script) =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const parent = yield* startParent(script.cwd);
        const startsBefore = script.log.started.length;
        const opensBefore = script.log.opened.length;
        const held = yield* holdChild(parent as never, "visible");
        yield* worker.drain();

        // Lineage and the recorded task.
        assert.equal(held.projection.thread.lineage.relationshipToParent, "subagent");
        assert.equal(held.projection.thread.lineage.parentThreadId, parent.parent);
        assert.equal(held.projection.messages.length, 1);
        assert.equal(held.projection.messages[0]?.text, "the held task");
        // The run exists and is `preparing`, not starting, running or terminal.
        assert.lengthOf(held.projection.runs, 1);
        assert.equal(held.run.status, "preparing");
        // No provider activity for the child after the worker ran: no session opened, no thread ensured or resumed, no turn started.
        assert.equal(script.log.started.length, startsBefore);
        assert.equal(script.log.opened.length, opensBefore);
        assert.notInclude(script.log.ensured, held.child);
        assert.notInclude(script.log.resumed, held.child);
        assert.isUndefined(script.log.started.find((turn) => turn.threadId === held.child));
        // (2) The native held path gives no binding: the child's provider thread has no native thread ref, so no Pi session file or id exists yet.
        const after = yield* orchestrator.getThreadProjection(held.child);
        assert.equal(after.providerThreads.length, 1);
        assert.isNull(after.providerThreads[0]?.nativeThreadRef);
        assert.equal(after.runs[0]?.status, "preparing");
      }),
    ),
);

it.effect(
  "opening the session and ensuring the thread before release binds a native thread without a turn; release then reuses it and starts once",
  () =>
    scenario("pre-open", (script) =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
        const threads = yield* ThreadManagementService.ThreadManagementService;
        const parent = yield* startParent(script.cwd);
        const held = yield* holdChild(parent as never, "pre-open");
        const providerThread = held.projection.providerThreads[0]!;
        assert.isNull(providerThread.nativeThreadRef);

        // The pre-release step a Backend adapter would take: the same open the first turn would do, then ensureThread, and no startTurn.
        const runtime = yield* sessions.open({
          threadId: held.child,
          providerSessionId: providerThread.providerSessionId!,
          modelSelection: held.run.modelSelection,
          runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
            runtimeMode: "full-access",
            interactionMode: "default",
            cwd: script.cwd,
          }),
        });
        const ensured = yield* runtime.ensureThread({
          threadId: held.child,
          modelSelection: held.run.modelSelection,
          runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
            runtimeMode: "full-access",
            interactionMode: "default",
            cwd: script.cwd,
          }),
          providerSessionId: providerThread.providerSessionId!,
          existingProviderThread: providerThread,
        });
        // The native thread (the Pi session file, for Pi) is now known, with no provider turn started for the child.
        assert.equal(ensured.nativeThreadRef?.nativeId, `native-thread:${held.child}`);
        assert.isUndefined(script.log.started.find((turn) => turn.threadId === held.child));
        // Whatever thread id T3 opened the session under, opening it did not start a turn; remember how many opens there were.
        const opensBeforeRelease = script.log.opened.length;
        assert.isAbove(opensBeforeRelease, 0, `opened: ${script.log.opened.join(",")}`);

        // The bound native thread must be persisted before release. Without it T3's turn start reads `nativeThreadRef: null` from the projection and
        // calls ensureThread again (for Pi: a second `new_session`, i.e. a second Pi session id). `persist: false` shows that path; the default
        // writes the provider-thread.updated event through T3's EventSink, which the Backend already holds.
        if (PERSIST_BOUND_THREAD) {
          const sink = yield* EventSink.EventSinkV2;
          const ids = yield* IdAllocator.IdAllocatorV2;
          const at = yield* DateTime.now;
          yield* sink.write({
            events: [
              {
                id: yield* ids.allocate.event({ threadId: held.child }),
                type: "provider-thread.updated",
                threadId: held.child,
                driver,
                providerInstanceId: instanceId,
                occurredAt: at,
                payload: ensured,
              },
            ],
          });
        }

        // Release once.
        const release = {
          type: "prepared-run.release",
          commandId: CommandId.make("m05-probe-release:pre-open"),
          threadId: held.child,
          runId: held.run.id,
        } as const;
        yield* threads.dispatch(release);
        yield* worker.drain();
        const startedForChild = script.log.started.filter((turn) => turn.threadId === held.child);
        assert.lengthOf(startedForChild, 1);
        assert.equal(startedForChild[0]?.message.text, "the held task");
        // The release did not open a second session for the child (the live session was reused).
        assert.equal(
          script.log.opened.length,
          opensBeforeRelease,
          `opened: ${script.log.opened.join(",")}`,
        );
        // ensureThread was not repeated by the release: the persisted native thread was resumed, not created again.
        assert.equal(
          script.log.ensured.filter((id) => id === held.child).length,
          1,
          `ensured: ${script.log.ensured.join(",")}`,
        );
        assert.include(script.log.resumed, held.child);
        assert.equal(
          startedForChild[0]?.providerThread.nativeThreadRef?.nativeId,
          ensured.nativeThreadRef?.nativeId,
        );
        const projection = yield* orchestrator.getThreadProjection(held.child);
        assert.notEqual(projection.runs[0]?.status, "preparing");
      }),
    ),
);

it.effect(
  "release is single-effect: the same commandId replays; another commandId or an unknown run is refused, not a no-op",
  () =>
    scenario("release-idempotence", (script) =>
      Effect.gen(function* () {
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threads = yield* ThreadManagementService.ThreadManagementService;
        const parent = yield* startParent(script.cwd);
        const held = yield* holdChild(parent as never, "release");
        const release = (key: string, runId = held.run.id) =>
          ({
            type: "prepared-run.release",
            commandId: CommandId.make(`m05-probe-release:${key}`),
            threadId: held.child,
            runId,
          }) as const;
        const first = yield* threads.dispatch(release("one"));
        yield* worker.drain();
        const startsAfterFirst = script.log.started.filter(
          (turn) => turn.threadId === held.child,
        ).length;
        assert.equal(startsAfterFirst, 1);
        assert.isUndefined((first as { replayed?: true }).replayed);

        // The identical commandId: replayed, nothing appended, no second start.
        const again = yield* threads.dispatch(release("one"));
        yield* worker.drain();
        assert.isTrue((again as { replayed?: true }).replayed === true);
        assert.equal(script.log.started.filter((turn) => turn.threadId === held.child).length, 1);

        // Another commandId for the already-released run: T3 refuses it (the run is no longer awaiting preparation). The Backend's idempotent
        // release wrapper must therefore derive the commandId from the held message id and map this refusal to accepted only after reading state.
        const second = yield* threads.dispatch(release("two")).pipe(Effect.flip);
        assert.match(
          String((second as { cause?: unknown; message?: unknown }).cause ?? second),
          /not awaiting workspace preparation|Dispatch|dispatch/,
        );
        // An unknown run id is refused the same way.
        const unknown = yield* threads
          .dispatch(release("three", "run:does-not-exist" as never))
          .pipe(Effect.flip);
        assert.isDefined(unknown);
        yield* worker.drain();
        assert.equal(script.log.started.filter((turn) => turn.threadId === held.child).length, 1);
      }),
    ),
);

it.effect(
  "the held child's workspace: the strategy leaves branch and worktreePath null, not the parent's folder",
  () =>
    scenario("held-workspace", (script) =>
      Effect.gen(function* () {
        const parent = yield* startParent(script.cwd);
        const held = yield* holdChild(parent as never, "workspace");
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const parentThread = (yield* orchestrator.getThreadProjection(parent.parent)).thread;
        assert.equal(parentThread.worktreePath, script.cwd);
        // Observed limit: a held child made with workspaceStrategy has no worktreePath of its own (Orchestrator.ts:7815), so its working folder falls
        // back to the project root through RuntimePolicy, not to the parent's checkout. M05 must pass the working folder another way or record this.
        assert.isNull(held.projection.thread.worktreePath);
        assert.isNull(held.projection.thread.branch);
      }),
    ),
);
