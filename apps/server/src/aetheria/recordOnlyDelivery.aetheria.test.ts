// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDateInEffect:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M05 Plan step 12 (C1 `delivery: "record-only"`, D7) — can a child's completion be kept OUT of the parent's chat with T3's own commands, at both points T3 delivers it?
//
// Question. T3 offers a delegated task's completion to the parent at two points (Orchestrator.ts `planDelegatedCompletionDelivery`, called when the child completes, and the
// parent-settle delivery that selects every `pending` terminal task). Both skip a task whose `completionDelivery.state` is `disposed`; `delegated_task.completion-delivery.dispose`
// is a public command that sets it on any app-owned task, running or not. If the Backend adapter dispatches it right after `delegated_task.request`, does a child that completes
// afterwards reach the parent's chat in either case: (a) the parent's run is still live when the child settles, (b) the parent has already settled when the child completes?
//
// Boundary. The real ThreadManagementService, Orchestrator, EventSink, ProjectionStore, ProviderSessionManager and T3's own continuation worker on one in-memory SQLite database
// (as piChildDelivery.aetheria.test.ts) with the REAL Pi adapter for both threads on installed Pi 1.5.0 and Pi's faux provider as a test extension. No model, no credential. The
// child is made by T3's own `delegated_task.request` (`completionWake: "settled_only"`, the wake T3 would hold until the parent settles), then, in the record-only variants, disposed
// with T3's own `delegated_task.completion-delivery.dispose`. Nothing else is dispatched to the parent.
//
// Shows: a record-only child's completion never becomes a parent message with `delegatedCompletion` and never causes a second parent provider request, with the parent live
// (a) and already settled (b), while the control (same flow without the dispose, parent settled first) DOES deliver, so the test can fail. Does NOT show: the Aetheria Backend adapter
// itself (threadPort.aetheria tests drive it), a Backend restart, or T3's behaviour for a task disposed after its completion was already offered.
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
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as DocumentText from "../provider/DocumentText.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
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
    prefix: "t3-record-only-probe-",
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

/** One run of the flow; `dispose` makes the child record-only, `parentFirst` lets the parent settle before the child completes. */
const flow = (
  name: string,
  options: { readonly dispose: boolean; readonly parentFirst: boolean },
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: `m05-${name}-` });
    const trace = NodePath.join(root, "trace.jsonl");
    const go = NodePath.join(root, "parent-go");
    const world = makeWorld(root, [], { FAUX_TRACE: trace, FAUX_PARENT_GO: go });
    const cwd = yield* checkpointWorkspace(`m05-${name}`);
    const { adapter } = yield* makePi(world, [FAUX_RETRY]);
    const readTrace = (): Array<{ kind: string; parent?: boolean }> =>
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
      const sleep = (ms: number) => Effect.promise(() => new Promise((r) => setTimeout(r, ms)));
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
        completionWake: "settled_only",
        modelSelection: selection,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdBy: "agent",
        creationSource: "server",
      });
      const task = (yield* orchestrator.getThreadProjection(parent)).subagents.find((s) =>
        s.prompt.startsWith("retry-task"),
      )!;
      const child = task.childThreadId!;
      if (options.dispose)
        yield* threads.dispatch({
          type: "delegated_task.completion-delivery.dispose",
          commandId: CommandId.make(`m05-${name}-dispose`),
          parentThreadId: parent,
          taskId: task.id,
        });
      if (options.parentFirst) NodeFS.writeFileSync(go, "go");
      const childTerminal = () =>
        seen.some(
          (e) => e.type === "run.updated" && e.threadId === child && TERMINAL.has(e.status ?? ""),
        );
      yield* worker.drain();
      for (let attempt = 0; attempt < 160 && !childTerminal(); attempt += 1) {
        yield* sleep(250);
        yield* worker.drain();
      }
      assert.isTrue(childTerminal(), "the child never reached a terminal run.updated");
      const parentSettled = (yield* orchestrator.getThreadProjection(parent)).runs[0]!.status;
      if (!options.parentFirst) NodeFS.writeFileSync(go, "go");
      // Time and drains for a delivery to show: T3's worker and continuation service run on these.
      for (let attempt = 0; attempt < 32; attempt += 1) {
        yield* sleep(250);
        yield* worker.drain();
      }
      const projection = yield* orchestrator.getThreadProjection(parent);
      return {
        deliveries: projection.messages.filter((m) => m.delegatedCompletion !== undefined),
        parentRequests: readTrace().filter((r) => r.kind === "request" && r.parent === true),
        parentRuns: projection.runs.length,
        parentStatusWhenChildSettled: parentSettled,
        task: projection.subagents.find((s) => s.id === task.id)!,
      };
    }).pipe(Effect.provide(layerRuntime(name, adapter)));
  }).pipe(Effect.scoped, Effect.provide(layerPlatform));

const assertNothingReachedTheParent = (r: Effect.Success<ReturnType<typeof flow>>) => {
  assert.lengthOf(
    r.deliveries,
    0,
    `a delivery reached the parent: ${JSON.stringify(r.deliveries)}`,
  );
  assert.lengthOf(r.parentRequests, 1, "the parent made no second provider request");
  assert.equal(r.parentRuns, 1, "no parent run was opened for a delivery");
  assert.equal(r.task.status, "completed", "the child itself completed");
  assert.equal(r.task.completionDelivery?.state, "disposed");
};

it.live(
  "record-only (a): the parent is still live when the child completes, then settles: no delivery reaches it",
  () =>
    flow("record-live", { dispose: true, parentFirst: false }).pipe(
      Effect.map(assertNothingReachedTheParent),
    ),
  300_000,
);

it.live(
  "record-only (b): the parent has already settled when the child completes: no delivery reaches it",
  () =>
    flow("record-settled", { dispose: true, parentFirst: true }).pipe(
      Effect.map((r) => {
        assert.include(["completed", "failed", "interrupted"], r.parentStatusWhenChildSettled);
        assertNothingReachedTheParent(r);
      }),
    ),
  300_000,
);

it.live(
  "control: the same flow WITHOUT the dispose delivers the completion to the parent (the gap record-only closes; the test can fail)",
  () =>
    flow("control-settled", { dispose: false, parentFirst: true }).pipe(
      Effect.map((r) => {
        assert.lengthOf(r.deliveries, 1, JSON.stringify(r.task.completionDelivery));
        assert.isAtLeast(r.parentRequests.length, 2);
      }),
    ),
  300_000,
);
