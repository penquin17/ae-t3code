/* oxlint-disable t3code/no-low-value-comments -- The header states the authority boundary of the model's goal operations: what a tool may ask and when wrapUp may be set. */
// AETHERIA M07 Plan steps 16–17 (DV10; D4, D12, D13) — the three XC-6 operations the model's goal tools use: `goals.get`, `goals.create` and `goals.update`. Each carries ONLY the tool's own arguments, decoded strictly
// before anything runs (a malformed argument is an error, even while the service is not running); the caller is the verified session of the carrier (`context.sessionId`), never an argument, and the service itself
// resolves it to a main root and refuses a child. Their `done` value is the archive's strict reply codec: a reply that does not decode is `unavailable`, never passed on.
//
// What a tool can ask. `create`, `edit` and `resume` only PROPOSE: the goal service writes the card and answers `awaiting-human{proposalId}`; nothing is armed until a person's verified answer commits. `pause` is the
// root session's own stop (U3). `complete` and `blocked` are accepted only by the service's exact live running round of this goal and revision; only when that acceptance succeeds does the reply carry `wrapUp: true`
// (the Agent then ends its turn after the closing message, B4). No operation here arms, re-arms, names an origin or reaches a client action.
import type { Xc6Operation, Xc6OperationContext, Xc6Settled } from "@t3tools/aetheria-contracts";

import {
  GOAL_OPERATIONS,
  decodeCreateGoalArgs,
  decodeGetGoalArgs,
  decodeGoalToolReply,
  decodeUpdateGoalArgs,
  type GoalResult,
  type GoalService,
  type GoalToolReply,
  type GoalView,
  type ToolGoal,
} from "./goalsEntry.ts";

/** Answered when the module is not running (the adapter also gates every operation on the module's own state). */
const NOT_RUNNING = "GOALS_NOT_RUNNING";
/** Answered when a reply did not fit the archive's strict reply codec: nothing is passed to the model that the codec would refuse. */
const REPLY_INVALID = "GOALS_REPLY_INVALID";

const toolGoal = (view: GoalView): ToolGoal => ({
  id: view.goalId,
  revision: view.revision,
  objective: view.objective,
  phase: view.phase,
  roundsStarted: view.roundsStarted,
  maxGoalRounds: view.maxRounds,
  ...(view.blocker === undefined ? {} : { blockedReason: view.blocker.message }),
});

/** Whether the goal is armed now is an observation for the model, never a stored permission. */
const okWith = (view: GoalView, wrapUp: boolean): GoalToolReply => ({
  outcome: "ok",
  goal: toolGoal(view),
  activation: view.armed ? "armed" : "disarmed",
  ...(wrapUp ? { wrapUp: true as const } : {}),
});

const replyOf = <V>(result: GoalResult<V>, onOk: (value: V) => GoalToolReply): GoalToolReply => {
  switch (result.status) {
    case "ok":
      return onOk(result.value);
    case "refused":
      return {
        outcome: "refused",
        code: result.code,
        ...(result.detail === undefined ? {} : { detail: result.detail }),
      };
    case "awaiting-human":
      return { outcome: "awaiting-human", proposalId: result.proposalId };
    case "unavailable":
      return { outcome: "unavailable", detail: result.detail };
  }
};

const settle = (reply: GoalToolReply): Xc6Settled => {
  const checked = decodeGoalToolReply(reply);
  return checked.ok
    ? { status: "done", result: checked.value }
    : { status: "unavailable", code: REPLY_INVALID };
};

/** Strict arguments first: the operation fails as an error, not as a goal outcome, when the model's arguments do not fit. */
const arguments_ = <T>(
  name: string,
  decoded: { ok: true; value: T } | { ok: false; reason: string },
): T => {
  if (!decoded.ok) throw new Error(`${name}: ${decoded.reason}`);
  return decoded.value;
};

/**
 * A mutation that threw may have landed: the model is told to read the goal before it acts again, and nothing is resent. A read that threw changed nothing.
 */
const guarded = async (
  mayHaveWritten: boolean,
  run: () => Promise<GoalToolReply>,
): Promise<Xc6Settled> => {
  try {
    return settle(await run());
  } catch {
    return settle({
      outcome: "unavailable",
      detail: mayHaveWritten
        ? "outcome unknown: the goal service failed while the change may have landed; read the goal before acting again"
        : "the goal service failed; nothing was read",
    });
  }
};

export function createGoalOperations(
  running: () => GoalService | undefined,
): Readonly<Record<string, Xc6Operation>> {
  const withService =
    (run: (service: GoalService, sessionId: string) => Promise<Xc6Settled>) =>
    (context: Xc6OperationContext): Promise<Xc6Settled> => {
      const service = running();
      return service === undefined
        ? Promise.resolve({ status: "unavailable", code: NOT_RUNNING })
        : run(service, context.sessionId);
    };

  return {
    [GOAL_OPERATIONS.get]: (context) => {
      arguments_(GOAL_OPERATIONS.get, decodeGetGoalArgs(context.args));
      return withService((service, sessionId) =>
        guarded(false, async () =>
          replyOf(await service.snapshot(sessionId), ({ goal }) =>
            goal === null ? { outcome: "ok", goal: null } : okWith(goal, false),
          ),
        ),
      )(context);
    },

    [GOAL_OPERATIONS.create]: (context) => {
      const args = arguments_(GOAL_OPERATIONS.create, decodeCreateGoalArgs(context.args));
      return withService((service, sessionId) =>
        guarded(true, async () =>
          replyOf(
            await service.propose(sessionId, {
              op: "create",
              objective: args.objective,
              ...(args.max_goal_rounds === undefined ? {} : { maxRounds: args.max_goal_rounds }),
            }),
            () => ({ outcome: "unavailable", detail: "a proposal answered without a card" }),
          ),
        ),
      )(context);
    },

    [GOAL_OPERATIONS.update]: (context) => {
      const args = arguments_(GOAL_OPERATIONS.update, decodeUpdateGoalArgs(context.args));
      const ref = { goalId: args.goal_id, revision: args.revision };
      return withService((service, sessionId) =>
        guarded(true, async (): Promise<GoalToolReply> => {
          switch (args.action) {
            case "edit":
              return replyOf(
                await service.propose(sessionId, {
                  op: "edit",
                  baseRef: ref,
                  ...(args.objective === undefined ? {} : { objective: args.objective }),
                  ...(args.max_goal_rounds === undefined
                    ? {}
                    : { maxRounds: args.max_goal_rounds }),
                }),
                () => ({ outcome: "unavailable", detail: "a proposal answered without a card" }),
              );
            case "resume":
              return replyOf(
                await service.propose(sessionId, { op: "resume", baseRef: ref }),
                () => ({ outcome: "unavailable", detail: "a proposal answered without a card" }),
              );
            case "pause":
              return replyOf(await service.pause(sessionId, ref), (view) => okWith(view, false));
            // The service accepts these two only for this goal's exact live running round; an acceptance is the only thing that sets `wrapUp`.
            case "complete":
              return replyOf(await service.complete(sessionId, ref), (view) => okWith(view, true));
            case "blocked":
              return replyOf(
                await service.block(sessionId, ref, args.blocked_reason ?? ""),
                (view) => okWith(view, true),
              );
          }
        }),
      )(context);
    },
  };
}
