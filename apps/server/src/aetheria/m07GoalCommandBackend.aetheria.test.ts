// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
// AETHERIA M07 Plan step 19 (IP-67; DV11) — the Backend LAYER provides the typed-`/goal` hook. Over the real layer (`makeLayer`) with T3's event stream, credential store and delivery services replaced by doubles.
// It shows: `makeLayer` provides `GoalCommandHook` beside `AetheriaBackend`; a layer built on top of it (the shape the server graph's `Layer.provideMerge` gives its consumers) captures a context in which
// `Effect.serviceOption(GoalCommandHook)` is present, so a fiber run in that context sees the hook the way the Orchestrator reads it at dispatch time; a thread the index holds no binding for, a Backend whose
// goal service is not configured, and a message that is not a goal command are all `handled: false`, so T3 handles them as before. It does NOT show T3's full server graph or the websocket dispatch fiber (the
// hook is read there in the RPC handlers' context, which the same merge feeds), a configured goal service answering through this hook (goalCommand.aetheria.test.ts and m07GoalsBackend show the route and
// the service), or a real Pi thread.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { McpProviderSessions } from "@t3tools/provider-core/server/McpProviderSessions";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as Live from "./aetheriaBackend.ts";
import { GoalCommandHook } from "./goalCommandHook.ts";
import * as GoalRoundGuard from "./goalRoundGuard.ts";

const makeRoot = () => {
  const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  return NodeFS.mkdtempSync(NodePath.join(base, "m07-goal-hook-layer-"));
};

const layerSupplies = Layer.mergeAll(
  Layer.mock(EventSink.EventSinkV2)({
    latestSequence: () => Effect.succeed(0),
    stream: () => Stream.never,
  }),
  Layer.mock(McpProviderSessions)({ read: () => Effect.sync(() => undefined) }),
  Layer.mock(ThreadManagementService.ThreadManagementService)({}),
  Layer.mock(CommandReceiptStore.CommandReceiptStoreV2)({}),
);
const guardLayer = Layer.succeed(
  GoalRoundGuard.GoalRoundGuard,
  GoalRoundGuard.makeGoalRoundGuard(),
);

/** A stand-in for a consumer deep in the graph (the RPC handlers): it records the context its fibers will run in. */
class Consumer extends Context.Service<Consumer, { readonly context: Context.Context<never> }>()(
  "t3/aetheria/m07GoalCommandBackend.aetheria.test/Consumer",
) {}
const consumerLayer = Layer.effect(
  Consumer,
  Effect.gen(function* () {
    return { context: yield* Effect.context<never>() };
  }),
);

describe("the Backend layer and the typed /goal hook", () => {
  it.live("provides the hook beside the Backend, visible in a consumer's captured context", () =>
    Effect.scoped(
      Layer.build(
        consumerLayer.pipe(
          Layer.provideMerge(
            Live.makeLayer(makeRoot()).pipe(
              Layer.provide(guardLayer),
              Layer.provide(layerSupplies),
            ),
          ),
        ),
      ).pipe(
        Effect.flatMap((context) =>
          Effect.gen(function* () {
            const consumer = Context.get(context, Consumer);
            const seen = yield* Effect.provideContext(
              Effect.serviceOption(GoalCommandHook),
              consumer.context,
            );
            expect(Option.isSome(seen)).toBe(true);
            const hook = Context.get(context, GoalCommandHook);
            // No binding for this thread: not ours, so T3 handles the message as it would have.
            const unbound = yield* hook.route({
              threadId: "thread-without-binding",
              driver: "pi",
              message: { text: "/goal ship it" },
            });
            expect(unbound).toEqual({ handled: false });
            const plain = yield* hook.route({
              threadId: "thread-without-binding",
              driver: "pi",
              message: { text: "hello" },
            });
            expect(plain).toEqual({ handled: false });
          }),
        ),
      ),
    ),
  );
});
