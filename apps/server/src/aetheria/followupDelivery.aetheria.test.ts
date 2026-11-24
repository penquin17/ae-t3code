// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDateInEffect:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA cycle v1p2-foundations, step C0 — does a parent's FOLLOW-UP message to its child reach the parent as a completion, exactly once, the way the first run's does?
//
// Question. T3 re-arms a delegated task for a follow-up run only when the message is `mcp`-sourced from the parent (`mayStartSubagentFollowup`, `recordSubagentFollowup`).
// The Backend adapter's `startTurn` sends a parent-to-child message so (`fromParent`). After a child's first completion was delivered, does a second `startTurn` bring the
// child's second answer to the parent as a second delivery message bound to the follow-up's task, exactly once, and a busy parent only when it settles?
//
// Boundary. The real ThreadManagementService, Orchestrator, EventSink, ProviderSessionManager and T3's continuation worker on one in-memory SQLite database
// (as piChildDelivery.aetheria.test.ts) with the REAL Pi adapter for both threads on installed Pi 1.5.0 and Pi's faux provider as a test extension. No model, no credential. The
// child is made by T3's own `delegated_task.request` (`completionWake: "always"`); the follow-up goes through the Backend adapter's own `startTurn`.
//
// Shows: a second delivery message with its own task, once; a replay of the same message id adds nothing; a follow-up WITHOUT `fromParent` (the old shape) brings no task and no
// delivery, so the test can fail; a busy parent gets the second delivery only after its own run settles; `readDelegatedCompletion` answers for the latest task.
// Does NOT show: a Backend restart between the follow-up and its completion, or the Aetheria extension inside either thread.
/* oxlint-disable t3code/no-real-time-wait-in-tests, t3code/no-test-timeout-or-unreasoned-skip -- Real Pi subprocesses; no background worker, so drain() repeats. */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as ServerConfig from "../config.ts";
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
import { makeChildThreadPort } from "./threadPort.ts";
import { PI_INSTANCE_ID, makePi, makeWorld, selection, waitFor } from "./piProbeKit.ts";

const FAUX_RETRY = NodePath.join(
  import.meta.dirname,
  "../../../../../../tests/orchestration/probes/faux-retry-trace.mjs",
);
const TERMINAL = new Set(["completed", "failed", "rolled_back", "interrupted", "cancelled"]);

const layerPlatform = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  McpProviderSessions.layer,
  TestProviderHost.layer().pipe(Layer.provide(NodeServices.layer)),
);

const layerRuntime = (
  name: string,
  adapter: Parameters<typeof ProviderAdapterRegistry.layerSingle>[0],
) => {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerIntake = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-followup-probe-",
  }).pipe(Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))));
  const layerThreads = ThreadManagementService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        layerDatabase,
        EventStore.layer.pipe(Layer.provide(layerDatabase)),
        ProviderReplayHarness.layerWithRegistry(
          { name },
          ProviderAdapterRegistry.layerSingle(adapter),
          { databaseLayer: layerDatabase, runEffectWorker: false, runContinuationWorker: true },
        ),
      ),
    ),
    Layer.provideMerge(
      ServerSettings.layerTest({
        providerInstances: {
          [PI_INSTANCE_ID]: { driver: ProviderDriverKind.make("pi"), enabled: true },
        },
      }),
    ),
    Layer.provideMerge(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
  );
  return Layer.mergeAll(layerThreads, layerIntake);
};

interface Stamped {
  readonly type: string;
  readonly threadId?: string | undefined;
  readonly status?: string | undefined;
}

interface Ctx {
  readonly orchestrator: Orchestrator.OrchestratorV2["Service"];
  readonly worker: EffectWorker.OrchestrationEffectWorkerV2["Service"];
  readonly port: Effect.Success<ReturnType<typeof makeChildThreadPort>>;
  readonly parent: ThreadId;
  readonly child: ThreadId;
  readonly firstTaskId: string;
  readonly go: string;
  readonly settle: (turns: number) => Effect.Effect<void, unknown>;
  readonly childTerminalRuns: () => number;
  readonly parentRequests: () => Array<{ kind: string; text?: string; parent?: boolean }>;
  readonly deliveries: () => Effect.Effect<
    ReadonlyArray<{
      readonly id: string;
      readonly delegatedCompletion?: { readonly taskIds: ReadonlyArray<string> } | undefined;
    }>,
    unknown
  >;
}

