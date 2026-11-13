import type { ActionOutcome, FailedOutcome } from "../core/outcome";

export interface OutcomeNotice {
  readonly tone: "ok" | "warning" | "error";
  readonly text: string;
}

/** The code and the Backend's message exactly as supplied, when the outcome is a refusal, for a refusal notice. */
export function refusalOf(
  outcome: ActionOutcome<unknown>,
): { readonly code: string; readonly message: string } | undefined {
  return outcome.kind === "refused" ? { code: outcome.code, message: outcome.message } : undefined;
}

function failedText(failed: FailedOutcome): string {
  switch (failed.kind) {
    case "refused":
      return `refused: ${failed.message}`;
    case "unknown":
      return `not known whether it applied (${failed.reason})`;
    case "unavailable":
      return `unavailable: ${failed.reason}`;
  }
}

/** One sentence per outcome for a polite status line. It claims only what the outcome carries. */
export function outcomeText(label: string, outcome: ActionOutcome<unknown>): OutcomeNotice {
  switch (outcome.kind) {
    case "confirmed":
      if (outcome.refreshed) return { tone: "ok", text: `${label} done.` };
      return {
        tone: "ok",
        text: `${label} sent; the list will show it when the backend reports it.`,
      };
    case "refused":
      return { tone: "error", text: `${label} refused: ${outcome.message}` };
    case "unknown":
      return {
        tone: "warning",
        text: `${label}: it is not known whether it applied (${outcome.reason}). Check the list; it was not sent again.`,
      };
    case "unavailable":
      return { tone: "error", text: `${label} unavailable: ${outcome.reason}` };
    case "partial":
      return {
        tone: "warning",
        text: `${label} partly done: ${outcome.applied.join(", ")} applied; ${outcome.failed.step} ${failedText(outcome.failed.outcome)}`,
      };
  }
}
