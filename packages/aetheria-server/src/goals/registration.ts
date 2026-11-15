// @effect-diagnostics globalTimers:off
// AETHERIA M07 Plan steps 14 and 17 — the Backend `goals-backend` registration: one goal service over the injected factory. It registers exactly the three XC-6 goal operations of DV10 (`goals.get`, `goals.create`,
// `goals.update`, operations.ts) for the model's tools; T3's recovery guard and M10's client handlers (the `aetheria.goal.*` RPCs) reach the same service through `service()`. The module starts after the owner lock,
// M06 and M05 (its row requires them), reconciles every journal without sending anything, and drains before them: it stops the service (no settle starts a round, no card is honoured) and waits a bounded
// time for the work in flight. Its operations answer `unavailable` whenever no service runs (the adapter also gates them on the module's own state).
//
// Two states belong to this file and nowhere else: the RUNNING service (present only between start and drain) and the READ side (`roundInFlight`, `anyRoundInFlight`), which stays answerable after
// drain because it reads the journal and T3's shutdown preparation still asks. `unconfigured` (no factory) answers `none`: no round can exist that this Backend began. A module that never
// started, or whose start failed, answers `unknown`.
import type { BackendRegistration } from "../adapter.ts";
import type { GoalService } from "./goalsEntry.ts";
import type { GoalRoundState, GoalsRuntime } from "./factory.ts";
import { GOALS_BACKEND_ENTRY } from "./goalsRow.ts";
import { createGoalOperations } from "./operations.ts";

/** How long a drain waits for proposals and rounds already in flight before it reports them as possibly still live. */
const DRAIN_WAIT_MS = 5000;

export interface GoalsRegistrationOptions {
  /** Builds the runtime. Absent: the module runs unconfigured and no goal exists. */
  readonly create?: (() => GoalsRuntime) | undefined;
  /** Test seam: the bound of the drain wait. */
  readonly drainWaitMs?: number | undefined;
}

export type GoalsBackendRegistration = BackendRegistration & {
  /** The running goal service, or undefined before start, after drain, and when unconfigured (a caller then answers unavailable, never "no goal"). */
  readonly service: () => GoalService | undefined;
  /** T3's recovery guard, one session: a goal round in flight, none, or unknown. */
  readonly roundInFlight: (sessionId: string) => GoalRoundState;
  /** T3's recovery guard, when no single session can be named: is any root's round in flight? */
  readonly anyRoundInFlight: () => GoalRoundState;
};

export function createGoalsBackendRegistration(
  options: GoalsRegistrationOptions = {},
): GoalsBackendRegistration {
  let running: GoalsRuntime | undefined;
  /** The runtime that started: kept after drain for the read side only. */
  let readable: GoalsRuntime | undefined;
  /** The runtime that was built, whether or not its start completed: drain must reach it however far start got. */
  let built: GoalsRuntime | undefined;

  const read = (ask: (runtime: GoalsRuntime) => GoalRoundState): GoalRoundState => {
    if (options.create === undefined) return "none";
    if (readable === undefined) return "unknown";
    try {
      return ask(readable);
    } catch {
      return "unknown";
    }
  };

  return {
    entry: GOALS_BACKEND_ENTRY,
    operations: createGoalOperations(() => running?.service),
    activation: {
      start: async () => {
        if (options.create === undefined) return;
        const runtime = options.create();
        built = runtime;
        const report = await runtime.service.start();
        if (report.status !== "ok")
          throw new Error(
            `the goals service did not start: ${report.detail ?? "its journals cannot be listed"}`,
          );
        running = runtime;
        readable = runtime;
      },
      drain: async () => {
        const runtime = built;
        running = undefined;
        built = undefined;
        if (runtime === undefined)
          return { released: [], stopped: [], transferred: [], stillLive: [] };
        runtime.service.stop();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const bound = new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), options.drainWaitMs ?? DRAIN_WAIT_MS);
          (timer as { unref?: () => void }).unref?.();
        });
        try {
          const ended = await Promise.race([
            runtime.service.idle().then(() => true as const),
            bound,
          ]);
          return {
            released: [],
            stopped: ["backend-goals.service"],
            transferred: [],
            stillLive: ended ? [] : ["backend-goals.tasks"],
          };
        } finally {
          clearTimeout(timer);
        }
      },
    },
    service: () => running?.service,
    roundInFlight: (sessionId) => read((runtime) => runtime.roundInFlight(sessionId)),
    anyRoundInFlight: () => read((runtime) => runtime.anyRoundInFlight()),
  };
}
