// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M06 Plan step 2 (D5) — dispatch probe. A mechanism probe, not an M06 feature.
//
// Question. Can the Aetheria Backend, running inside T3's server process, deliver a late human answer by calling T3's own message intake
// in-process (not through the client WS RPC), with a stable commandId, so a repeat has no second effect?
//
// Boundary. The real `ThreadMessageIntake.dispatchCommand` over the real `ThreadManagementService`, the real Orchestrator, EventSink, EventStore,
// ProjectionStore and CommandReceiptStore on one in-memory SQLite database (T3's own `ProviderReplayHarness.layerWithRegistry`, the layout
// ThreadStop.test.ts uses). The ONLY double is the provider: a scripted adapter that records startTurn / steerTurn / interruptTurn and holds no
// model and no credential. The command is the decided one: `message.dispatch`, deliveryIntent "auto", createdBy "user", creationSource "server".
//
// Shows: in an idle, a running, a Stop-window and a settled-after-Stop thread the message arrives at the intended thread (not a second one in the
// same runtime), with one accepted receipt, one resulting user message and one provider delivery; repeating the identical commandId returns the
// original receipt (`replayed`), appends no event, adds no message and causes no second provider call; the same commandId aimed at another thread
// is refused with no effect.
// Does NOT show: the WS RPC path, a real provider's behaviour, the Backend adapter itself (aetheriaBackend.ts is untouched), or the production
// server.ts layer graph (see the layer note in the final test).
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
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { dispatchCommand } from "../orchestration-v2/ThreadMessageIntake.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as DocumentText from "../provider/DocumentText.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test-model" };

/** Appended to the repeat's commandId. Empty: the repeat is the identical command. */
const REPEAT_COMMAND_ID_SUFFIX = "";

/** A scripted provider: no model, no credential. Records what T3 asks of it. */
const scriptedProvider = Effect.fn("dispatchProbe.scriptedProvider")(function* (name: string) {
  const cwd = yield* checkpointWorkspace(name);
  const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
  const started: ProviderAdapter.ProviderAdapterV2TurnInput[] = [];
  const steered: string[] = [];
  const interrupted: ProviderTurnId[] = [];
  const capabilities = {
    ...CodexProviderCapabilitiesV2,
    turns: { ...CodexProviderCapabilitiesV2.turns, supportsActiveSteering: true },
  };
  const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(capabilities),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (input) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const turnUpdated = (
          turn: ProviderAdapter.ProviderAdapterV2TurnInput,
          status: "running" | "interrupted",
        ) =>
          Queue.offer(events, {
            type: "provider_turn.updated",
            driver,
            providerTurn: {
              id: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
              providerThreadId: turn.providerThread.id,
              nodeId: turn.rootNodeId,
              runAttemptId: turn.attemptId,
              nativeTurnRef: { driver, nativeId: `native:${turn.attemptId}`, strength: "strong" },
              ordinal: turn.providerTurnOrdinal,
              status,
              startedAt: now,
              completedAt: status === "running" ? null : now,
            },
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
            capabilities,
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
            }).pipe(Effect.andThen(turnUpdated(turn, "running"))),
          steerTurn: (turn) =>
            Effect.sync(() => {
              steered.push(turn.message.text);
            }),
          interruptTurn: ({ providerTurnId }) =>
            Effect.sync(() => {
              interrupted.push(providerTurnId);
            }).pipe(
              Effect.andThen(
                Effect.forEach(
                  started.filter(
                    (turn) =>
                      ProviderTurnId.make(`provider-turn:${turn.attemptId}`) === providerTurnId,
                  ),
                  (turn) => turnUpdated(turn, "interrupted"),
                  { discard: true },
                ),
              ),
            ),
          respondToRuntimeRequest: () => Effect.void,
          readThreadSnapshot: () => Effect.die("unused"),
          rollbackThread: () => Effect.die("unused"),
          forkThread: () => Effect.die("unused"),
        };
      }),
  };
  return { cwd, started, steered, interrupted, adapter };
});

