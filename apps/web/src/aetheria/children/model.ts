// What a root's children are, as the Backend says (M10 Plan step 10, D2, C7). Plain TypeScript over supplied replies: no T3, no DOM. A state the Backend cannot read stays `unknown`; the Backend's
// own diagnostics and details are carried verbatim; one read has one owner, so a stale reply or another root's reply never lands.
import type { ActionOutcome, FailedOutcome, SendResult } from "../core/outcome";
import { outcomeText } from "../sessions/outcomeText";
import type { OutcomeNotice } from "../sessions/outcomeText";

export type ChildMode = "one-shot" | "continuable";
export type ChildState = "running" | "idle" | "closed" | "unknown";
export type SettleStatus = "completed" | "failed" | "interrupted";

/** Mirrors `ChildRow` in packages/aetheria-contracts/src/childrenControlOperations.ts (lines 74–86); the web does not depend on that package. */
export interface ChildRowValue {
  readonly childId: string;
  readonly parentId: string;
  readonly depth: number;
  readonly role: string | null;
  readonly mode: ChildMode;
  readonly label?: string;
  readonly state: ChildState;
  readonly lastOutcome: { readonly status: SettleStatus; readonly cause?: string } | null;
  readonly route: number | null;
}
/** Mirrors `ChildDiagnostic` (lines 87–91). */
export interface ChildDiagnostic {
  readonly kind: "corrupt" | "unsupported" | "unavailable" | "unregistered-fork";
  readonly id: string;
  readonly detail?: string;
}
/** Mirrors `ListValue` (lines 92–95). */
export interface ChildrenListValue {
  readonly rows: readonly ChildRowValue[];
  readonly diagnostics: readonly ChildDiagnostic[];
}

/** What one read of a root's children said. `reading` is only the time before the first answer. */
export type ListView =
  | { readonly tag: "reading" }
  | { readonly tag: "read"; readonly list: ChildrenListValue }
  | { readonly tag: "refused"; readonly code: string; readonly detail?: string }
  | { readonly tag: "unavailable"; readonly reason: string }
  | { readonly tag: "unknown"; readonly reason: string };

/** The single owner of the last answer for one root; a reply lands only through `finishRead`. */
export interface ListState {
  readonly rootThreadId: string;
  readonly ticket: number;
  readonly refreshing: boolean;
  readonly view: ListView;
}

export const initialListState = (rootThreadId: string): ListState => ({
  rootThreadId,
  ticket: 0,
  refreshing: false,
  view: { tag: "reading" },
});

/** A new read of `rootThreadId`. Another root starts from `reading`; the same root keeps its last answer on screen until the new one lands. */
export function startRead(
  state: ListState,
  rootThreadId: string,
): { readonly state: ListState; readonly ticket: number } {
  const ticket = state.ticket + 1;
  const view: ListView = state.rootThreadId === rootThreadId ? state.view : { tag: "reading" };
  return { state: { rootThreadId, ticket, refreshing: true, view }, ticket };
}