/**
 * The shared start: a parent whose first run waits for the `go` file, a child spawned under it by T3's own command (completion wake "always"), the parent released, and the child's
 * FIRST completion delivered to the parent (one delivery message, the parent idle again). `body` then plays the follow-up.
 */
const scenario = <A, E, R>(name: string, body: (ctx: Ctx) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: `m05-${name}-` });
    const trace = NodePath.join(root, "trace.jsonl");
    const go = NodePath.join(root, "parent-go");
    const world = makeWorld(root, [], { FAUX_TRACE: trace, FAUX_PARENT_GO: go });
    const cwd = yield* checkpointWorkspace(`m05-${name}`);
    const { adapter } = yield* makePi(world, [FAUX_RETRY]);
    const readTrace = (): Array<{ kind: string; text?: string; parent?: boolean }> =>
      NodeFS.existsSync(trace)
        ? NodeFS.readFileSync(trace, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l))
        : [];
    return yield* Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      const threads = yield* ThreadManagementService.ThreadManagementService;
      const seen: Array<Stamped> = [];
      yield* orchestrator.streamDomainEvents.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            const payload = (event as { payload?: { status?: string } }).payload;
            seen.push({
              type: event.type,
              threadId: (event as { threadId?: string }).threadId,
              status: payload?.status,
            });
          }),
        ),
        Effect.forkScoped,
      );
      const settle = (turns: number) =>
        Effect.gen(function* () {
          for (let attempt = 0; attempt < turns; attempt += 1) {
            yield* Effect.promise(() => new Promise((r) => setTimeout(r, 250)));
            yield* worker.drain();
          }
        });
      const parent = ThreadId.make(`thread:m05-${name}-parent`);
      yield* orchestrator.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`create:m05-${name}-parent`),
        threadId: parent,
        projectId: ProjectId.make(`project:m05-${name}`),
        title: "parent",
        modelSelection: selection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: cwd,
        createdBy: "user",
        creationSource: "web",
      });
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`first:m05-${name}-parent`),
        threadId: parent,
        messageId: MessageId.make(`message:m05-${name}-parent`),
        text: "PARENT wait for the child",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      });
      yield* worker.drain();
      yield* waitFor("the parent's request to reach the provider", () =>
        readTrace().find((r) => r.kind === "request" && r.parent === true),
      );
      const parentRun = (yield* orchestrator.getThreadProjection(parent)).runs[0]!;
      yield* threads.dispatch({
        type: "delegated_task.request",
        commandId: CommandId.make(`m05-${name}-spawn`),
        parentThreadId: parent,
        parentRunId: parentRun.id,
        parentNodeId: parentRun.rootNodeId as NodeId,
        task: "retry-task: do the work",
        completionWake: "always",
        modelSelection: selection,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdBy: "agent",
        creationSource: "server",
      });
      const first = (yield* orchestrator.getThreadProjection(parent)).subagents.find((s) =>
        s.prompt.startsWith("retry-task"),
      )!;
      const child = first.childThreadId!;
      const childTerminalRuns = () =>
        seen.filter(
          (e) => e.type === "run.updated" && e.threadId === child && TERMINAL.has(e.status ?? ""),
        ).length;
      yield* worker.drain();
      for (let attempt = 0; attempt < 120 && childTerminalRuns() < 1; attempt += 1)
        yield* settle(1);
      assert.isAtLeast(childTerminalRuns(), 1, "the child never completed its first run");
      NodeFS.writeFileSync(go, "go");
      const deliveries = () =>
        orchestrator
          .getThreadProjection(parent)
          .pipe(Effect.map((p) => p.messages.filter((m) => m.delegatedCompletion !== undefined)));
      for (let attempt = 0; attempt < 160 && (yield* deliveries()).length < 1; attempt += 1)
        yield* settle(1);
      // The delivery turn must finish too, so the parent is idle when the follow-up starts.
      yield* settle(16);
      assert.lengthOf(yield* deliveries(), 1, "the first completion is delivered once");
      const port = yield* makeChildThreadPort({
        threads,
        orchestrator,
        sessions: yield* ProviderSessionManager.ProviderSessionManagerV2,
        sink: yield* EventSink.EventSinkV2,
        ids: yield* IdAllocator.IdAllocatorV2,
      });
      return yield* body({
        orchestrator,
        worker,
        port,
        parent,
        child,
        firstTaskId: first.id,
        go,
        settle,
        childTerminalRuns,
        parentRequests: () => readTrace().filter((r) => r.kind === "request" && r.parent === true),
        deliveries,
      });
    }).pipe(Effect.provide(layerRuntime(name, adapter)));
  }).pipe(Effect.scoped, Effect.provide(layerPlatform));

