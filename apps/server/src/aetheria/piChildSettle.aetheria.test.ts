// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDateInEffect:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M05 Plan step 2 (D7, C4's last clause) — child settle probe with the real Pi adapter. A mechanism probe, not an M05 feature.
//
// Question. For a delegated child whose first provider request fails with a retryable error and succeeds on Pi's automatic retry, does T3 emit a
// terminal `run.updated` for the child only after Pi's `agent_settled` (never at the first `agent_end`), and does the parent's task settle once?
//
// Boundary. The real Orchestrator, ThreadManagementService, ProviderSessionManager and effect worker (T3's ProviderReplayHarness layout, as
// heldChild.aetheria.test.ts) with the REAL Pi adapter (makePiAdapterV2) driving the installed Pi 1.5.0 for both the parent and the child. The
// provider is Pi's faux provider as a test extension (tests/orchestration/probes/faux-retry-trace.mjs): the parent's request never answers (its run
// stays active), the child's first request is `overloaded_error: 529` and the retry succeeds. The extension traces each Pi event and request with
// Date.now() to FAUX_TRACE; the test reads T3's domain events with Date.now() on the same clock.
//
// Shows: Pi emits `agent_end` twice (once after the failure, once after the retry) and `agent_settled` once, after both; the child's runs have
// exactly one terminal `run.updated` (`completed`), observed after `agent_settled` and none between the first `agent_end` and `agent_settled`; the
// provider served exactly two requests for the child; the parent's subagent task reaches a terminal status once.
// Does NOT show: T3's DelegatedCompletionDelivery to the parent (its service is not in this harness; T3's own DelegatedCompletionDelivery.test.ts
// covers once-only delivery with doubles), the Aetheria extension in the child, or timing across a Backend restart.
/* oxlint-disable t3code/no-wall-clock-in-tests, t3code/no-polling-loop-in-tests, t3code/no-real-time-wait-in-tests, t3code/no-test-timeout-or-unreasoned-skip -- Orders a real Pi subprocess's timestamps against T3's events; no background worker, so drain() repeats. */
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
  const layerIntake = ServerConfig.layerTest(process.cwd(), { prefix: "t3-pi-settle-probe-" }).pipe(
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
  readonly t: number;
  readonly type: string;
  readonly threadId?: string | undefined;
  readonly status?: string | undefined;
}