/** A reply for an older read, or for another root, says nothing about the present: it changes nothing. */
export function finishRead(
  state: ListState,
  ticket: number,
  rootThreadId: string,
  view: ListView,
): ListState {
  if (ticket !== state.ticket || rootThreadId !== state.rootThreadId) return state;
  return { ...state, refreshing: false, view };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Codes that mean the Backend could not say whether it did the thing (M05's own `ORCHESTRATION_UNAVAILABLE` included); for a read they leave the list unknown. */
const UNKNOWN_CODES = new Set(["CHILDREN_OUTCOME_UNKNOWN", "ORCHESTRATION_UNAVAILABLE"]);

/** A reply that is not a list says nothing, so it is never an empty list. */
const isListValue = (value: unknown): value is ChildrenListValue =>
  isRecord(value) && Array.isArray(value.rows) && Array.isArray(value.diagnostics);

/** One Backend answer to `aetheria.children.list` as one view. Details are kept exactly as the Backend sent them. */
export function listViewFromSend(send: SendResult<unknown>): ListView {
  switch (send.tag) {
    case "lost":
      return { tag: "unknown", reason: "the reply never arrived, so the children were not read" };
    case "unavailable":
      return { tag: "unavailable", reason: send.reason };
    case "refused":
      return { tag: "refused", code: send.code, detail: send.message };
    case "accepted": {
      const reply = send.value;
      if (!isRecord(reply) || typeof reply.ok !== "boolean") {
        return { tag: "unknown", reason: "the Backend's answer was not a list" };
      }
      if (reply.ok) {
        return isListValue(reply.value)
          ? { tag: "read", list: reply.value }
          : { tag: "unknown", reason: "the Backend's answer was not a list" };
      }
      const code = typeof reply.code === "string" ? reply.code : "";
      const detail = typeof reply.detail === "string" ? reply.detail : undefined;
      if (code === "CHILDREN_UNAVAILABLE") {
        return {
          tag: "unavailable",
          reason: detail ?? "The Backend could not take the request; nothing was done.",
        };
      }
      if (UNKNOWN_CODES.has(code)) {
        return { tag: "unknown", reason: detail ?? "the Backend could not read the children" };
      }
      return { tag: "refused", code, ...(detail === undefined ? {} : { detail }) };
    }
  }
}

export interface ChildRowView {
  readonly childId: string;
  readonly parentId: string;
  readonly depth: number;
  readonly role: string | null;
  readonly mode: ChildMode;
  readonly modeText: string;
  readonly label: string | undefined;
  /** What the row is called: the Backend's label, else the child's id. */
  readonly name: string;
  readonly state: ChildState;
  readonly stateText: string;
  /** False only for `unknown`: the Backend could not read the state, which is not "idle". */
  readonly stateKnown: boolean;
  readonly lastOutcomeText: string;
  readonly route: number | null;
  readonly diagnostics: readonly ChildDiagnostic[];
}

const STATE_TEXT: Readonly<Record<ChildState, string>> = {
  running: "Running",
  idle: "Idle",
  closed: "Closed",
  unknown: "Unknown",
};

const lastOutcomeText = (outcome: ChildRowValue["lastOutcome"]): string =>
  outcome === null
    ? "No finished turn is recorded."
    : `Last turn: ${outcome.status}${outcome.cause === undefined ? "" : ` (${outcome.cause})`}`;

/** Rows in the Backend's order. A diagnostic that names a row is attached to it; nothing is dropped. */
export function rowViews(list: ChildrenListValue): readonly ChildRowView[] {
  return list.rows.map((row) => ({
    childId: row.childId,
    parentId: row.parentId,
    depth: row.depth,
    role: row.role,
    mode: row.mode,
    modeText: row.mode === "one-shot" ? "One-shot" : "Continuable",
    label: row.label,
    name: row.label ?? row.childId,
    state: row.state,
    stateText: STATE_TEXT[row.state] ?? "Unknown",
    stateKnown: row.state !== "unknown",
    lastOutcomeText: lastOutcomeText(row.lastOutcome),
    route: row.route,
    diagnostics: list.diagnostics.filter((diagnostic) => diagnostic.id === row.childId),
  }));
}

/** Diagnostics the Backend gave that name no listed row (a record it could not read at all), in its order. */
export const unattachedDiagnostics = (list: ChildrenListValue): readonly ChildDiagnostic[] =>
  list.diagnostics.filter((diagnostic) => !list.rows.some((row) => row.childId === diagnostic.id));

function failedFromView(view: ListView): FailedOutcome {
  switch (view.tag) {
    case "refused":
      return { kind: "refused", code: view.code, message: view.detail ?? view.code };
    case "unavailable":
      return { kind: "unavailable", reason: view.reason };
    case "unknown":
      return { kind: "unknown", reason: view.reason };
    default:
      return { kind: "unknown", reason: "the list was not re-read" };
  }
}

/**
 * A Stop the Backend accepted, followed by a re-read of the list that did not work, is partly done: the Stop applied, what the list now says is not known. A Stop that failed is left as it is.
 * The re-read is a read: it never sends the Stop again.
 */
export function stopWithReadBack(
  outcome: ActionOutcome<unknown>,
  childId: string,
  mode: ChildMode,
  readBack: ListView,
): ActionOutcome<unknown> {
  if (outcome.kind !== "confirmed" || readBack.tag === "read") return outcome;
  return {
    kind: "partial",
    applied: [`${mode === "one-shot" ? "closed" : "interrupted"} ${childId}`],
    failed: { step: "the list re-read", outcome: failedFromView(readBack) },
  };
}

/** One sentence for the polite status line, claiming only what the outcome carries. */
export function childStopNotice(name: string, outcome: ActionOutcome<unknown>): OutcomeNotice {
  if (outcome.kind === "confirmed" && isRecord(outcome.value)) {
    const value = outcome.value;
    if (value.closed === true) {
      const jobs = Array.isArray(value.killedJobs) ? value.killedJobs : [];
      return {
        tone: "ok",
        text: `Closed ${name}.${jobs.length > 0 ? ` Jobs killed: ${jobs.join(", ")}.` : ""}`,
      };
    }
    if (value.accepted === true) return { tone: "ok", text: `Interrupt accepted for ${name}.` };
  }
  if (outcome.kind === "confirmed") return { tone: "ok", text: `Stop sent for ${name}.` };
  return outcomeText("Stop", outcome);
}