/**
 * The runtime the intake needs, built from T3's own pieces: the replay harness's orchestrator, event sink and stores (its worker off, so the test
 * drives delivery), the real ThreadManagementService on top, the real receipt store on the same database, and the config / file system /
 * document services that `ThreadMessageIntake.dispatchCommand`'s type requires.
 */
const layerRuntime = (name: string, adapter: ProviderAdapter.ProviderAdapterV2["Service"]) => {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerIntakeServices = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-dispatch-probe-",
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
  return Layer.mergeAll(layerThreads, layerIntakeServices);
};

const createThread = (id: string, cwd: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make(id);
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${id}`),
      threadId,
      projectId: ProjectId.make("project:dispatch-probe"),
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

/** Ordinary client traffic: a user turn that the scripted provider is running. */
const startRunningTurn = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
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
      commandId: CommandId.make(`first:${threadId}`),
      threadId,
      messageId: MessageId.make(`message:first:${threadId}`),
      text: "first",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "web",
    });
    yield* worker.drain();
    yield* Fiber.join(running);
  });

/** The late answer as the Backend would send it: decided provenance, automatic delivery, a stable commandId. */
const lateAnswer = (threadId: ThreadId, key: string, text: string) =>
  ({
    type: "message.dispatch",
    commandId: CommandId.make(`m06-probe-answer:${key}`),
    threadId,
    messageId: MessageId.make(`message:m06-probe-answer:${key}`),
    text,
    attachments: [],
    // Required by the contract; deliveryIntent "auto" overrides it from the thread's state.
    dispatchMode: { type: "queue_after_active" },
    deliveryIntent: "auto",
    createdBy: "user",
    creationSource: "server",
  }) satisfies OrchestrationV2Command;

/** What the real receipt store, event store and projection hold for one command and its message. */
const inspect = (command: ReturnType<typeof lateAnswer>, bystander: ThreadId) =>
  Effect.gen(function* () {
    const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
    const eventStore = yield* EventStore.EventStoreV2;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const receipt = Option.getOrThrow(yield* receipts.getByCommandId(command.commandId));
    const commandEvents = Array.from(
      yield* Stream.runCollect(eventStore.readByCommandId({ commandId: command.commandId })),
    );
    const projection = yield* orchestrator.getThreadProjection(command.threadId);
    const other = yield* orchestrator.getThreadProjection(bystander);
    return {
      receipt: {
        commandId: receipt.commandId,
        threadId: receipt.threadId,
        commandType: receipt.commandType,
        status: receipt.status,
        resultSequence: receipt.resultSequence,
        acceptedAt: DateTime.toEpochMillis(receipt.acceptedAt),
      },
      commandEventIds: commandEvents.map((stored) => stored.event.id),
      commandEventThreads: [...new Set(commandEvents.map((stored) => stored.event.threadId))],
      userMessageEvents: commandEvents.filter(
        (stored) =>
          stored.event.type === "message.updated" && stored.event.payload.id === command.messageId,
      ).length,
      latestSequence: yield* eventStore.latestSequence(),
      messages: projection.messages.filter((message) => message.id === command.messageId).length,
      userItems: projection.turnItems.filter(
        (item) => item.type === "user_message" && item.messageId === command.messageId,
      ).length,
      runsForMessage: projection.runs.filter((run) => run.userMessageId === command.messageId),
      bystanderMessages: other.messages.length,
    };
  });

type Scenario = "idle" | "running" | "stop-window" | "after-stop";

/** Runs one state through the intake: first send, assertions, then the repeat. */
const probe = (scenario: Scenario) =>
  Effect.scoped(
    Effect.gen(function* () {
      const script = yield* scriptedProvider(`dispatch-probe-${scenario}`);
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const target = yield* createThread(`thread:probe-${scenario}`, script.cwd);
        const bystander = yield* createThread(`thread:probe-bystander-${scenario}`, script.cwd);
        const turnsBefore = () => script.started.length;
        let expectedStarts = 0;

        if (scenario !== "idle") {
          yield* startRunningTurn(target);
          expectedStarts = 1;
        }
        if (scenario === "stop-window" || scenario === "after-stop") {
          // Stop is dispatched. In the window the provider has not yet stopped the turn; after Stop it has.
          const interrupted = yield* orchestrator.streamDomainEvents.pipe(
            Stream.filter(
              (event) => event.type === "run.updated" && event.payload.status === "interrupted",
            ),
            Stream.take(1),
            Stream.runDrain,
            Effect.forkScoped,
          );
          yield* orchestrator.dispatch({
            type: "thread.stop",
            commandId: CommandId.make(`stop:${scenario}`),
            threadId: target,
          });
          if (scenario === "after-stop") {
            yield* worker.drain();
            yield* Fiber.join(interrupted);
            assert.lengthOf(script.interrupted, 1);
          } else {
            yield* Fiber.interrupt(interrupted);
          }
        }
        assert.equal(turnsBefore(), expectedStarts);
        const stepsBefore = script.steered.length;

        const command = lateAnswer(target, scenario, `Answer to question q-${scenario}: yes`);
        // A delivery that starts a turn is followed by the provider's own "running" event, which reaches the log through the session stream
        // after the worker drains. The baseline waits for that milestone; a steer into a running turn has none.
        const turnRunning =
          scenario === "running"
            ? undefined
            : yield* orchestrator.streamDomainEvents.pipe(
                Stream.filter(
                  (event) =>
                    event.type === "provider-turn.updated" && event.payload.status === "running",
                ),
                Stream.take(1),
                Stream.runDrain,
                Effect.forkScoped,
              );
        const first = yield* dispatchCommand(command);
        if (scenario === "stop-window") {
          // The window itself: the provider has not stopped the turn, so a plain send queues behind it and nothing reached the provider.
          const inWindow = (yield* orchestrator.getThreadProjection(target)).runs.filter(
            (run) => run.userMessageId === command.messageId,
          );
          assert.deepEqual(
            inWindow.map((run) => run.status),
            ["queued"],
          );
          assert.equal(script.steered.length, stepsBefore);
          assert.equal(script.started.length, expectedStarts);
          assert.lengthOf(script.interrupted, 0);
        }
        yield* worker.drain();
        if (turnRunning !== undefined) yield* Fiber.join(turnRunning);

        // (a) The message arrived at the intended thread, once.
        assert.isUndefined((first as { replayed?: true }).replayed);
        const afterFirst = yield* inspect(command, bystander);
        assert.equal(afterFirst.receipt.status, "accepted");
        assert.equal(afterFirst.receipt.threadId, target);
        assert.equal(afterFirst.receipt.commandType, "message.dispatch");
        assert.equal(afterFirst.receipt.resultSequence, first.sequence);
        assert.isAbove(afterFirst.commandEventIds.length, 0);
        assert.deepEqual(afterFirst.commandEventThreads, [target]);
        assert.equal(afterFirst.userMessageEvents, 1);
        assert.equal(afterFirst.messages, 1);
        assert.equal(afterFirst.userItems, 1);
        // A steer joins the running run; every other route gives the message its own run.
        assert.lengthOf(afterFirst.runsForMessage, scenario === "running" ? 0 : 1);
        assert.equal(afterFirst.bystanderMessages, 0);

        // The provider got exactly one delivery of it, by the route the thread's state implies, with the decided provenance.
        const delivered = script.started.filter(
          (turn) => turn.message.messageId === command.messageId,
        );
        if (scenario === "running") {
          assert.deepEqual(script.steered.slice(stepsBefore), [command.text]);
          assert.lengthOf(delivered, 0);
        } else {
          // Idle: a new run. Stop window: nothing is steered into a turn that will not read it; once the provider stops, the queued run
          // starts. After Stop: a new run.
          assert.equal(script.steered.length, stepsBefore);
          if (scenario === "stop-window") assert.lengthOf(script.interrupted, 1);
          assert.lengthOf(delivered, 1);
          assert.equal(delivered[0]?.threadId, target);
          assert.equal(delivered[0]?.message.text, command.text);
          assert.equal(delivered[0]?.message.createdBy, "user");
          assert.equal(delivered[0]?.message.creationSource, "server");
        }
        const providerCalls = () => ({
          started: script.started.length,
          steered: script.steered.length,
          interrupted: script.interrupted.length,
        });
        const callsAfterFirst = providerCalls();

        // (b) The identical commandId again: the original receipt, no second effect.
        const repeatCommand = {
          ...command,
          commandId: CommandId.make(`${command.commandId}${REPEAT_COMMAND_ID_SUFFIX}`),
        };
        const repeated = yield* dispatchCommand(repeatCommand);
        yield* worker.drain();
        assert.isTrue((repeated as { replayed?: true }).replayed === true);
        assert.equal(repeated.sequence, first.sequence);
        assert.deepEqual(
          repeated.storedEvents.map((stored) => stored.event.id),
          first.storedEvents.map((stored) => stored.event.id),
        );
        const afterRepeat = yield* inspect(command, bystander);
        // Nothing at all was appended to the log after the first send settled: no event of any thread, whatever its command.
        const appended = yield* Stream.runCollect(
          (yield* EventStore.EventStoreV2).read({ afterSequence: afterFirst.latestSequence }),
        );
        assert.lengthOf(Array.from(appended), 0);
        assert.deepEqual(afterRepeat, afterFirst);
        assert.deepEqual(providerCalls(), callsAfterFirst);

        // The same commandId with a regenerated messageId and text (a retry that rebuilt its message) is also the original, not a new input.
        const rebuilt = yield* dispatchCommand({
          ...command,
          messageId: MessageId.make(`${command.messageId}:rebuilt`),
          text: `${command.text} (again)`,
        });
        yield* worker.drain();
        assert.isTrue((rebuilt as { replayed?: true }).replayed === true);
        assert.deepEqual(yield* inspect(command, bystander), afterFirst);
        assert.deepEqual(providerCalls(), callsAfterFirst);
        const rebuiltMessages = (yield* orchestrator.getThreadProjection(target)).messages.filter(
          (message) => message.id === MessageId.make(`${command.messageId}:rebuilt`),
        );
        assert.lengthOf(rebuiltMessages, 0);

        // The same commandId aimed at another thread is refused, with no effect on either thread.
        const misdirected = yield* dispatchCommand({ ...command, threadId: bystander }).pipe(
          Effect.flip,
        );
        assert.equal((misdirected as { _tag: string })._tag, "OrchestratorCommandIdConflictError");
        yield* worker.drain();
        assert.deepEqual(yield* inspect(command, bystander), afterFirst);
        assert.deepEqual(providerCalls(), callsAfterFirst);
      }).pipe(Effect.provide(layerRuntime(`dispatch-probe-${scenario}`, script.adapter)));
    }),
  );

it.effect(
  "server-originated dispatch reaches an idle thread once; a repeat has no second effect",
  () => probe("idle"),
);

it.effect(
  "server-originated dispatch steers a running thread once; a repeat has no second effect",
  () => probe("running"),
);

it.effect(
  "server-originated dispatch in the Stop window queues once; a repeat has no second effect",
  () => probe("stop-window"),
);

it.effect(
  "server-originated dispatch after Stop starts a run once; a repeat has no second effect",
  () => probe("after-stop"),
);

// Layer note: dispatchCommand requires ThreadManagementService, ServerConfig, FileSystem and DocumentText (the last three only for attachments).
// aetheriaBackend.ts is given only EventSinkV2 and McpProviderSessions, so it reaches none of them. This file composes them from testkit
// layers, not the production graph.
