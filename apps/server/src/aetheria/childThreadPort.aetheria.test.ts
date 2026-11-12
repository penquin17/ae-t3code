// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M05 Plan step 6 (C2 ThreadPort table, C10, R1) — the ThreadPort adapter against T3's real services.
//
// Boundary. The real ThreadManagementService, Orchestrator, EventSink, EventStore, ProjectionStore, ProviderSessionManager, effect worker and IdAllocator on one
// in-memory SQLite database (T3's ProviderReplayHarness, as heldChild.aetheria.test.ts uses it), through the adapter in threadPort.ts. The ONLY double is the
// provider: a scripted adapter that records openSession / ensureThread / resumeThread / startTurn per thread and reports Pi-style session file names.
// Shows: a child is created held (visible task and lineage, `preparing` run, no provider work); binding opens the session, ensures the thread and persists it
// before release, once however often it is repeated; release starts exactly one turn and a repeat is accepted without a second; a repeated message id is a
// replay; status, close and an absent target's interrupt answer as the table says; readDelegatedCompletion and readRestartNotes answer from the projections.
// Does NOT show: real Pi (heldChild/piSessionPreBind do), the children service, a terminal `run.updated` reaching a subscriber (no scripted provider turn is
// completed here; the mapping table is checked as data), or the delegated-completion delivery to a parent.
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
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as NodeFS from "node:fs";

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
import { makeChildThreadPort, piSessionIdOf, terminalOutcomeOf } from "./threadPort.ts";
import { forkSlotKey, requestPiSessionId } from "./piSessionIdSeam.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test-model" };
/** The Pi session id the children service chose for the child and asks the Pi adapter to open the session with. */
const CHOSEN = "0197d3c0-aaaa-7000-8000-00000000cafe";

