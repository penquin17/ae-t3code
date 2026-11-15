/* oxlint-disable t3code/no-low-value-comments -- The header states the authority boundary of a typed /goal (a request, never a proof) and the single-import-site constraint. */
// AETHERIA M07 Plan step 19 (D25, C8) — the seam where a typed `/goal` message on a Pi thread becomes an Aetheria goal operation. T3's own `/goal` handling is gated to the codex and claude drivers
// (`goalDriverFor`), so for a Pi thread the message is ordinary prompt text that no native driver consumes (B7 probe, `m07ForkGoalProbe.aetheria.test.ts`); this file is the one place that reads it
// instead, with T3's own `parseGoalCommand` and no vocabulary of its own.
//
// The parse, the map from command to operation, and the calls into the goal service are ONE implementation, `runGoalCommand` in `@aetheria/goals` (client/commands.ts); the wiring supplies it as `run`, so
// this file imports no archive and the Backend's single archive import site stays single. A typed message is a request, never a proof of a person (B1): set and resume only open D5's card, pause and
// clear are the root session's own actions, show is a read, and the text names no origin, actor or root — the session comes from the caller. No other driver is touched: a Codex or Claude thread
// is `not-aetheria-driver` and the message goes on to T3 unchanged.
import { parseGoalCommand, type OrchestrationV2GoalCommand } from "@t3tools/contracts";

/** The only driver whose typed `/goal` is Aetheria's. Codex and Claude keep T3's native handling; any other driver keeps ordinary text. */
const AETHERIA_GOAL_DRIVER = "pi";

/** What `runGoalCommand` answers, restated structurally (the service's `GoalResult` and `TypedGoalOutcome` satisfy it). */
export type GoalCommandOutcome =
  | { readonly handled: false; readonly reason: string }
  | {
      readonly handled: true;
      readonly plan: { readonly kind: string; readonly command?: string } | null;
      readonly result: {
        readonly status: string;
        readonly code?: string;
        readonly value?: unknown;
      };
    };

export interface GoalCommandRouteDeps {
  /** `runGoalCommand(command, sessionId, goalService)` from the goals package, bound to the Backend's goal service. */
  readonly run: (
    command: OrchestrationV2GoalCommand | null,
    sessionId: string,
  ) => Promise<GoalCommandOutcome>;
}

export interface GoalCommandRoute {
  /** `handled: false` means the message goes on as it would have: ordinary text, a non-Pi thread, or a command the adapter does not know. Never throws on a service answer. */
  route(input: {
    readonly driver: string;
    readonly sessionId: string;
    readonly message: {
      readonly text: string;
      readonly attachments?: ReadonlyArray<unknown> | undefined;
    };
  }): Promise<GoalCommandOutcome>;
}

export function makeGoalCommandRoute(deps: GoalCommandRouteDeps): GoalCommandRoute {
  return {
    route: ({ driver, sessionId, message }) =>
      driver === AETHERIA_GOAL_DRIVER
        ? deps.run(parseGoalCommand(message), sessionId)
        : Promise.resolve({ handled: false, reason: "not-aetheria-driver" }),
  };
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

/** One plain line for the person who typed the command, or null when the message was not handled. It states only what the service answered and never says a goal is armed unless its own view says so. */
export function describeGoalOutcome(outcome: GoalCommandOutcome): string | null {
  if (!outcome.handled) return null;
  const { plan, result } = outcome;
  switch (result.status) {
    case "awaiting-human":
      return "Goal request sent for your approval. Nothing changes until you approve it on the card.";
    case "no-goal":
      return `There is no goal to ${plan?.command ?? "change"}.`;
    case "refused":
      return result.code === "GOAL_NOT_ROOT"
        ? "Only the main session can have a goal."
        : `Goal request refused (${result.code ?? "no code"}). Nothing changed.`;
    case "unavailable":
      return "Goal state could not be read. Nothing changed.";
    case "ok": {
      if (plan?.kind === "pause") return "Goal paused.";
      if (plan?.kind === "clear") return "Goal cleared.";
      const goal = record(record(result.value)?.["goal"]);
      if (goal === null) return "No goal is set for this session.";
      const state =
        goal["armed"] === true
          ? "running"
          : goal["needsRearm"] === true
            ? "waiting for you to re-arm"
            : String(goal["phase"]);
      return `Goal (${state}, round ${String(goal["roundsStarted"])} of ${String(goal["maxRounds"])}): ${String(goal["objective"])}`;
    }
    default:
      return "Goal request not understood. Nothing changed.";
  }
}
