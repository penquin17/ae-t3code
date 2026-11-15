// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// AETHERIA M07 Plan step 14 — the join from the Backend's seams to the archive's goal service. It is the `create` the goals registration calls inside the module's start (after the owner lock, after
// M06 and M05 have started): it checks the parameters, opens the goal store under the state root, and builds the one goal service over the real ports (ports.ts). It adds no rule of its own;
// the only thing it decides is how T3's recovery guard reads the goal journal (`roundInFlight`, `anyRoundInFlight`).
import * as NodeCrypto from "node:crypto";

import {
  GOAL_PARAMETERS,
  createGoalService,
  openGoalStore,
  validateGoalParameters,
  type AdmissionPort,
  type GoalParameterValues,
  type GoalService,
  type InteractionPort,
  type NoticePort,
  type RootResolver,
  type ThreadReceiptPort,
} from "./goalsEntry.ts";

/** The answer T3's recovery guard needs: a goal round in flight, none, or `unknown` (read as in flight). */
export type GoalRoundState = "none" | "in-flight" | "unknown";

export interface GoalsRuntime {
  readonly service: GoalService;
  /** One session's journal: a reserved or running round, or one a restart cut and no settle has cleared, is in flight. Read-only; works after the service stopped. */
  roundInFlight(sessionId: string): GoalRoundState;
  /** Every root's journal: `none` only when each is readable and has no round in flight. A journal list or a journal that cannot be read is `unknown`. */
  anyRoundInFlight(): GoalRoundState;
}

export interface GoalsFactoryDeps {
  readonly stateRoot: string;
  readonly now: () => number;
  readonly resolver: RootResolver;
  readonly interaction: InteractionPort;
  readonly admission: AdmissionPort;
  readonly receipts: ThreadReceiptPort;
  readonly notices: NoticePort;
  /** Throws unless the module is running under the Backend's owner lock; the store asks before every write, so a write after drain or without the lock fails closed. */
  readonly assertHeld: () => void;
  /** Test seam: another id source. Production: random UUIDs. */
  readonly newId?: () => string;
  /** Test seam: other parameter values (validated like the defaults). Production: the labelled unaccepted test values. */
  readonly parameters?: unknown;
}
export type GoalsFactory = (deps: GoalsFactoryDeps) => GoalsRuntime;

/** The module name M05 sees as the trusted authority of this module's direct calls. */
export const GOALS_MODULE_NAME = "goals-backend";

const defaultParameters = (): GoalParameterValues => ({
  defaultMaxRounds: GOAL_PARAMETERS.defaultMaxRounds.value,
  blockedAfterConsecutiveRounds: GOAL_PARAMETERS.blockedAfterConsecutiveRounds.value,
});

export const createGoalsRuntime: GoalsFactory = (deps) => {
  const parameters = deps.parameters ?? defaultParameters();
  const problems = validateGoalParameters(parameters);
  if (problems.length > 0)
    throw new Error(`the goal parameters are not startable: ${problems.join("; ")}`);
  const store = openGoalStore({
    stateRoot: deps.stateRoot,
    clock: { now: () => new Date(deps.now()).toISOString() },
    owner: { assertHeld: deps.assertHeld },
  });
  const service = createGoalService({
    store,
    resolver: deps.resolver,
    interaction: deps.interaction,
    admission: deps.admission,
    receipts: deps.receipts,
    notices: deps.notices,
    clock: { now: () => new Date(deps.now()).toISOString() },
    newId: deps.newId ?? (() => NodeCrypto.randomUUID()),
    parameters: parameters as GoalParameterValues,
    module: GOALS_MODULE_NAME,
  });
  return {
    service,
    roundInFlight: (sessionId) => service.roundInFlight(sessionId),
    anyRoundInFlight() {
      const roots = store.listRoots();
      if (roots.status !== "ok" || roots.unreadable.length > 0) return "unknown";
      let answer: GoalRoundState = "none";
      for (const root of roots.roots) {
        const round = service.roundInFlight(root);
        if (round === "in-flight") return "in-flight";
        if (round === "unknown") answer = "unknown";
      }
      return answer;
    },
  };
};