/** A scripted provider reporting Pi-style session file names (`<time>_<id>.jsonl`), one fresh id per ensureThread. */
const scriptedProvider = Effect.fn("childThreadPort.scriptedProvider")(function* (name: string) {
  const cwd = yield* checkpointWorkspace(name);
  const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
  const log = {
    opened: [] as Array<{ threadId: string; cwd: string | null }>,
    ensured: [] as string[],
    /** What the session-id slot held for each ensureThread (IP-25): the id the Backend adapter requested for that launch, or undefined. */
    requested: [] as Array<string | undefined>,
    ensuredCwd: new Map<string, string | null>(),
    started: [] as ProviderAdapter.ProviderAdapterV2TurnInput[],
    /** The app thread of every provider thread T3 asked this provider to interrupt. */
    interrupted: [] as string[],
  };
  let counter = 0;
  const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (input) =>
      Effect.gen(function* () {
        log.opened.push({ threadId: `${input.threadId}`, cwd: input.runtimePolicy?.cwd ?? null });
        const now = yield* DateTime.now;
        const thread = (
          threadId: ThreadId,
          providerSessionId: typeof input.providerSessionId,
          requested?: string,
        ) => {
          counter += 1;
          return {
            id: ProviderThreadId.make(`provider-thread:${threadId}`),
            driver,
            providerInstanceId: instanceId,
            providerSessionId,
            appThreadId: threadId,
            ownerNodeId: null,
            nativeThreadRef: {
              driver,
              nativeId: `/sessions/2026-11-11_${requested ?? `0197d3c0-0000-7000-8000-00000000000${counter}`}.jsonl`,
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
          };
        };
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
          ensureThread: ({ threadId, existingProviderThread, runtimePolicy }) =>
            Effect.sync(() => {
              log.ensured.push(`${threadId}`);
              log.ensuredCwd.set(`${threadId}`, runtimePolicy?.cwd ?? null);
              // Pi opens a session with the id the Pi adapter was asked for (IP-25); this provider reads the same slot the adapter reads, so it honours a request as Pi does.
              const seam = (
                globalThis as Record<
                  symbol,
                  { readonly take: (id: string) => string | undefined } | undefined
                >
              )[Symbol.for("aetheria.pi.session-id-seam")];
              const requested = seam?.take(`${threadId}`);
              log.requested.push(requested);
              return requested;
            }).pipe(
              Effect.map((requested) => {
                const fresh = thread(threadId, input.providerSessionId, requested);
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
          resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
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
          interruptTurn: (input) =>
            Effect.sync(() => void log.interrupted.push(String(input.providerThread.appThreadId))),
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
    prefix: "t3-child-port-",
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

const startParent = (cwd: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
    const parent = ThreadId.make("thread:parent");
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create:parent"),
      threadId: parent,
      projectId: ProjectId.make("project:child-port"),
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
    const run = (yield* orchestrator.getThreadProjection(parent)).runs[0]!;
    return { parent, runId: run.id, nodeId: run.rootNodeId as NodeId };
  });

type Script = Effect.Success<ReturnType<typeof scriptedProvider>>;

const scenario = <A, E>(name: string, body: (script: Script) => Effect.Effect<A, E, any>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const script = yield* scriptedProvider(name);
      return yield* body(script).pipe(Effect.provide(layerRuntime(name, script.adapter)));
    }),
  );

const portOver = Effect.gen(function* () {
  return yield* makeChildThreadPort({
    threads: yield* ThreadManagementService.ThreadManagementService,
    orchestrator: yield* Orchestrator.OrchestratorV2,
    sessions: yield* ProviderSessionManager.ProviderSessionManagerV2,
    sink: yield* EventSink.EventSinkV2,
    ids: yield* IdAllocator.IdAllocatorV2,
  });
});

const spawnInput = (parent: { parent: ThreadId; runId: unknown; nodeId: NodeId }, cwd: string) => ({
  commandId: "m05-test-spawn:1",
  parentThreadId: String(parent.parent),
  parentRunId: String(parent.runId),
  parentNodeId: String(parent.nodeId),
  task: "the held task",
  modelSelection: { provider: "codex", model: "test-model" },
  runtimeMode: "full-access",
  interactionMode: "default",
  workingFolder: cwd,
  completionWake: "always" as const,
});

it.effect(
  "creates a held child, binds its session before release once, and releases exactly one turn",
  () =>
    scenario("create-bind-release", (script) =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const port = yield* portOver;
        const parent = yield* startParent(script.cwd);

        const created = yield* Effect.promise(() =>
          port.createChildThread(spawnInput(parent, `${script.cwd}/child-work`)),
        );
        assert.isTrue(created.ok, JSON.stringify(created));
        if (!created.ok) return;
        yield* worker.drain();
        const held = yield* orchestrator.getThreadProjection(ThreadId.make(created.threadId));
        // Lineage and the held task are visible; no provider work has happened for the child.
        assert.equal(created.lineage.relationshipToParent, "subagent");
        assert.equal(created.lineage.parentThreadId, "thread:parent");
        assert.equal(held.messages[0]?.id, created.heldMessageId);
        assert.equal(held.messages[0]?.text, "the held task");
        assert.equal(held.runs[0]?.status, "preparing");
        assert.isUndefined(script.log.started.find((turn) => turn.threadId === created.threadId));
        assert.notInclude(script.log.ensured, created.threadId);

        // The same command id is a replay: the same child, no second thread.
        const again = yield* Effect.promise(() =>
          port.createChildThread(spawnInput(parent, script.cwd)),
        );
        assert.isTrue(again.ok);
        if (again.ok) assert.equal(again.threadId, created.threadId);

        // Bind: the real session id before any prompt, persisted; a repeat makes no second session.
        const bound = yield* Effect.promise(() =>
          port.bindChildSession({
            threadId: created.threadId,
            heldMessageId: created.heldMessageId,
            piSessionId: CHOSEN,
          }),
        );
        assert.isTrue(bound.ok, JSON.stringify(bound));
        if (!bound.ok) return;
        // The id the service chose is requested for the session's launch (IP-25) and is the id the provider opens; the request is gone afterwards.
        assert.equal(bound.piSessionId, CHOSEN);
        assert.deepEqual(
          script.log.requested.filter((id) => id !== undefined),
          [CHOSEN],
          "only the child's launch carried a request (the parent's own ensureThread asked for none)",
        );
        // NOT shown: that the working folder reaches the provider. Observed with this scripted provider: T3 served the child from the parent's already-open
        // provider session, and the ensureThread the adapter called did not carry the child's folder (`ensuredCwd` below records what the provider saw). Whether
        // a real Pi child session is created in the given folder is a question for the real-Pi slice (step 9), not answered here.
        void script.log.ensuredCwd;
        const repeat = yield* Effect.promise(() =>
          port.bindChildSession({
            threadId: created.threadId,
            heldMessageId: created.heldMessageId,
            piSessionId: CHOSEN,
          }),
        );
        assert.isTrue(repeat.ok && repeat.piSessionId === bound.piSessionId);
        assert.deepEqual(
          script.log.requested.filter((id) => id !== undefined),
          [CHOSEN],
          "a repeat opens no second session and requests nothing",
        );
        assert.equal(script.log.ensured.filter((id) => id === created.threadId).length, 1);
        assert.isUndefined(script.log.started.find((turn) => turn.threadId === created.threadId));
        const persisted = yield* orchestrator.getThreadProjection(ThreadId.make(created.threadId));
        assert.equal(
          piSessionIdOf(persisted.providerThreads[0]?.nativeThreadRef?.nativeId),
          bound.piSessionId,
        );

        // Release: one turn, using the persisted session; a repeat is accepted and adds nothing.
        const release = yield* Effect.promise(() =>
          port.releaseFirstTurn({
            threadId: created.threadId,
            heldMessageId: created.heldMessageId,
          }),
        );
        assert.deepEqual(release, { ok: true, accepted: true });
        yield* worker.drain();
        assert.equal(
          script.log.started.filter((turn) => turn.threadId === created.threadId).length,
          1,
        );
        assert.equal(script.log.ensured.filter((id) => id === created.threadId).length, 1);
        const releaseAgain = yield* Effect.promise(() =>
          port.releaseFirstTurn({
            threadId: created.threadId,
            heldMessageId: created.heldMessageId,
          }),
        );
        assert.deepEqual(releaseAgain, { ok: true, accepted: true });
        yield* worker.drain();
        assert.equal(
          script.log.started.filter((turn) => turn.threadId === created.threadId).length,
          1,
        );

        // Status reads the run state; the thread is not idle while its run is live.
        const status = yield* Effect.promise(() => port.status({ threadId: created.threadId }));
        assert.isTrue(status.ok && status.status.activity === "running");
      }),
    ),
);

it.effect(
  "suppressCompletionDelivery disposes the child's task delivery through T3's own command (idempotent, held child), and readChildResult answers not-terminal until T3 records a result",
  () =>
    scenario("suppress-and-result", (script) =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const port = yield* portOver;
        const parent = yield* startParent(script.cwd);
        const created = yield* Effect.promise(() =>
          port.createChildThread(spawnInput(parent, `${script.cwd}/child-work`)),
        );
        assert.isTrue(created.ok, JSON.stringify(created));
        if (!created.ok) return;
        const taskOf = () =>
          orchestrator
            .getThreadProjection(parent.parent)
            .pipe(
              Effect.map((projection) =>
                projection.subagents.find((s) => String(s.childThreadId) === created.threadId),
              ),
            );
        assert.isDefined(yield* taskOf(), "the parent holds the child's task");
        assert.notEqual((yield* taskOf())?.completionDelivery?.state, "disposed");
        const input = { threadId: created.threadId, parentThreadId: String(parent.parent) };
        const first = yield* Effect.promise(() => port.suppressCompletionDelivery(input));
        assert.deepEqual(first, { ok: true, suppressed: true });
        assert.equal((yield* taskOf())?.completionDelivery?.state, "disposed");
        const repeat = yield* Effect.promise(() => port.suppressCompletionDelivery(input));
        assert.deepEqual(repeat, { ok: true, suppressed: true }, "a repeat is accepted");
        assert.equal((yield* taskOf())?.completionDelivery?.state, "disposed");
        const unknownTask = yield* Effect.promise(() =>
          port.suppressCompletionDelivery({
            threadId: "thread:nobody",
            parentThreadId: String(parent.parent),
          }),
        );
        assert.isFalse(unknownTask.ok);
        const result = yield* Effect.promise(() =>
          port.readChildResult({ threadId: created.threadId }),
        );
        assert.isFalse(result.ok);
        assert.equal(!result.ok && result.reason, "not-terminal");
        const missing = yield* Effect.promise(() =>
          port.readChildResult({ threadId: "thread:nobody" }),
        );
        assert.isFalse(missing.ok);
        assert.equal(!missing.ok && missing.reason, "unavailable");
      }),
    ),
);

/** A parent with one released child; returns the parent, the child's thread id and a reader of its delegated task status. */
const parentWithRunningChild = (script: Script) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
    const port = yield* portOver;
    const parent = yield* startParent(script.cwd);
    const children: string[] = [];
    // One released child: one running delegated task is enough to tell T3's per-thread stop from its cascade. The child's folder must exist for T3 to open its session.
    yield* Effect.sync(() => NodeFS.mkdirSync(`${script.cwd}/child-work`, { recursive: true }));
    for (const n of [1]) {
      const created = yield* Effect.promise(() =>
        port.createChildThread({
          ...spawnInput(parent, `${script.cwd}/child-work`),
          commandId: `m05-test-spawn:${n}`,
        }),
      );
      assert.isTrue(created.ok, JSON.stringify(created));
      if (!created.ok) return yield* Effect.die("create failed");
      yield* worker.drain();
      const bound = yield* Effect.promise(() =>
        port.bindChildSession({
          threadId: created.threadId,
          heldMessageId: created.heldMessageId,
          piSessionId: CHOSEN,
        }),
      );
      assert.isTrue(bound.ok, JSON.stringify(bound));
      const released = yield* Effect.promise(() =>
        port.releaseFirstTurn({ threadId: created.threadId, heldMessageId: created.heldMessageId }),
      );
      assert.isTrue(released.ok, JSON.stringify(released));
      children.push(created.threadId);
    }
    yield* worker.drain();
    /** The delegated task's status on the parent and the child's own newest run status: both must stay as they were for a per-thread stop. */
    const taskStatuses = () =>
      Effect.gen(function* () {
        const projection = yield* orchestrator.getThreadProjection(parent.parent);
        const out: string[] = [];
        for (const id of children) {
          const task = projection.subagents.find((s) => String(s.childThreadId) === id);
          const child = yield* orchestrator.getThreadProjection(ThreadId.make(id));
          const run = [...child.runs].sort((a, b) => b.ordinal - a.ordinal)[0];
          out.push(`${task?.status}/${run?.status}`);
        }
        return out;
      });
    return { port, parent, children, taskStatuses, worker };
  });

