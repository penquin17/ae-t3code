// One-click Re-arm as one honest outcome (M07 Plan step 18, D5, D24): the click grants for the snapshot's exact subject, then passes that grant's origin id once to `goal.rearm`. The origin id lives only inside `send`:
// never returned, stored or shown. Each call is sent at most once; a lost reply is `unknown` and never repeated, the goal is read again, and success needs a read-back at the accepted revision or later.
// A stale reference is refused with the goal's current view reported; a second click while one is in flight sends nothing.
import { gateOnConnection } from "../../connection/gate";
import {
  createActionRunner,
  type ActionOutcome,
  type OutcomeStep,
  type SendResult,
} from "../../core/outcome";
import { classifyTransport } from "../reply";
import { classifyRearm, type GoalRead, type GoalView, type RearmReply } from "./reply";
import type { GoalsTransport } from "./types";

/** Where the sequence ended: the grant call, or the Re-arm call. A grant that failed means no Re-arm was sent. */
export type RearmStage = "grant" | "rearm";

export type RearmReport =
  /** Nothing was sent: no Re-arm offer on the goal, or one is already in flight. */
  | { readonly sent: false }
  | {
      readonly sent: true;
      readonly requestId: string;
      /** The goal reference the person acted on. */
      readonly goalId: string;
      readonly revision: number;
      readonly stage: RearmStage;
      readonly outcome: ActionOutcome<GoalView>;
      /** The goal's current view when the Backend refused the reference as stale; `undefined` when it supplied none. */
      readonly current?: GoalView | null;
      /** False when a newer action started before this one settled. */
      readonly latest: boolean;
    };

export interface RearmDeps {
  readonly transport: GoalsTransport;
  readonly environmentId: string;
  readonly rootSessionId: string;
  readonly newRequestId: () => string;
  /** One sequenced re-read of the goal snapshot, owned by the view: it updates the view and reports what it found. */
  readonly readSnapshot: () => Promise<GoalRead>;
}

export function createRearm(deps: RearmDeps): (goal: GoalView) => Promise<RearmReport> {
  const { transport, environmentId, rootSessionId } = deps;
  const runner = createActionRunner({ newRequestId: deps.newRequestId });
  let inFlight = false;

  return async function rearm(goal: GoalView): Promise<RearmReport> {
    const offer = goal.rearm;
    if (offer === undefined || inFlight) return { sent: false };
    inFlight = true;
    try {
      let stage: RearmStage = "grant";
      let current: GoalView | null | undefined;
      let confirmRead = false;

      let attempted = false;
      const send = async (): Promise<SendResult<GoalView>> => {
        attempted = true;
        // The grant is for the snapshot's exact subject and this root session; its reply is read as M10's grant already is.
        let originId: string;
        try {
          const grant = classifyTransport<{ readonly originId?: unknown }>(
            await transport.grant(environmentId, {
              subject: offer.subject,
              sessionId: rootSessionId,
            }),
          );
          if (grant.class !== "accepted") {
            return grant.class === "unknown"
              ? { tag: "lost" }
              : { tag: "refused", code: grant.code ?? "REFUSED", message: grant.detail ?? "" };
          }
          const given = grant.value?.originId;
          // A grant that came back without an origin cannot be used, and whether it was recorded is not known.
          if (typeof given !== "string" || given === "") return { tag: "lost" };
          originId = given;
        } catch {
          return { tag: "lost" };
        }
        stage = "rearm";
        let reply: RearmReply;
        try {
          reply = classifyRearm(
            await transport.rearm(environmentId, {
              rootSessionId,
              goalId: goal.goalId,
              revision: goal.revision,
              originId,
            }),
          );
        } catch {
          return { tag: "lost" };
        }
        switch (reply.tag) {
          case "accepted":
            return { tag: "accepted", value: reply.goal };
          case "stale":
            current = reply.current;
            return { tag: "refused", code: "GOAL_STALE_REVISION", message: reply.detail ?? "" };
          case "refused":
            return {
              tag: "refused",
              code: reply.code,
              message: [reply.detail, reply.field === undefined ? "" : `(${reply.field})`]
                .filter((part) => part !== undefined && part !== "")
                .join(" "),
            };
          case "unavailable":
            return { tag: "unavailable", reason: reply.reason };
          case "unknown":
            return { tag: "lost" };
        }
      };

      const step: OutcomeStep<GoalView> = {
        label: "Re-arm",
        send,
        // The Backend's own projection decides: a read-back that shows this goal at the accepted revision or later, or the outcome is unknown.
        confirm: async (accepted) => {
          confirmRead = true;
          const read = await deps.readSnapshot();
          if (read.tag !== "ok") return { tag: "failed", reason: read.reason };
          return read.goal !== null &&
            read.goal.goalId === accepted.goalId &&
            read.goal.revision >= accepted.revision
            ? { tag: "shows" }
            : { tag: "absent" };
        },
      };
      // The gate blocks the send while the connection does not allow actions: `attempted` stays false, nothing was sent, and nothing is read back.
      const run = await runner.run(`rearm:${goal.goalId}`, gateOnConnection(step));
      // Whatever the reply, the view reads again unless the confirming read already did: it never trusts the reply to change it.
      if (attempted && !confirmRead) await deps.readSnapshot();
      return {
        sent: true,
        requestId: run.requestId,
        goalId: goal.goalId,
        revision: goal.revision,
        stage,
        outcome: run.outcome,
        ...(current === undefined ? {} : { current }),
        latest: run.current,
      };
    } finally {
      inFlight = false;
    }
  };
}