it.live(
  "a child's retry after agent_end produces no terminal run.updated until agent_settled; the settle happens once",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "m05-settle-" });
      const trace = NodePath.join(root, "trace.jsonl");
      const world = makeWorld(root, [], { FAUX_TRACE: trace });
      const cwd = yield* checkpointWorkspace("m05-settle");
      const { adapter } = yield* makePi(world, [FAUX_RETRY]);
      const readTrace = (): Array<{ kind: string; t: number; text?: string }> =>
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
                t: Date.now(),
                type: event.type,
                threadId: (event as { threadId?: string }).threadId,
                status: payload?.status,
              });
            }),
          ),
          Effect.forkScoped,
        );

        // The parent: a real Pi thread whose single request never answers, so its run stays active while the child runs.
        const parent = ThreadId.make("thread:m05-settle-parent");
        yield* orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make("create:m05-settle-parent"),
          threadId: parent,
          projectId: ProjectId.make("project:m05-settle"),
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
          commandId: CommandId.make("first:m05-settle-parent"),
          threadId: parent,
          messageId: MessageId.make("message:m05-settle-parent"),
          text: "PARENT stay running",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        });
        yield* worker.drain();
        yield* waitFor("the parent's request to reach the provider", () =>
          readTrace().find((r) => r.kind === "request" && r.text?.includes("PARENT")),
        );
        const parentRun = (yield* orchestrator.getThreadProjection(parent)).runs[0]!;

        // The child: delegated through T3's own command, starting immediately (no hold).
        yield* threads.dispatch({
          type: "delegated_task.request",
          commandId: CommandId.make("m05-settle-spawn"),
          parentThreadId: parent,
          parentRunId: parentRun.id,
          parentNodeId: parentRun.rootNodeId as NodeId,
          task: "retry-task: do the work",
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

        // The harness runs no background worker: after the provider settles the run is `waiting` (T3's post-turn checkpoint capture is an effect),
        // and drain() performs it, which ends the run `completed`. Drain until that terminal event, as a running server's worker would.
        yield* waitFor("agent_settled in the trace", () =>
          readTrace().find((r) => r.kind === "agent_settled" && r.t > 0),
        );
        for (let attempt = 0; attempt < 120; attempt += 1) {
          if (
            seen.some(
              (e) =>
                e.type === "run.updated" && e.threadId === child && TERMINAL.has(e.status ?? ""),
            )
          )
            break;
          yield* Effect.promise(() => new Promise((r) => setTimeout(r, 250)));
          yield* worker.drain();
        }
        yield* waitFor("the child's terminal run.updated", () =>
          seen.find(
            (e) => e.type === "run.updated" && e.threadId === child && TERMINAL.has(e.status ?? ""),
          ),
        );
        yield* waitFor("agent_settled in the trace", () =>
          readTrace().find((r) => r.kind === "agent_settled" && r.t > 0),
        );
        // Let a late duplicate show up if there is one.
        yield* Effect.promise(() => new Promise((r) => setTimeout(r, 1500)));

        const t = readTrace();
        const childRequests = t.filter((r) => r.kind === "request" && !r.text?.includes("PARENT"));
        const ends = t.filter((r) => r.kind === "agent_end");
        const settled = t.filter((r) => r.kind === "agent_settled");
        assert.lengthOf(childRequests, 2, `trace: ${JSON.stringify(t)}`);
        assert.lengthOf(ends, 2, `trace: ${JSON.stringify(t)}`);
        assert.lengthOf(settled, 1, `trace: ${JSON.stringify(t)}`);
        // agent_settled follows both agent_ends.
        assert.isAtLeast(settled[0]!.t, ends[1]!.t);
        const childTerminals = seen.filter(
          (e) => e.type === "run.updated" && e.threadId === child && TERMINAL.has(e.status ?? ""),
        );
        assert.lengthOf(childTerminals, 1, JSON.stringify(childTerminals));
        assert.equal(childTerminals[0]?.status, "completed");
        // No terminal child run event between the first agent_end and agent_settled, and the one terminal comes at or after agent_settled.
        assert.isAtLeast(childTerminals[0]!.t, settled[0]!.t);
        assert.isBelow(ends[0]!.t, settled[0]!.t);
        assert.isUndefined(
          seen.find(
            (e) =>
              e.type === "run.updated" &&
              e.threadId === child &&
              TERMINAL.has(e.status ?? "") &&
              e.t >= ends[0]!.t &&
              e.t < settled[0]!.t,
          ),
        );
        // Neither the `waiting` (settled-awaiting-capture) nor any other post-turn status shows before agent_settled: until then the child run is
        // `running` (provider-turn and run events during the retry stay running).
        const postSettleStatuses = new Set(["waiting", ...TERMINAL]);
        const earlySettle = seen.filter(
          (e) =>
            e.type === "run.updated" &&
            e.threadId === child &&
            postSettleStatuses.has(e.status ?? "") &&
            e.t < settled[0]!.t,
        );
        assert.deepEqual(earlySettle, []);
        const firstSettling = seen.find(
          (e) =>
            e.type === "run.updated" &&
            e.threadId === child &&
            postSettleStatuses.has(e.status ?? ""),
        );
        assert.isAtLeast(firstSettling!.t, settled[0]!.t);
        const providerTurnCompleted = seen.filter(
          (e) =>
            e.type === "provider-turn.updated" && e.threadId === child && e.status === "completed",
        );
        assert.lengthOf(providerTurnCompleted, 1);
        assert.isAtLeast(providerTurnCompleted[0]!.t, settled[0]!.t);
        // The parent's task settles once.
        const taskTerminals = seen.filter(
          (e) =>
            e.type === "subagent.updated" && e.threadId === parent && TERMINAL.has(e.status ?? ""),
        );
        assert.isAtMost(taskTerminals.length, 1, JSON.stringify(taskTerminals));
        // The parent's own run is still active: the child's completion did not end it.
        const parentAfter = (yield* orchestrator.getThreadProjection(parent)).runs[0]!;
        assert.isFalse(TERMINAL.has(parentAfter.status));
      }).pipe(Effect.provide(layerRuntime("m05-settle", adapter)));
    }).pipe(Effect.scoped, Effect.provide(layerPlatform)),
  240_000,
);