it.effect(
  "the root's stop through the port (stopDelegatedTasks false) interrupts the root's own run and never asks the provider to interrupt the child's (this test can fail: see the contrast)",
  () =>
    scenario("root-stop", (script) =>
      Effect.gen(function* () {
        const { port, parent, children, taskStatuses, worker } =
          yield* parentWithRunningChild(script);
        assert.deepEqual(yield* taskStatuses(), ["running/running"]);
        const stopped = yield* Effect.promise(() =>
          port.close({ threadId: String(parent.parent) }),
        );
        assert.isTrue(stopped.ok, JSON.stringify(stopped));
        yield* worker.drain();
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const parentRun = (yield* orchestrator.getThreadProjection(parent.parent)).runs[0];
        assert.equal(parentRun?.status, "interrupted", "the stop took effect on the root");
        assert.include(
          script.log.interrupted,
          String(parent.parent),
          "the root's own turn was interrupted",
        );
        assert.notInclude(script.log.interrupted, children[0], "the child's turn was not");
        assert.deepEqual(
          (yield* taskStatuses())[0],
          "running/running",
          "its task and run are untouched",
        );
      }),
    ),
);

it.effect(
  "contrast: T3's own cascade (ThreadManagementService.stopDelegatedTasks, what its Stop button uses) does stop the child, so the test above can fail",
  () =>
    scenario("root-stop-cascade", (script) =>
      Effect.gen(function* () {
        const { parent, taskStatuses, worker } = yield* parentWithRunningChild(script);
        const threads = yield* ThreadManagementService.ThreadManagementService;
        yield* threads.dispatch({
          type: "thread.stop",
          commandId: CommandId.make("m05-test-native-stop"),
          threadId: parent.parent,
          reason: "contrast",
          stopDelegatedTasks: false,
        });
        yield* threads.stopDelegatedTasks({
          threadId: parent.parent,
          commandId: CommandId.make("m05-test-native-stop"),
          reason: "contrast",
        });
        yield* worker.drain();
        assert.notDeepEqual(yield* taskStatuses(), ["running/running"]);
      }),
    ),
);

