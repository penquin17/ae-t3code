// What the workflow runs view says, as plain words derived only from the Backend's last read (M07 Plan step 29), and what a Cancel's outcome says (D4). Plain TypeScript. Each run state has its own headline;
// "cancel requested" is a running run whose cancel was asked for, and is not "cancelled" (that is a terminal fact only the run's controller writes). Nothing here says a run ended unless its state says so.
import type { CancelReport } from "./cancel";
import type { WorkflowRunView } from "./reply";

export type RunHeadline =
  | "cancel-requested"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "lost";

export interface RunFacts {
  readonly headline: RunHeadline;
  readonly headlineText: string;
  /** Every further fact the run carries, each its own line. */
  readonly lines: readonly string[];
}

const MEMBER_ORDER = [
  "pending",
  "started",
  "completed",
  "failed",
  "interrupted",
  "cancelled",
  "closed",
] as const;

/** The members by state, naming only the states that have any. */
export function memberLine(run: WorkflowRunView): string {
  const parts = MEMBER_ORDER.flatMap((state) =>
    run.members[state] > 0 ? [`${run.members[state]} ${state}`] : [],
  );
  return parts.length === 0
    ? "No members recorded."
    : `Members: ${parts.join(", ")} (${run.agentsStarted} started in all).`;
}

export function runFacts(run: WorkflowRunView): RunFacts {
  let headline: RunHeadline;
  let headlineText: string;
  switch (run.state) {
    case "running":
      if (run.cancelRequested === true) {
        headline = "cancel-requested";
        headlineText =
          "Cancel requested. The run is still running while its job and children are stopped; it ends when the run records its own end.";
      } else {
        headline = "running";
        headlineText = "Running.";
      }
      break;
    case "completed":
      headline = "completed";
      headlineText = "Completed.";
      break;
    case "failed":
      headline = "failed";
      headlineText = "Failed.";
      break;
    case "cancelled":
      headline = "cancelled";
      headlineText = "Cancelled.";
      break;
    case "lost":
      headline = "lost";
      headlineText =
        "Lost. The Backend was stopped while this run was running; it was never resumed and its children were closed.";
      break;
  }
  const lines: string[] = [];
  if (run.phase !== undefined) lines.push(`Phase: ${run.phase}`);
  lines.push(memberLine(run));
  lines.push(`Started ${run.startedAt}.`);
  if (run.endedAt !== undefined) lines.push(`Ended ${run.endedAt}.`);
  if (run.cause !== undefined) lines.push(`How it ended: ${run.cause}`);
  lines.push(`Run ${run.runId}.`);
  return { headline, headlineText, lines };
}

export interface CancelNotice {
  readonly tone: "ok" | "warning" | "error";
  readonly text: string;
}

/** One honest sentence for the last Cancel of a run: success only when the read-back showed it. Null when nothing was sent. */
export function cancelNotice(report: CancelReport | undefined): CancelNotice | null {
  if (report === undefined || !report.sent) return null;
  const { outcome } = report;
  switch (outcome.kind) {
    case "confirmed":
      return {
        tone: "ok",
        text: "Cancel asked for: the Backend's runs read back show this run ended or with its cancel requested. The run records its own end.",
      };
    case "unknown":
      return {
        tone: "warning",
        text: `${outcome.reason} It was not sent again; the runs were read again, and this page does not say the run was cancelled unless that read shows it. If it still shows running with no cancel requested, you may cancel it again.`,
      };
    case "unavailable":
      return {
        tone: "warning",
        text: `The Backend could not take the cancel and did nothing: ${outcome.reason}`,
      };
    case "refused":
      return { tone: "error", text: "The Backend refused the cancel; nothing was cancelled." };
    case "partial":
      return { tone: "warning", text: "Part of the cancel was applied; the runs were read again." };
  }
}