/** Starts the follow-up through the adapter's `startTurn`, shaped as the control layer shapes a parent's message to its child (or, when `old`, as it did before this step). */
const followUp = (ctx: Ctx, messageId: string, options: { readonly old?: boolean } = {}) =>
  Effect.promise(() =>
    ctx.port.startTurn({
      threadId: String(ctx.child),
      content: "second job",
      delivery: "queue",
      messageId,
      ...(options.old === true
        ? {}
        : { senderThreadId: String(ctx.parent), fromParent: true as const }),
    }),
  );

const tasksOfChild = (ctx: Ctx) =>
  ctx.orchestrator
    .getThreadProjection(ctx.parent)
    .pipe(Effect.map((p) => p.subagents.filter((s) => s.childThreadId === ctx.child)));

it.live(
  "a follow-up to a child brings the child's second answer to the parent as its own delivery, exactly once, and a replay adds nothing",
  () =>
    scenario("followup-once", (ctx) =>
      Effect.gen(function* () {
        const before = ctx.parentRequests().length;
        const sent = yield* followUp(ctx, "followup-once-1");
        assert.isTrue(sent.ok, JSON.stringify(sent));
        // T3 opened the follow-up's task at dispatch. The spawn's task is already delivered, so reading the first task would say "delivered" here; the latest says it is still owed.
        const early = yield* Effect.promise(() =>
          ctx.port.readDelegatedCompletion({ threadId: String(ctx.child) }),
        );
        assert.deepEqual(early, { ok: true, state: "pending" });
        for (
          let attempt = 0;
          attempt < 160 && (ctx.childTerminalRuns() < 2 || (yield* ctx.deliveries()).length < 2);
          attempt += 1
        )
          yield* ctx.settle(1);
        // Extra time: a duplicate delivery or a second follow-up run would show here.
        yield* ctx.settle(16);

        const delivered = yield* ctx.deliveries();
        assert.lengthOf(delivered, 2, JSON.stringify(delivered));
        const tasks = yield* tasksOfChild(ctx);
        assert.lengthOf(tasks, 2, "the spawn's task and the follow-up's task");
        const second = tasks.find((t) => t.id !== ctx.firstTaskId)!;
        assert.equal(second.prompt, "second job");
        assert.equal(second.status, "completed");
        assert.isAbove((second.result ?? "").length, 0);
        // The second delivery is bound to the follow-up's task alone; the first to the spawn's.
        assert.deepEqual(delivered[0]!.delegatedCompletion!.taskIds, [ctx.firstTaskId]);
        assert.deepEqual(delivered[1]!.delegatedCompletion!.taskIds, [second.id]);
        assert.include(["delivered", "acknowledged"], second.completionDelivery?.state);
        assert.equal(ctx.childTerminalRuns(), 2, "one child run per message");
        assert.equal(
          ctx.parentRequests().length,
          before + 1,
          "one parent request carried the second delivery",
        );
        // Once T3 has delivered the follow-up's completion its cohort record is cleared (as for the first), so the state is the answer.
        const read = yield* Effect.promise(() =>
          ctx.port.readDelegatedCompletion({ threadId: String(ctx.child) }),
        );
        assert.isTrue(read.ok, JSON.stringify(read));
        if (read.ok) assert.include(["delivered", "acknowledged"], read.state);

        // Replay of the same message id (T3 deduplicates by command id): no second message, run, task or delivery.
        const again = yield* followUp(ctx, "followup-once-1");
        assert.isTrue(again.ok, JSON.stringify(again));
        yield* ctx.settle(16);
        assert.lengthOf(yield* ctx.deliveries(), 2);
        assert.lengthOf(yield* tasksOfChild(ctx), 2);
        assert.equal(ctx.childTerminalRuns(), 2);
        assert.equal(ctx.parentRequests().length, before + 1);
      }),
    ),
  300_000,
);