it.effect(
  "readLastRun answers the newest run: a held child's unreleased run is active, a thread T3 does not know is unavailable (never null or idle)",
  () =>
    scenario("last-run", (script) =>
      Effect.gen(function* () {
        const port = yield* portOver;
        const parent = yield* startParent(script.cwd);
        const created = yield* Effect.promise(() =>
          port.createChildThread(spawnInput(parent, `${script.cwd}/child-work`)),
        );
        assert.isTrue(created.ok, JSON.stringify(created));
        if (!created.ok) return;
        const held = yield* Effect.promise(() => port.readLastRun({ threadId: created.threadId }));
        assert.isTrue(held.ok);
        assert.equal(held.ok && held.run?.outcome, "active");
        assert.equal(held.ok && held.run?.settledAt, null);
        const parentRun = yield* Effect.promise(() =>
          port.readLastRun({ threadId: String(parent.parent) }),
        );
        assert.isTrue(parentRun.ok && parentRun.run !== null);
        const missing = yield* Effect.promise(() =>
          port.readLastRun({ threadId: "thread:nobody" }),
        );
        assert.isFalse(missing.ok);
        assert.equal(!missing.ok && missing.reason, "unavailable");
      }),
    ),
);

it.effect(
  "a fork with no stable source run is fork-failed and the detail carries T3's own reason (its dispatch error keeps the reason in `cause`), not 'the T3 call failed'",
  () =>
    scenario("fork-detail", (script) =>
      Effect.gen(function* () {
        const port = yield* portOver;
        const parent = yield* startParent(script.cwd);
        // The parent's first turn is still running: there is no completed run with a checkpoint to fork from.
        const forked = yield* Effect.promise(() =>
          port.forkThread({
            parentThreadId: String(parent.parent),
            sourcePoint: "latest_stable",
            targetThreadId: "thread:fork-detail-target",
            piSessionId: "11111111-2222-4333-8444-555555555555",
          }),
        );
        assert.isFalse(forked.ok);
        assert.equal(!forked.ok && forked.reason, "fork-failed");
        assert.match(!forked.ok ? (forked.detail ?? "") : "", /No stable source run/);
        // A failed fork withdraws the session id it asked for, so nothing is left for a later launch.
        const seam = (
          globalThis as Record<symbol, { take(id: string): string | undefined } | undefined>
        )[Symbol.for("aetheria.pi.session-id-seam")];
        assert.isUndefined(seam?.take("fork:thread:fork-detail-target"));
        assert.isUndefined(
          seam?.take("thread:fork-detail-target"),
          "and not under the plain key either",
        );
      }),
    ),
);

