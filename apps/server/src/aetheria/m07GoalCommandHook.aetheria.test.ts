// AETHERIA M07 step 19 (DV11; IP-67): the real Orchestrator over the replay harness with a scripted adapter and hook. A handling hook makes a Pi `/goal` fail with the notice and start no turn;
// no hook, an unhandling hook, other drivers and non-goal text leave T3's handling unchanged. Not shown: the Backend side, a real Pi session, the toast.
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
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";

import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import {
  layerFrom,
  type GoalCommandHookInput,
  type GoalCommandHookResult,
} from "./goalCommandHook.ts";

const NOTICE = "Goal proposed on the root: the person must confirm it in the control page.";

/** One thread on a scripted adapter of the given driver; `started` holds the text of every turn the provider was asked to start. */
const harness = Effect.fn("goalHookHarness")(function* (driverName: string) {
  const driver = ProviderDriverKind.make(driverName);
  const instanceId = ProviderInstanceId.make(driverName);
  const selection = { instanceId, model: "test-model" };
  const name = `m07-goal-hook-${driverName}`;
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
            Effect.gen(function* () {
              started.push(turn.message.text);
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
                  startedAt: now,
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
  const layer = ProviderReplayHarness.layerWithRegistry(
    { name },
    ProviderAdapterRegistry.layerSingle(adapter),
    { runEffectWorker: false },
  );
  const threadId = ThreadId.make(`thread:${name}`);
  const create = Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create"),
      threadId,
      projectId: ProjectId.make(`project:${name}`),
      title: "goal hook",
      modelSelection: selection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: cwd,
      createdBy: "user",
      creationSource: "web",
    });
  });
  const send = (id: string, text: string) =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      return yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(id),
        threadId,
        messageId: MessageId.make(`message:${id}`),
        text,
        attachments: [],
        modelSelection: selection,
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      });
    });
  const projection = Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return yield* orchestrator.getThreadProjection(threadId);
  });
  return { layer, started, create, send, projection };
});

/** A scripted hook that records every ask. */
const hook = (answer: (input: GoalCommandHookInput) => GoalCommandHookResult) => {
  const asked: GoalCommandHookInput[] = [];
  return {
    asked,
    layer: layerFrom((input) =>
      Effect.sync(() => {
        asked.push(input);
        return answer(input);
      }),
    ),
  };
};
const handles = () => hook(() => ({ handled: true, notice: NOTICE }));

/** Sends `text` on a thread of `driver` with `hookLayer` (or none) provided to the caller, then lets the provider run. */
const sendWith = (driver: string, text: string, hookLayer: Layer.Layer<never> | undefined) =>
  Effect.scoped(
    Effect.gen(function* () {
      const h = yield* harness(driver);
      return yield* Effect.gen(function* () {
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        yield* h.create;
        const send = h.send("goal", text);
        const outcome = yield* (
          hookLayer === undefined ? send : send.pipe(Effect.provide(hookLayer))
        ).pipe(Effect.result);
        yield* worker.drain();
        return { outcome, started: h.started, projection: yield* h.projection };
      }).pipe(Effect.provide(h.layer));
    }),
  );

const failureText = (outcome: { readonly _tag: string; readonly failure?: unknown }): string => {
  assert.equal(outcome._tag, "Failure");
  const failure = outcome.failure as { _tag: string; cause: unknown };
  assert.equal(failure._tag, "OrchestratorDispatchError");
  return String(failure.cause);
};

it.effect("a handled /goal on a Pi thread starts no turn and fails with the notice", () =>
  Effect.gen(function* () {
    const h = handles();
    const { outcome, started, projection } = yield* sendWith("pi", "/goal set x", h.layer);
    assert.equal(failureText(outcome as never), NOTICE);
    assert.deepEqual(started, []);
    assert.equal(projection.runs.length, 0);
    assert.equal(projection.messages.length, 0);
    assert.deepEqual(h.asked, [
      {
        threadId: ThreadId.make("thread:m07-goal-hook-pi"),
        driver: "pi",
        message: { text: "/goal set x", attachments: [] },
      },
    ]);
  }),
);

it.effect(
  "every goal command word on a Pi thread reaches the hook, and a plain message does not",
  () =>
    Effect.gen(function* () {
      for (const text of ["/goal", "/goal pause", "/goal resume", "/goal clear", "/goal ship it"]) {
        const h = handles();
        const { outcome, started } = yield* sendWith("pi", text, h.layer);
        assert.equal(failureText(outcome as never), NOTICE);
        assert.deepEqual(started, []);
        assert.equal(h.asked.length, 1);
      }
      const quiet = handles();
      const plain = yield* sendWith("pi", "hello, no goal here", quiet.layer);
      assert.equal(plain.outcome._tag, "Success");
      assert.deepEqual(plain.started, ["hello, no goal here"]);
      assert.deepEqual(quiet.asked, []);
    }),
);

it.effect("a hook that does not handle leaves a Pi /goal as ordinary text, as T3 treats it", () =>
  Effect.gen(function* () {
    const h = hook(() => ({ handled: false }));
    const { outcome, started } = yield* sendWith("pi", "/goal set x", h.layer);
    assert.equal(outcome._tag, "Success");
    assert.deepEqual(started, ["/goal set x"]);
    assert.equal(h.asked.length, 1);
  }),
);

it.effect("an absent hook leaves a Pi /goal untouched", () =>
  Effect.gen(function* () {
    const { outcome, started } = yield* sendWith("pi", "/goal set x", undefined);
    assert.equal(outcome._tag, "Success");
    assert.deepEqual(started, ["/goal set x"]);
  }),
);

it.effect("Codex and Claude threads are never offered to the hook and keep T3's handling", () =>
  Effect.gen(function* () {
    for (const driver of ["codex", "claudeAgent"]) {
      const h = handles();
      const { outcome, started } = yield* sendWith(driver, "/goal set x", h.layer);
      assert.equal(outcome._tag, "Success", driver);
      assert.deepEqual(started, ["/goal set x"], driver);
      assert.deepEqual(h.asked, [], driver);
    }
  }),
);

it.effect(
  "a driver that is neither Pi nor native keeps ordinary text and is not offered either",
  () =>
    Effect.gen(function* () {
      const h = handles();
      const { outcome, started } = yield* sendWith("opencode", "/goal set x", h.layer);
      assert.equal(outcome._tag, "Success");
      assert.deepEqual(started, ["/goal set x"]);
      assert.deepEqual(h.asked, []);
    }),
);

it.effect("is marked in the Orchestrator at the three goal sites (IP-67)", () =>
  Effect.gen(function* () {
    const fs = yield* Effect.promise(() => import("node:fs"));
    const url = yield* Effect.promise(() => import("node:url"));
    const text = fs.readFileSync(
      url.fileURLToPath(new URL("../orchestration-v2/Orchestrator.ts", import.meta.url)),
      "utf8",
    );
    const marker = ["AETHERIA-IP", "IP-67"].join(":");
    assert.isAtLeast(text.split(marker).length - 1, 4);
    assert.match(
      text,
      /yield\* routeAetheriaGoalCommand\(\s*command,\s*command\.threadId,\s*command,/,
    );
    assert.match(
      text,
      /yield\* routeAetheriaGoalCommand\(\s*command,\s*command\.threadId,\s*queuedMessage,/,
    );
    // the Orchestrator reaches the hook, never the Backend
    assert.notMatch(text, /aetheria\/aetheriaBackend/);
  }),
);
