/* oxlint-disable t3code/no-low-value-comments -- The header states the boundary this evidence covers and what it does not show. */
// AETHERIA M07 step 19 (DV11; IP-67) — the typed-`/goal` hook through the REAL layer graph, the shape the server has: the real `Orchestrator.layer` (inside the replay harness's real service graph) is built
// FIRST and is never handed the Backend's hook; the Backend layer is built after it and fills the slot. A first version read the hook per dispatch from the caller's fiber context and a native run saw a typed
// `/goal set x` reach the model; this file fails on that design because nothing here provides the hook to the dispatching fiber. With AETHERIA_STATE_ROOT set (as the server's has it), `Orchestrator.layer`
// provides `layerWhenAetheria` to itself, the test (standing for the Backend) gets the same constant and installs a route after the Orchestrator exists, and a Pi `/goal set x` through
// `orchestrator.dispatch` is routed by that route: the dispatch fails with its notice and no turn starts. Not shown: the real Backend's route answering for a thread M04's index binds (it needs a bound
// Pi session; `m07GoalCommandBackend.aetheria.test.ts` shows the Backend fills the slot, the native run shows the answer), and the websocket fiber.
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import { afterAll, beforeAll, vi } from "vite-plus/test";

import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import { GoalCommandSlot, layerWhenAetheria } from "./goalCommandHook.ts";

const NOTICE =
  "Goal request sent for your approval. Nothing changes until you approve it on the card.";

beforeAll(() => {
  vi.stubEnv("AETHERIA_STATE_ROOT", "/aetheria-test-state-root-unused");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

/** One Pi thread on a scripted adapter; `started` holds the text of every turn the provider was asked to start. */
const harness = Effect.fn("goalGraphHarness")(function* () {
  const driver = ProviderDriverKind.make("pi");
  const instanceId = ProviderInstanceId.make("pi");
  const selection = { instanceId, model: "test-model" };
  const name = "m07-goal-graph-pi";
  const cwd = yield* checkpointWorkspace(name);
  const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
  const started: string[] = [];
  const capabilities = CodexProviderCapabilitiesV2;
  const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(capabilities),
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
            model: selection.model,
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
              started.push(turn.message.text);
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
  const harnessLayer = ProviderReplayHarness.layerWithRegistry(
    { name },
    ProviderAdapterRegistry.layerSingle(adapter),
    { runEffectWorker: false },
  );
  return { harnessLayer, started, cwd, selection, name };
});

it.effect(
  "a Pi /goal through the real Orchestrator layer reaches a route installed after it was built",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        // The server's shape: the Orchestrator layer and the Backend's constant are built in ONE build (one memo map); the Backend's side fills the slot afterwards.
        const graph = Layer.mergeAll(h.harnessLayer, layerWhenAetheria);
        yield* Effect.gen(function* () {
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
          const slot = yield* GoalCommandSlot;
          const threadId = ThreadId.make(`thread:${h.name}`);
          yield* orchestrator.dispatch({
            type: "thread.create",
            commandId: CommandId.make("create"),
            threadId,
            projectId: ProjectId.make(`project:${h.name}`),
            title: "goal graph",
            modelSelection: h.selection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: h.cwd,
            createdBy: "user",
            creationSource: "web",
          });
          const send = (id: string, text: string) =>
            orchestrator
              .dispatch({
                type: "message.dispatch",
                commandId: CommandId.make(id),
                threadId,
                messageId: MessageId.make(`message:${id}`),
                text,
                attachments: [],
                modelSelection: h.selection,
                // the shape the native driver sends (tests/orchestration/slice/world.mjs sendUserMessage)
                dispatchMode: { type: "queue_after_active" },
                createdBy: "user",
                creationSource: "web",
              })
              .pipe(Effect.result);

          // Nothing installed yet: the slot's hook does not handle, and T3 treats the text as before.
          assert.isFalse(slot.installed());
          const before = yield* send("before", "/goal set x");
          assert.equal(before._tag, "Success");
          yield* worker.drain();
          assert.deepEqual(h.started, ["/goal set x"]);

          // The Backend starts later and fills the slot.
          const asked: unknown[] = [];
          const uninstall = slot.install((input) =>
            Effect.sync(() => {
              asked.push(input);
              return { handled: true, notice: NOTICE };
            }),
          );
          assert.isTrue(slot.installed());
          const routed = yield* send("routed", "/goal set x");
          assert.equal(routed._tag, "Failure");
          const failure = (routed as { failure: { _tag: string; cause: unknown } }).failure;
          assert.equal(failure._tag, "OrchestratorDispatchError");
          assert.equal(String(failure.cause), NOTICE);
          yield* worker.drain();
          assert.deepEqual(h.started, ["/goal set x"], "no second turn started");
          assert.deepEqual(asked, [
            {
              threadId,
              driver: "pi",
              message: { text: "/goal set x", attachments: [] },
            },
          ]);

          // A plain message is never offered to the route.
          const plain = yield* send("plain", "hello");
          assert.equal(plain._tag, "Success");
          assert.equal(asked.length, 1);

          // The Backend's layer ending empties the slot again: T3's handling returns.
          uninstall();
          assert.isFalse(slot.installed());
          const after = yield* send("after", "/goal set y");
          assert.equal(after._tag, "Success");
        }).pipe(Effect.provide(graph));
      }),
    ),
);