it.effect(
  "the chosen session id is requested under both keys and released by withdrawForkRequest and by close: the plain key for the portable route's open launch, `fork:<id>` for the native route's --fork launch",
  () =>
    scenario("fork-keys", (script) =>
      Effect.gen(function* () {
        void script;
        const port = yield* portOver;
        const take = (key: string): string | undefined =>
          (globalThis as Record<symbol, { take(id: string): string | undefined } | undefined>)[
            Symbol.for("aetheria.pi.session-id-seam")
          ]?.take(key);
        // Make the requests the way forkThread does (the dispatch itself needs a finished parent turn, which the native run covers), then release them through the port.
        requestPiSessionId("thread:fork-keys", "id-1");
        requestPiSessionId(forkSlotKey("thread:fork-keys"), "id-1");
        const released = yield* Effect.promise(() =>
          port.withdrawForkRequest({ threadId: "thread:fork-keys" }),
        );
        assert.deepEqual(released, { ok: true, released: true });
        assert.isUndefined(take("thread:fork-keys"));
        assert.isUndefined(take(forkSlotKey("thread:fork-keys")));
        requestPiSessionId("thread:fork-closed", "id-2");
        requestPiSessionId(forkSlotKey("thread:fork-closed"), "id-2");
        yield* Effect.promise(() => port.close({ threadId: "thread:fork-closed" }));
        assert.isUndefined(take("thread:fork-closed"), "close releases the plain key");
        assert.isUndefined(take(forkSlotKey("thread:fork-closed")), "and the fork key");
      }),
    ),
);

