// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M05 step 6 (C2): how a child launches, read from T3's record of the caller's thread. The child runs on the caller's model (its first route) in the caller's
// modes; the Pi `thinking` option is the effort. A thread T3 cannot show is `undefined`, which the SpawnAuthorizer turns into an unavailable refusal.
import { ThreadId } from "@t3tools/contracts";
import type { SpawnLaunchFacts } from "@t3tools/aetheria-server";
import * as Effect from "effect/Effect";

import type * as Orchestrator from "../orchestration-v2/Orchestrator.ts";

export const makeLaunchFacts = Effect.fn("makeLaunchFacts")(function* (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  threadOfSession: (sessionId: string) => string | undefined,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  return async (callerSessionId: string): Promise<SpawnLaunchFacts | undefined> => {
    const threadId = threadOfSession(callerSessionId);
    if (threadId === undefined) return undefined;
    try {
      const { thread } = await runPromise(
        orchestrator.getThreadProjection(ThreadId.make(threadId)),
      );
      const selection = thread.modelSelection as {
        readonly instanceId: string;
        readonly model: string;
        readonly options?: ReadonlyArray<{ readonly id: string; readonly value: unknown }>;
      };
      const thinking = selection.options?.find((option) => option.id === "thinking")?.value;
      return {
        routes: [
          {
            provider: String(selection.instanceId),
            model: selection.model,
            ...(typeof thinking === "string" ? { effort: thinking } : {}),
          },
        ],
        runtimeMode: String(thread.runtimeMode),
        interactionMode: String(thread.interactionMode),
      };
    } catch {
      return undefined;
    }
  };
});
