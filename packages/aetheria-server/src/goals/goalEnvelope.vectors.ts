// AETHERIA M07 DV10 — the XC-6 envelope of the model's goal operations, as the REAL Backend operations answer it. Data only, no imports, so the outer repository's Pi goal tools read it by path (as the
// inspect vectors are read): the fork's m07GoalsOperations test runs the real `goals.get/create/update` operations and requires each answer to equal `settled` below (ids normalized to `proposal-1` and
// `goal-1`), and the outer goal-tool test feeds the same `settled` through the Pi tool's reading path and requires `tool_result`. A change to either side's envelope fails one of the two tests.
// `settled.result` is the strict reply of `decodeGoalToolReply` itself, with no ok/value wrapper: its own `outcome` carries ok, refused, awaiting-human and unavailable.

export interface GoalEnvelopeVector {
  readonly name: string;
  /** The Pi tool that sends it and the arguments the model gives; `goal-1` and revision 1 stand for the goal the scenario created. */
  readonly tool: "get_goal" | "create_goal" | "update_goal";
  readonly params: Readonly<Record<string, unknown>>;
  readonly operation: "goals.get" | "goals.create" | "goals.update";
  /** The state the fork's test builds before the call. */
  readonly scenario: "none" | "armed" | "running" | "child" | "unreadable";
  readonly settled: { readonly status: "done"; readonly result: Readonly<Record<string, unknown>> };
  /** What the Pi tool renders from it. */
  readonly toolResult: {
    readonly isError: boolean;
    readonly terminate: boolean;
    readonly outcome: string;
  };
}

const goal = (phase: string, extra: Readonly<Record<string, unknown>> = {}) => ({
  id: "goal-1",
  revision: 1,
  objective: "ship it",
  phase,
  roundsStarted: 0,
  maxGoalRounds: 3,
  ...extra,
});

export const goalEnvelopeVectors: readonly GoalEnvelopeVector[] = [
  {
    name: "get with no goal",
    tool: "get_goal",
    params: {},
    operation: "goals.get",
    scenario: "none",
    settled: { status: "done", result: { outcome: "ok", goal: null } },
    toolResult: { isError: false, terminate: false, outcome: "ok" },
  },
  {
    name: "create proposes a card",
    tool: "create_goal",
    params: { objective: "ship it", max_goal_rounds: 3 },
    operation: "goals.create",
    scenario: "none",
    settled: { status: "done", result: { outcome: "awaiting-human", proposalId: "proposal-1" } },
    toolResult: { isError: false, terminate: false, outcome: "awaiting-human" },
  },
  {
    name: "get an armed goal",
    tool: "get_goal",
    params: {},
    operation: "goals.get",
    scenario: "armed",
    settled: {
      status: "done",
      result: { outcome: "ok", goal: goal("active"), activation: "armed" },
    },
    toolResult: { isError: false, terminate: false, outcome: "ok" },
  },
  {
    name: "pause is accepted without wrapUp",
    tool: "update_goal",
    params: { goal_id: "goal-1", revision: 1, action: "pause" },
    operation: "goals.update",
    scenario: "armed",
    settled: {
      status: "done",
      result: { outcome: "ok", goal: goal("paused", { revision: 2 }), activation: "disarmed" },
    },
    toolResult: { isError: false, terminate: false, outcome: "ok" },
  },
  {
    name: "complete outside a running round is refused",
    tool: "update_goal",
    params: { goal_id: "goal-1", revision: 1, action: "complete" },
    operation: "goals.update",
    scenario: "armed",
    settled: {
      status: "done",
      result: {
        outcome: "refused",
        code: "GOAL_NOT_AUTHORIZED",
        detail:
          "this goal has no running round of this revision; only a running goal round may complete or block it",
      },
    },
    toolResult: { isError: true, terminate: false, outcome: "refused" },
  },
  {
    name: "complete under the running round carries wrapUp",
    tool: "update_goal",
    params: { goal_id: "goal-1", revision: 1, action: "complete" },
    operation: "goals.update",
    scenario: "running",
    settled: {
      status: "done",
      result: {
        outcome: "ok",
        goal: goal("complete", { revision: 2, roundsStarted: 1 }),
        activation: "disarmed",
        wrapUp: true,
      },
    },
    toolResult: { isError: false, terminate: true, outcome: "ok" },
  },
  {
    name: "a child session is refused",
    tool: "get_goal",
    params: {},
    operation: "goals.get",
    scenario: "child",
    settled: {
      status: "done",
      result: {
        outcome: "refused",
        code: "GOAL_NOT_ROOT",
        detail: "a goal belongs to a main session; this session is a child",
      },
    },
    toolResult: { isError: true, terminate: false, outcome: "refused" },
  },
  {
    name: "an unreadable session is unavailable",
    tool: "get_goal",
    params: {},
    operation: "goals.get",
    scenario: "unreadable",
    settled: {
      status: "done",
      result: {
        outcome: "unavailable",
        detail: "the session's identity cannot be read (unreadable)",
      },
    },
    toolResult: { isError: true, terminate: false, outcome: "unavailable" },
  },
];