it.effect(
  "a fork at a run is accepted only at the parent's latest completed run: with none it is prefix-unsupported naming the latest finished turn, an unreadable parent is unavailable, and nothing is created or requested",
  () =>
    scenario("fork-latest-only", (script) =>
      Effect.gen(function* () {
        const port = yield* portOver;
        const parent = yield* startParent(script.cwd);
        const seam = (
          globalThis as Record<symbol, { take(id: string): string | undefined } | undefined>
        )[Symbol.for("aetheria.pi.session-id-seam")];
        const earlier = yield* Effect.promise(() =>
          port.forkThread({
            parentThreadId: String(parent.parent),
            sourcePoint: { run: "run:thread:parent:ordinal:1" },
            targetThreadId: "thread:fork-earlier-target",
            piSessionId: "11111111-2222-4333-8444-555555555555",
          }),
        );
        assert.isFalse(earlier.ok);
        assert.equal(!earlier.ok && earlier.reason, "prefix-unsupported");
        assert.match(!earlier.ok ? (earlier.detail ?? "") : "", /latest finished turn/);
        assert.isUndefined(
          seam?.take("fork:thread:fork-earlier-target"),
          "no session id was requested",
        );
        const target = yield* Effect.promise(() =>
          port.readLastRun({ threadId: "thread:fork-earlier-target" }),
        );
        assert.isFalse(target.ok, "no fork thread exists");
        const unreadable = yield* Effect.promise(() =>
          port.forkThread({
            parentThreadId: "thread:nobody",
            sourcePoint: { run: "run:thread:nobody:ordinal:1" },
            targetThreadId: "thread:fork-unreadable-target",
            piSessionId: "11111111-2222-4333-8444-555555555555",
          }),
        );
        assert.isFalse(unreadable.ok);
        assert.equal(!unreadable.ok && unreadable.reason, "unavailable");
      }),
    ),
);