it.live(
  "control: the follow-up WITHOUT the parent mark (the old shape) starts a child run but opens no task and delivers nothing",
  () =>
    scenario("followup-old-shape", (ctx) =>
      Effect.gen(function* () {
        const sent = yield* followUp(ctx, "followup-old-1", { old: true });
        assert.isTrue(sent.ok, JSON.stringify(sent));
        for (let attempt = 0; attempt < 160 && ctx.childTerminalRuns() < 2; attempt += 1)
          yield* ctx.settle(1);
        yield* ctx.settle(16);
        assert.equal(ctx.childTerminalRuns(), 2, "the child did run again");
        assert.lengthOf(yield* tasksOfChild(ctx), 1, "no task for the follow-up");
        assert.lengthOf(yield* ctx.deliveries(), 1, "and no second delivery");
      }),
    ),
  300_000,
);

it.live(
  "a busy parent gets the follow-up's delivery inside its live turn (the task's wake is `always`), once, with no extra parent run before or after it settles",
  () =>
    scenario("followup-busy", (ctx) =>
      Effect.gen(function* () {
        // Hold the parent: removing the go file makes its next "PARENT" request wait again.
        NodeFS.rmSync(ctx.go);
        yield* ctx.orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("hold:m05-followup-busy"),
          threadId: ctx.parent,
          messageId: MessageId.make("message:m05-followup-busy-hold"),
          text: "PARENT hold this turn",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        });
        yield* ctx.worker.drain();
        yield* waitFor("the held parent request", () =>
          ctx.parentRequests().find((r) => (r.text ?? "").includes("hold this turn")),
        );
        const runsBefore = (yield* ctx.orchestrator.getThreadProjection(ctx.parent)).runs.length;

        const sent = yield* followUp(ctx, "followup-busy-1");
        assert.isTrue(sent.ok, JSON.stringify(sent));
        for (let attempt = 0; attempt < 160 && ctx.childTerminalRuns() < 2; attempt += 1)
          yield* ctx.settle(1);
        assert.equal(ctx.childTerminalRuns(), 2, "the child completed the follow-up");
        yield* ctx.settle(16);
        // T3 owns the busy case: the follow-up's task is bound to the parent's live run and delivered into it, as for any `always` task; it opens no run of its own.
        const mid = yield* ctx.orchestrator.getThreadProjection(ctx.parent);
        assert.equal(
          mid.runs.at(-1)!.status,
          "running",
          "the parent is still inside its held turn",
        );
        const owed = mid.subagents.find((t) => t.id !== ctx.firstTaskId)!;
        assert.equal(owed.completionDelivery?.state, "delivered");
        assert.deepEqual(owed.runId, mid.runs.at(-1)!.id, "bound to the live run");
        assert.lengthOf(yield* ctx.deliveries(), 2);
        assert.equal(mid.runs.length, runsBefore);

        NodeFS.writeFileSync(ctx.go, "go");
        yield* ctx.settle(32);
        const after = yield* ctx.orchestrator.getThreadProjection(ctx.parent);
        assert.equal(after.runs.at(-1)!.status, "completed", "the parent settled");
        assert.lengthOf(yield* ctx.deliveries(), 2, "no duplicate after it settled");
        assert.equal(after.runs.length, runsBefore, "no run was opened for the delivery");
        assert.lengthOf(yield* tasksOfChild(ctx), 2);
      }),
    ),
  300_000,
);
