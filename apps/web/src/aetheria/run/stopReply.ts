// How a Backend reply to the user's Stop ends as one honest outcome (D4, D5, R1). Plain TypeScript over the reply's shape; no T3 import.
//
// A reply is `{ok:true,value}` or `{ok:false,code,detail?}`. The Backend answers a refusal it made BEFORE acting (scope, revoked device, a root the connection may not reach) as
// a refusal; "nothing was done" as unavailable; and every code that says the effect may or may not have landed, or that this client does not know, as a lost reply: unknown, never
// resent. A tree Stop that M05 answers `complete:false` (a child it could not handle, or a root T3 did not confirm) is "partly done", never "stopped".
import type { ActionOutcome, SendResult } from "../core/outcome";
import { outcomeText, type OutcomeNotice } from "../sessions/outcomeText";

export type CancelAction =
  | "interrupted"
  | "closed"
  | "left-idle"
  | "left-closed"
  | "failed"
  | "unavailable";
export interface CancelTreeValue {
  readonly rootThreadId: string;
  readonly rows: readonly {
    readonly childId: string;
    readonly action: CancelAction;
    readonly detail?: string;
  }[];
  readonly rootStopped: boolean;
  readonly complete: boolean;
}
export type StopReply<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly detail?: string };

/** Refusals the Backend made before it acted, with words a person can read. M05's own refusals use their detail. */
const REFUSALS: Readonly<Record<string, string>> = {
  CHILDREN_NOT_AUTHORIZED: "This device cannot stop work (it is read-only).",
  NOT_AUTHORIZED: "This device cannot stop work (it is read-only).",
  CHILDREN_DEVICE_REVOKED: "This device's access was revoked or has expired.",
  CHILDREN_NOT_FOUND: "That session is not available to this device.",
  CHILD_NOT_OWNED: "That child does not belong to this session.",
  CHILD_NOT_ADJACENT: "That child is not one this session may stop.",
  CHILD_NOT_RESUMABLE: "That child cannot be interrupted; it can be closed.",
};

export function stopSendResult<T>(reply: StopReply<T>): SendResult<T> {
  // A value that is not a reply says nothing about what happened: it is a lost reply, never a pass.
  if (reply === null || typeof reply !== "object" || typeof reply.ok !== "boolean") {
    return { tag: "lost" };
  }
  if (reply.ok) return { tag: "accepted", value: reply.value };
  if (reply.code === "CHILDREN_UNAVAILABLE") {
    return {
      tag: "unavailable",
      reason: reply.detail ?? "The Backend could not take the request; nothing was done.",
    };
  }
  const words = REFUSALS[reply.code];
  if (words !== undefined) {
    return { tag: "refused", code: reply.code, message: words };
  }
  // CHILDREN_OUTCOME_UNKNOWN, ORCHESTRATION_UNAVAILABLE and the rest: the effect may have landed, so it is read as a lost reply.
  return { tag: "lost" };
}

const rowText = (row: CancelTreeValue["rows"][number]): string =>
  `${row.childId}${row.detail === undefined ? "" : ` (${row.detail})`}`;

/** An accepted tree Stop that M05 did not complete is partly done: the children it handled applied; the rest, or the root, are not known to have stopped. */
export function stopOutcomeFromAccepted(
  outcome: ActionOutcome<CancelTreeValue>,
): ActionOutcome<CancelTreeValue> {
  if (outcome.kind !== "confirmed" || outcome.value.complete) return outcome;
  const value = outcome.value;
  const applied: string[] = [];
  const notHandled: string[] = [];
  for (const row of value.rows) {
    if (row.action === "interrupted") applied.push(`interrupted ${row.childId}`);
    else if (row.action === "closed") applied.push(`closed ${row.childId}`);
    else if (row.action === "left-idle") applied.push(`left ${row.childId} idle`);
    else if (row.action === "failed" || row.action === "unavailable") notHandled.push(rowText(row));
  }
  const reasons = [
    ...(notHandled.length > 0 ? [`children not handled: ${notHandled.join("; ")}`] : []),
    ...(value.rootStopped ? [] : ["the root's stop was not confirmed by T3"]),
  ];
  return {
    kind: "partial",
    applied,
    failed: {
      step: notHandled.length > 0 ? "the rest of the tree" : "the root",
      outcome: { kind: "unknown", reason: reasons.join("; ") },
    },
  };
}

/** One sentence for a polite status line. A confirmed stop says little: the running indicator shows stopping and settled from the backend. */
export function stopNotice(outcome: ActionOutcome<unknown>): OutcomeNotice {
  if (outcome.kind === "confirmed") return { tone: "ok", text: "Stop sent." };
  return outcomeText("Stop", outcome);
}
