import { known, unavailable, unknown, type Known } from "../core/known";
import type { SessionFact } from "./types";

// Maps a thread shell into the policy's facts (D2, R7): archived <- archivedAt, unread <-
// lastVisitedAt against latestRunCompletedAt (no markViewed), cwd <- worktree path.
// A fact the shell does not supply is unknown or unavailable, never a default.

export interface ShellFactsInput {
  readonly id: string;
  readonly title: string;
  readonly parentThreadId: string | null;
  readonly relationshipToParent: "fork" | "subagent" | null;
  readonly worktreePath: string | null;
  readonly archivedAt: string | null;
  readonly pinnedAt: string | null;
  readonly snoozedUntil: string | null;
  /** The run status; undefined when the shell does not supply it. */
  readonly runStatus: string | undefined;
  /** The pending runtime request's kind; null when none waits. */
  readonly pendingRequestKind: string | null;
  readonly hasActionableProposedPlan: boolean;
  /** undefined when the server does not send the field; null when no run has completed. */
  readonly latestRunCompletedAt: string | null | undefined;
  /** undefined on a server that predates visit tracking; null when never visited. */
  readonly lastVisitedAt: string | null | undefined;
  readonly latestUserMessageAt: string | null;
  readonly createdAt: string;
  /** undefined when the shell does not supply a count. */
  readonly visibleItemCount: number | undefined;
}

const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);
const SETTLED_STATUSES: ReadonlySet<string> = new Set([
  "idle",
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

const APPROVAL_KINDS: ReadonlySet<string> = new Set([
  "command",
  "file-read",
  "file-change",
  "permission",
]);
const QUESTION_KINDS: ReadonlySet<string> = new Set(["mcp-elicitation", "user_input"]);

/** The policy's pending kind: approval, question, plan-review, or the raw kind (no tag) when unrecognised. */
export function pendingKindOf(
  requestKind: string | null,
  hasActionableProposedPlan: boolean,
): string | undefined {
  if (requestKind !== null) {
    if (APPROVAL_KINDS.has(requestKind)) return "approval";
    if (QUESTION_KINDS.has(requestKind)) return "question";
    return requestKind;
  }
  return hasActionableProposedPlan ? "plan-review" : undefined;
}

function unreadOf(input: ShellFactsInput): Known<boolean> {
  if (input.latestRunCompletedAt === undefined) {
    return unavailable("the server sends no latest-run completion time");
  }
  if (input.latestRunCompletedAt === null) return known(false);
  const completed = Date.parse(input.latestRunCompletedAt);
  if (Number.isNaN(completed)) return unknown("the latest-run completion time is unreadable");
  if (input.lastVisitedAt === undefined) return unavailable("the server sends no visit mark");
  // T3 does not count an unopened thread's completion as unread.
  if (input.lastVisitedAt === null) return known(false);
  const visited = Date.parse(input.lastVisitedAt);
  if (Number.isNaN(visited)) return unknown("the last-visit time is unreadable");
  return known(completed > visited);
}

function runningOf(status: string | undefined): Known<boolean> {
  if (status === undefined) return unknown("the shell carries no run status");
  if (ACTIVE_STATUSES.has(status)) return known(true);
  if (SETTLED_STATUSES.has(status)) return known(false);
  return unknown(`this build does not know the run status "${status}"`);
}

export function toSessionFact(
  input: ShellFactsInput,
  context: { readonly now: number; readonly current: boolean },
): SessionFact {
  const recent =
    input.latestUserMessageAt === null ? undefined : Date.parse(input.latestUserMessageAt);
  const created = Date.parse(input.createdAt);
  const recentMessageAt = recent === undefined || Number.isNaN(recent) ? undefined : recent;
  return {
    id: input.id,
    title: input.title,
    cwd:
      input.worktreePath === null
        ? unavailable("T3's thread shell carries no working directory")
        : known(input.worktreePath),
    parentId: input.parentThreadId ?? undefined,
    subagent: input.relationshipToParent === "subagent",
    blank:
      input.visibleItemCount === undefined
        ? unavailable("T3's thread shell has no blank-session flag")
        : known(input.visibleItemCount === 0),
    archived: input.archivedAt !== null,
    pinned: input.pinnedAt !== null,
    snoozed: input.snoozedUntil !== null && Date.parse(input.snoozedUntil) > context.now,
    running: runningOf(input.runStatus),
    pendingKind: pendingKindOf(input.pendingRequestKind, input.hasActionableProposedPlan),
    completionUnread: unreadOf(input),
    recentMessageAt,
    sortAt: recentMessageAt ?? (Number.isNaN(created) ? 0 : created),
    current: context.current,
  };
}
