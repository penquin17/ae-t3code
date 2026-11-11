// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDateInEffect:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M05 Plan step 2/3 (D7, C2 "a child's completion appears once at the parent and M05 inserts no second copy") — parent delivery probe.
// A mechanism probe, not an M05 feature.
//
// Question. After a real Pi child settles, does T3 itself deliver the completion to the parent exactly once — as one parent message carrying
// `delegatedCompletion` and one parent provider request — with nothing for M05 to insert?
//
// Boundary. The real Orchestrator, ThreadManagementService, ProviderSessionManager and effect worker (ProviderReplayHarness layout, as
// piChildSettle.aetheria.test.ts) with the REAL Pi adapter for both threads on installed Pi 1.5.0 and Pi's faux provider as a test extension
// (tests/orchestration/probes/faux-retry-trace.mjs). The parent answers only after the test creates its FAUX_PARENT_GO file, so the child finishes
// while the parent's run is still active (a `settled_only` task: T3 holds the completion until the parent settles). The harness has no background
// worker; drain() is repeated, as a running server's worker would. T3 delivers the completion from its own Orchestrator and worker; the test
// dispatches nothing to the parent after the first message.
//
// Shows: exactly one parent message with `delegatedCompletion`, exactly one parent provider request carrying it (two parent requests in all: the
// original prompt and the delivery), exactly one terminal child run, a task that reaches a terminal status once, and no further delivery after
// extra drains. Does NOT show: delivery across a Backend restart, a `record-only` child, or the Aetheria extension in either thread.
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
    prefix: "t3-pi-delivery-probe-",
  }).pipe(Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))));
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
            // T3's own continuation worker is what turns the delegated-completion offer into the parent's delivery turn.
            runContinuationWorker: true,
          },
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

it.live(
  "T3 delivers a real child's completion to the parent exactly once; M05 inserts no second copy",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "m05-delivery-" });
      const trace = NodePath.join(root, "trace.jsonl");
      const go = NodePath.join(root, "parent-go");
      const world = makeWorld(root, [], { FAUX_TRACE: trace, FAUX_PARENT_GO: go });
      const cwd = yield* checkpointWorkspace("m05-delivery");
      const { adapter } = yield* makePi(world, [FAUX_RETRY]);
      const readTrace = (): Array<{ kind: string; t: number; text?: string; parent?: boolean }> =>
        NodeFS.existsSync(trace)
          ? NodeFS.readFileSync(trace, "utf8")
              .split("\n")
              .filter(Boolean)
              .map((l) => JSON.parse(l))
          : [];

      yield* Effect.gen(function* () {
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

        const parent = ThreadId.make("thread:m05-delivery-parent");
        yield* orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make("create:m05-delivery-parent"),
          threadId: parent,
          projectId: ProjectId.make("project:m05-delivery"),
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
          commandId: CommandId.make("first:m05-delivery-parent"),
          threadId: parent,
          messageId: MessageId.make("message:m05-delivery-parent"),
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
          commandId: CommandId.make("m05-delivery-spawn"),
          parentThreadId: parent,
          parentRunId: parentRun.id,
          parentNodeId: parentRun.rootNodeId as NodeId,
          task: "retry-task: do the work",
          // "always": a fire-and-forget task. "settled_only" relies on a blocking wait that ends with the spawning turn (Orchestrator.ts:12295).
          completionWake: "always",
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
        yield* worker.drain();
        const childTerminal = () =>
          seen.some(
            (e) => e.type === "run.updated" && e.threadId === child && TERMINAL.has(e.status ?? ""),
          );
        for (let attempt = 0; attempt < 120 && !childTerminal(); attempt += 1) {
          yield* sleep(250);
          yield* worker.drain();
        }
        assert.isTrue(childTerminal(), "the child never reached a terminal run.updated");
        // Let the parent finish. T3 delivers the completion, from its own worker and continuation service.
        NodeFS.writeFileSync(go, "go");
        const deliveries = () =>
          orchestrator
            .getThreadProjection(parent)
            .pipe(Effect.map((p) => p.messages.filter((m) => m.delegatedCompletion !== undefined)));
        for (let attempt = 0; attempt < 160; attempt += 1) {
          yield* sleep(250);
          yield* worker.drain();
          if (
            (yield* deliveries()).length >= 1 &&
            readTrace().filter((r) => r.kind === "request" && r.parent === true).length >= 2
          )
            break;
        }
        // Extra drains and time: a duplicate delivery would show here.
        for (let attempt = 0; attempt < 12; attempt += 1) {
          yield* sleep(250);
          yield* worker.drain();
        }

        const delivered = yield* deliveries();
        const parentRequests = readTrace().filter((r) => r.kind === "request" && r.parent === true);
        const diag = yield* orchestrator.getThreadProjection(parent).pipe(
          Effect.map((p) =>
            JSON.stringify({
              runs: p.runs.map((r) => ({ id: r.id, status: r.status, dc: r.delegatedCompletion })),
              tasks: p.subagents.map((s) => ({
                id: s.id,
                status: s.status,
                wake: s.completionWake,
                delivery: (s as { delivery?: unknown }).delivery,
              })),
              messages: p.messages.map((m) => ({
                id: m.id,
                role: m.role,
                dc: m.delegatedCompletion,
                text: m.text.slice(0, 60),
              })),
              trace: readTrace().map(
                (r) => `${r.kind}${r.parent === undefined ? "" : r.parent ? ":P" : ":C"}`,
              ),
            }),
          ),
        );
        assert.lengthOf(delivered, 1, `delivery messages: ${diag}`);
        assert.deepEqual(delivered[0]!.delegatedCompletion!.taskIds, [task.id]);
        assert.lengthOf(parentRequests, 2, `parent requests: ${JSON.stringify(parentRequests)}`);
        assert.include(parentRequests[0]!.text ?? "", "PARENT");
        assert.notInclude(parentRequests[1]!.text ?? "", "PARENT");
        assert.isAbove((parentRequests[1]!.text ?? "").length, 0);
        assert.lengthOf(
          seen.filter(
            (e) => e.type === "run.updated" && e.threadId === child && TERMINAL.has(e.status ?? ""),
          ),
          1,
        );
        // `subagent.updated` fires for the completion and again for T3's own delivery-state bookkeeping, so it is not a count of deliveries; the task's
        // recorded delivery state is: T3 marks it delivered, and the one delivery message above is the only copy.
        const finalTask = (yield* orchestrator.getThreadProjection(parent)).subagents.find(
          (s) => s.id === task.id,
        )!;
        assert.include(
          ["delivered", "acknowledged"],
          finalTask.completionDelivery?.state,
          JSON.stringify(finalTask.completionDelivery),
        );
        assert.equal(finalTask.status, "completed");
        // At most two parent runs (the original prompt, and one T3 may open for the delivery); nothing M05 would have inserted.
        const parentRuns = (yield* orchestrator.getThreadProjection(parent)).runs;
        assert.isAtMost(parentRuns.length, 2, JSON.stringify(parentRuns.map((r) => r.status)));
        // T3 authors the delivery message itself (createdBy "agent"); no caller of this test, and so no M05 insert, produced it.
        assert.equal(delivered[0]!.createdBy, "agent");
      }).pipe(Effect.provide(layerRuntime("m05-delivery", adapter)));
    }).pipe(Effect.scoped, Effect.provide(layerPlatform)),
  300_000,
);
