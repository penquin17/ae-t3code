// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M05 Plan step 9 (C10, D17) — the caller context of a spawn: the thread and working folder M04's index bound to the CARRIER-verified session, and
// that thread's one ACTIVE run and its root node from T3's projections. A model argument can name none of these. Anything unknown, missing or ambiguous is
// `ok: false`: the children service is never called with a partial or guessed caller, and a spawn is never attached to a run that is not the live one.
import type { CallerContextPort, CallerContextResult } from "@t3tools/aetheria-server";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as Orchestrator from "../orchestration-v2/Orchestrator.ts";

/** The run states in which a tool call can be made by the model: T3's active runs without the not-yet-started `preparing`. */
const CALLING_STATES: ReadonlySet<string> = new Set(["starting", "running", "waiting"]);

export interface ActiveRunFact {
  readonly id: string;
  readonly status: string;
  readonly rootNodeId: string | null;
}

export interface CallerContextSources {
  /** M04's thread index: the thread and working folder a Pi session is bound to; undefined when unbound or ambiguous. */
  readonly bindingOfSession: (
    sessionId: string,
  ) => { readonly threadId: string; readonly workingFolder: string } | undefined;
  /** T3's runs for a thread. A rejected promise is an unreadable projection. */
  readonly runsOf: (threadId: string) => Promise<readonly ActiveRunFact[]>;
}

const fail = (detail: string): CallerContextResult => ({ ok: false, detail });

export function createCallerContext(sources: CallerContextSources): CallerContextPort {
  return async (sessionId) => {
    if (typeof sessionId !== "string" || sessionId === "") return fail("no session");
    const binding = sources.bindingOfSession(sessionId);
    if (binding === undefined) return fail("the session is not bound to exactly one thread");
    if (!binding.workingFolder.startsWith("/"))
      return fail("the bound working folder is not absolute");
    let runs: readonly ActiveRunFact[];
    try {
      runs = await sources.runsOf(binding.threadId);
    } catch {
      return fail("the caller thread's runs could not be read");
    }
    const live = runs.filter((run) => CALLING_STATES.has(run.status));
    if (live.length === 0) return fail("the caller thread has no active run");
    if (live.length > 1) return fail("the caller thread has more than one active run");
    const [run] = live;
    if (run === undefined || run.rootNodeId === null)
      return fail("the caller thread's active run has no root node");
    return {
      ok: true,
      threadId: binding.threadId,
      runId: run.id,
      nodeId: run.rootNodeId,
      workingFolder: binding.workingFolder,
    };
  };
}

/** The production sources: T3's thread projection through the captured runtime, and the index binding supplied by the Backend wiring. */
export const makeCallerContext = Effect.fn("makeCallerContext")(function* (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  bindingOfSession: CallerContextSources["bindingOfSession"],
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  return createCallerContext({
    bindingOfSession,
    runsOf: (threadId) =>
      runPromise(orchestrator.getThreadProjection(ThreadId.make(threadId))).then(({ runs }) =>
        runs.map((run) => ({
          id: String(run.id),
          status: String(run.status),
          rootNodeId: run.rootNodeId === null ? null : String(run.rootNodeId),
        })),
      ),
  });
});
