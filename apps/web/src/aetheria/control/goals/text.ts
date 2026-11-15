// What the goal view says, as plain words derived only from the Backend's last view (M07 Plan step 18, D24, C8), and what a Re-arm's outcome says (D4). Plain TypeScript. A goal is shown as it is: needs-Re-arm,
// awaiting a person, blocked at the round limit, interrupted and paused each have their own words, and nothing here says a round is "running" (no field says so) or that a goal is armed except where `armed` is true.
import type { RearmReport } from "./rearm";
import type { GoalView } from "./reply";

export type GoalHeadline =
  | "awaiting-human"
  | "complete"
  | "blocked-round-limit"
  | "blocked"
  | "needs-rearm"
  | "paused"
  | "armed"
  | "not-armed";

export interface GoalFacts {
  readonly headline: GoalHeadline;
  readonly headlineText: string;
  /** Every further fact the view carries, each its own line. */
  readonly lines: readonly string[];
}

const ROUND_LIMIT_CODE = "round-limit";

/** The one headline a goal reads as, by what must be said first: a pending person, then how it ended, then whether it will continue. */
export function goalFacts(goal: GoalView): GoalFacts {
  const lines: string[] = [`Rounds started: ${goal.roundsStarted} of ${goal.maxRounds}.`];
  let headline: GoalHeadline;
  let headlineText: string;
  if (goal.awaitingHuman !== undefined) {
    headline = "awaiting-human";
    headlineText = "Waiting for a person to answer an authorization card.";
    lines.push(
      `The card is request ${goal.awaitingHuman.interactionId} (proposal ${goal.awaitingHuman.proposalId}). Nothing changes until it is answered and the Backend verifies the answer.`,
    );
  } else if (goal.phase === "complete") {
    headline = "complete";
    headlineText = "Complete. No further rounds will start.";
  } else if (goal.phase === "blocked") {
    if (goal.blocker?.code === ROUND_LIMIT_CODE) {
      headline = "blocked-round-limit";
      headlineText = `Stopped at the round limit: ${goal.roundsStarted} of ${goal.maxRounds} rounds started.`;
    } else {
      headline = "blocked";
      headlineText = "Blocked. It will not continue until a person acts.";
    }
  } else if (goal.needsRearm) {
    headline = "needs-rearm";
    headlineText = "Active but not armed: it will not continue until it is re-armed.";
  } else if (goal.phase === "paused") {
    headline = "paused";
    headlineText = "Paused. It will not continue until a person resumes it.";
  } else if (goal.armed) {
    headline = "armed";
    headlineText = "Active and armed: the Backend starts the next round when a run settles.";
  } else {
    headline = "not-armed";
    headlineText = "Active but not armed.";
  }
  if (goal.blocker !== undefined && goal.blocker.code !== ROUND_LIMIT_CODE) {
    lines.push(`Blocker (${goal.blocker.code}): ${goal.blocker.message}`);
  } else if (goal.blocker !== undefined && goal.blocker.message !== "") {
    lines.push(`Blocker message: ${goal.blocker.message}`);
  }
  if (goal.interrupted === "backend-restarted") {
    lines.push("The Backend restarted while a round was running; that round was interrupted.");
  }
  lines.push(`Goal ${goal.goalId}, revision ${goal.revision}.`);
  return { headline, headlineText, lines };
}

export interface RearmNotice {
  readonly tone: "ok" | "warning" | "error";
  readonly text: string;
}

/** One honest sentence for the last Re-arm: success only when the read-back showed it. Null when nothing was sent. */
export function rearmNotice(report: RearmReport | null): RearmNotice | null {
  if (report === null || !report.sent) return null;
  const { outcome, stage } = report;
  switch (outcome.kind) {
    case "confirmed":
      return {
        tone: "ok",
        text: `Re-armed: the Backend's goal read back at revision ${outcome.value.revision} (it shows below as the Backend has it now).`,
      };
    case "unknown":
      return {
        tone: "warning",
        text:
          stage === "grant"
            ? "The reply to your grant never arrived, so no Re-arm was sent. It is not known whether the grant was recorded. The goal was read again; press Re-arm again only if it still offers it."
            : `${outcome.reason} It was not sent again; the goal was read again, and this page does not say the goal is armed unless that read shows it.`,
      };
    case "unavailable":
      return {
        tone: "warning",
        text:
          stage === "grant"
            ? `${outcome.reason}`
            : `The Backend could not take the Re-arm and did nothing: ${outcome.reason}`,
      };
    case "refused":
      if (outcome.code === "GOAL_STALE_REVISION") {
        const now = report.current;
        return {
          tone: "warning",
          text:
            now === undefined || now === null
              ? "The goal changed after you saw it, so nothing was re-armed. It was read again; check the goal as it is now before you re-arm."
              : `The goal changed after you saw it (it is now revision ${now.revision}), so nothing was re-armed. It was read again; check the goal as it is now before you re-arm.`,
        };
      }
      return {
        tone: "error",
        text:
          stage === "grant"
            ? "The grant was refused, so no Re-arm was sent."
            : "The Backend refused the Re-arm; nothing was re-armed.",
      };
    case "partial":
      return { tone: "warning", text: "Part of the Re-arm was applied; the goal was read again." };
  }
}
