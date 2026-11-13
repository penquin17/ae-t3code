// Words for a record's state and for what an action did (D4, D14, C7). Each sentence claims only what the Backend supplied: no "delivered" unless a delivery says so, no "done" unless a re-read
// showed it. A refusal's own words are NOT here: the view shows them verbatim through `RefusalNotice`. Plain TypeScript.
import type { ActionReport } from "./actions";
import type { InteractionRecord } from "./types";

export const isOpen = (record: InteractionRecord): boolean =>
  record.state === "pending" || record.state === "continued";

export interface RecordFacts {
  readonly headline: string;
  readonly lines: readonly string[];
}

const deliveryLine = (record: InteractionRecord): string[] => {
  const delivery = record.delivery;
  if (delivery === undefined) return [];
  if (delivery.status === "pending") return ["Delivery pending."];
  if (delivery.status === "delivered") return [`Delivered (command ${delivery.commandId}).`];
  return [`Delivery failed (${delivery.code}).`];
};

export function recordFacts(record: InteractionRecord): RecordFacts {
  const resolution = record.resolution;
  const lines: string[] = [];
  if (record.held) lines.push("Held.");
  if (record.deadlineAt !== undefined) lines.push(`Deadline: ${record.deadlineAt}`);
  switch (record.state) {
    case "pending":
      return { headline: "Waiting for your answer", lines };
    case "continued":
      return {
        headline: `The agent stopped waiting (${record.continuedCause ?? "cause not supplied"})`,
        lines: [...lines, "An answer now is delivered late, after the agent has moved on."],
      };
    case "answered": {
      if (resolution?.type === "decision") {
        const headline = resolution.decision === "approved" ? "Approved" : "Changes requested";
        const feedback =
          resolution.feedback === undefined ? [] : [`Feedback: ${resolution.feedback}`];
        return {
          headline,
          lines: [...lines, ...feedback, `Origin: ${resolution.originId}`, ...deliveryLine(record)],
        };
      }
      // An authorization shows its origin once, in the card's origin box, so the status line leaves it out.
      const origin =
        resolution?.type === "answers" && record.kind !== "authorization"
          ? [`Origin: ${resolution.originId}`]
          : [];
      return { headline: "Answered", lines: [...lines, ...origin, ...deliveryLine(record)] };
    }
    case "cancelled": {
      const feedback =
        resolution?.type === "cancelled" && resolution.feedback !== undefined
          ? [`Feedback: ${resolution.feedback}`]
          : [];
      const modeOff =
        resolution?.type === "cancelled" && resolution.cause === "mode-off"
          ? ["Plan mode was switched off."]
          : [];
      return { headline: "Cancelled", lines: [...lines, ...feedback, ...modeOff] };
    }
    case "superseded":
      return {
        headline: `Superseded by ${resolution?.type === "superseded" ? resolution.by : "a newer request"}`,
        lines,
      };
  }
}

export interface ReportNotice {
  readonly tone: "ok" | "warning" | "error";
  readonly text: string;
}

/**
 * One sentence per outcome, or `null` when the view says it by showing the refusal verbatim. A conflict, an already-settled reply and a failed delivery add a sentence beside the Backend's
 * words, because the person needs to know what to do next; none of them says "unchanged".
 */
export function reportNotice(label: string, report: ActionReport<unknown>): ReportNotice | null {
  if (!report.sent) return null;
  const { outcome, reply } = report;
  switch (reply.class) {
    case "stale-revision":
      return {
        tone: "warning",
        text: `${label} not applied: this request changed after you saw it. Your draft stays as an earlier version; review the new one.`,
      };
    case "already-settled":
      return {
        tone: "warning",
        text: `${label} not applied: the request was already settled. The Backend's record below shows how.`,
      };
    case "delivery-failed":
      return {
        tone: "error",
        text: `${label} was recorded, but the answer was not delivered to the agent (${reply.detail ?? reply.code ?? "no reason supplied"}).`,
      };
    default:
  }
  switch (outcome.kind) {
    case "confirmed":
      if (outcome.refreshed) return { tone: "ok", text: `${label} done.` };
      return {
        tone: "ok",
        text: `${label} sent; the view will show it when the Backend reports it.`,
      };
    case "unknown":
      return {
        tone: "warning",
        text: `${label}: it is not known whether it applied (${outcome.reason}). It was not sent again; the view was re-read.`,
      };
    case "unavailable":
      return { tone: "error", text: `${label} unavailable: ${outcome.reason}` };
    case "partial":
      return { tone: "warning", text: `${label} partly done.` };
    case "refused":
      return null;
  }
}