it.effect("refuses an unknown parent and reports a bind it cannot do, never success", () =>
  scenario("failures", (script) =>
    Effect.gen(function* () {
      const port = yield* portOver;
      const parent = yield* startParent(script.cwd);
      const lost = yield* Effect.promise(() =>
        port.createChildThread({
          ...spawnInput(parent, script.cwd),
          commandId: "m05-test-spawn:lost",
          parentRunId: "run:does-not-exist",
        }),
      );
      assert.isFalse(lost.ok);
      const noThread = yield* Effect.promise(() =>
        port.bindChildSession({
          threadId: "thread:nobody",
          heldMessageId: "message:none",
          piSessionId: CHOSEN,
        }),
      );
      assert.isFalse(noThread.ok);
      // A bind that fails leaves no request behind for a later launch of that thread (IP-25).
      assert.isUndefined(
        (
          globalThis as Record<
            symbol,
            { readonly take: (id: string) => string | undefined } | undefined
          >
        )[Symbol.for("aetheria.pi.session-id-seam")]?.take("thread:nobody"),
      );
      const noRelease = yield* Effect.promise(() =>
        port.releaseFirstTurn({ threadId: "thread:nobody", heldMessageId: "message:none" }),
      );
      assert.isFalse(noRelease.ok);
      const status = yield* Effect.promise(() => port.status({ threadId: "thread:nobody" }));
      assert.isFalse(status.ok);
      // An absent target's interrupt is an accepted no-op only when T3 says not found; any other failure is unavailable, not success.
      const gone = yield* Effect.promise(() => port.close({ threadId: "thread:nobody" }));
      assert.isTrue(gone.ok || gone.reason === "unavailable");
    }),
  ),
);

it.effect(
  "a repeated message id is a replay, and the delegated-completion and restart reads answer from the projections",
  () =>
    scenario("turn-replay-reads", (script) =>
      Effect.gen(function* () {
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const port = yield* portOver;
        const parent = yield* startParent(script.cwd);
        const created = yield* Effect.promise(() =>
          port.createChildThread(spawnInput(parent, script.cwd)),
        );
        if (!created.ok) return assert.fail(JSON.stringify(created));
        yield* Effect.promise(() =>
          port.bindChildSession({
            threadId: created.threadId,
            heldMessageId: created.heldMessageId,
            piSessionId: CHOSEN,
          }),
        );
        yield* Effect.promise(() =>
          port.releaseFirstTurn({
            threadId: created.threadId,
            heldMessageId: created.heldMessageId,
          }),
        );
        yield* worker.drain();
        const first = yield* Effect.promise(() =>
          port.startTurn({
            threadId: created.threadId,
            content: "more",
            delivery: "queue",
            messageId: "message:m05-1",
          }),
        );
        const second = yield* Effect.promise(() =>
          port.startTurn({
            threadId: created.threadId,
            content: "more",
            delivery: "queue",
            messageId: "message:m05-1",
          }),
        );
        assert.isTrue(first.ok && second.ok, JSON.stringify([first, second]));
        yield* worker.drain();
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const projection = yield* orchestrator.getThreadProjection(ThreadId.make(created.threadId));
        assert.equal(
          projection.messages.filter((message) => message.id === "message:m05-1").length,
          1,
        );

        const completion = yield* Effect.promise(() =>
          port.readDelegatedCompletion({ threadId: created.threadId }),
        );
        assert.isTrue(completion.ok || completion.reason === "unavailable");
        const notes = yield* Effect.promise(() =>
          port.readRestartNotes({ threadId: created.threadId }),
        );
        assert.deepEqual(notes, { ok: true, notes: [] });
        const closed = yield* Effect.promise(() => port.close({ threadId: created.threadId }));
        assert.deepEqual(closed, { ok: true, closed: true });
      }),
    ),
);

it("maps only terminal T3 run statuses, treats waiting and the unknown as not terminal, and names Pi sessions only by their file", () => {
  assert.equal(terminalOutcomeOf("completed"), "completed");
  assert.equal(terminalOutcomeOf("failed"), "failed");
  assert.equal(terminalOutcomeOf("rolled_back"), "failed");
  assert.equal(terminalOutcomeOf("interrupted"), "interrupted");
  assert.equal(terminalOutcomeOf("cancelled"), "interrupted");
  for (const status of ["waiting", "running", "preparing", "queued", "", undefined, 3, "toString"])
    assert.isNull(terminalOutcomeOf(status));
  assert.equal(piSessionIdOf("/s/2026-11-11T10-00_abc-123.jsonl"), "abc-123");
  assert.isUndefined(piSessionIdOf("native-thread:x"));
  assert.isUndefined(piSessionIdOf(undefined));
});
