// A child's stored report, read for the user (M10 Plan step 10, D2, C7). `aetheria.children.report` arrives in phase 2b, so the read sits behind a transport the host supplies; the default
// answers `unavailable` in words that say so. A report is carried as the Backend stored it. Plain TypeScript plus one React context.
import { createContext, use } from "react";

import type { SettleStatus } from "./model";

/** Mirrors `ChildReport` in packages/aetheria-orchestration/src/operations/types.ts (lines 14–21). */
export interface ChildReportValue {
  readonly status: SettleStatus;
  readonly cause?: string;
  readonly text: string;
  readonly structured?: unknown;
  /** The route the child ended on, 1-based. */
  readonly route: number;
}
/** Mirrors `UserReportValue` in packages/aetheria-orchestration/src/children/reports.ts (lines 46–49). It carries no rollback notice field. */
export type UserReportValue =
  | { readonly state: "reported"; readonly report: ChildReportValue }
  | { readonly state: "pending" }
  | { readonly state: "not-record-only" };

export type ReportReply =
  | { readonly ok: true; readonly value: UserReportValue }
  | { readonly ok: false; readonly code: string; readonly detail?: string };

export interface ReportsTransport {
  readonly read: (request: {
    readonly rootThreadId: string;
    readonly target: string;
  }) => Promise<ReportReply>;
}

/** The production default until phase 2b: nothing is read, and nothing is claimed about the report. */
export const UNAVAILABLE_REPORTS: ReportsTransport = {
  read: () =>
    Promise.resolve({
      ok: false,
      code: "CHILDREN_UNAVAILABLE",
      detail: "The report read is not connected in this build yet",
    }),
};

export const ReportsTransportContext = createContext<ReportsTransport>(UNAVAILABLE_REPORTS);
export const useReportsTransport = (): ReportsTransport => use(ReportsTransportContext);

/**
 * What one read said. Only `reported` carries a report; `pending`, `not-record-only`, `missing` (no such child under this root), `unreadable` (held but not readable, or no answer)
 * and `unavailable` (the read is not served) each mean something else.
 */
export type ReportView =
  | { readonly tag: "reading" }
  | { readonly tag: "reported"; readonly report: ChildReportValue }
  | { readonly tag: "pending" }
  | { readonly tag: "not-record-only" }
  | { readonly tag: "missing"; readonly detail?: string }
  | { readonly tag: "unreadable"; readonly reason: string }
  | { readonly tag: "unavailable"; readonly reason: string }
  | { readonly tag: "refused"; readonly code: string; readonly detail?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isReport = (value: unknown): value is ChildReportValue =>
  isRecord(value) &&
  typeof value.text === "string" &&
  typeof value.status === "string" &&
  typeof value.route === "number";

const NOT_A_REPORT = "the Backend's answer was not a report";

/** One transport answer as one view. A detail is kept exactly as the Backend sent it; an answer this build cannot read is `unreadable`, never missing or empty. */
export function reportViewFromReply(reply: unknown): ReportView {
  if (!isRecord(reply) || typeof reply.ok !== "boolean") {
    return { tag: "unreadable", reason: NOT_A_REPORT };
  }
  if (reply.ok) {
    const value = reply.value;
    if (!isRecord(value)) return { tag: "unreadable", reason: NOT_A_REPORT };
    if (value.state === "pending") return { tag: "pending" };
    if (value.state === "not-record-only") return { tag: "not-record-only" };
    if (value.state === "reported" && isReport(value.report)) {
      return { tag: "reported", report: value.report };
    }
    return { tag: "unreadable", reason: NOT_A_REPORT };
  }
  const code = typeof reply.code === "string" ? reply.code : "";
  const detail = typeof reply.detail === "string" ? reply.detail : undefined;
  const kept = detail === undefined ? {} : { detail };
  if (code === "CHILD_NOT_OWNED" || code === "CHILDREN_NOT_FOUND")
    return { tag: "missing", ...kept };
  if (code === "CHILDREN_UNAVAILABLE") {
    return { tag: "unavailable", reason: detail ?? "The Backend could not take the request." };
  }
  if (code === "ORCHESTRATION_UNAVAILABLE" || code === "CHILDREN_OUTCOME_UNKNOWN") {
    return { tag: "unreadable", reason: detail ?? "the Backend could not read the report" };
  }
  return { tag: "refused", code, ...kept };
}

interface Entry {
  readonly ticket: number;
  readonly view: ReportView;
}
/** The last answer per (root, child) and the newest read's ticket; the only copy a view keeps. */
export interface ReportsState {
  readonly counter: number;
  readonly entries: Readonly<Record<string, Entry>>;
}
export const initialReports: ReportsState = { counter: 0, entries: {} };

const keyOf = (rootThreadId: string, target: string): string => `${rootThreadId}\u0000${target}`;

export function startReport(
  state: ReportsState,
  rootThreadId: string,
  target: string,
): { readonly state: ReportsState; readonly ticket: number } {
  const ticket = state.counter + 1;
  return {
    ticket,
    state: {
      counter: ticket,
      entries: {
        ...state.entries,
        [keyOf(rootThreadId, target)]: { ticket, view: { tag: "reading" } },
      },
    },
  };
}

/** A reply for an older read of the same child changes nothing. */
export function finishReport(
  state: ReportsState,
  rootThreadId: string,
  target: string,
  ticket: number,
  view: ReportView,
): ReportsState {
  const key = keyOf(rootThreadId, target);
  if (state.entries[key]?.ticket !== ticket) return state;
  return { ...state, entries: { ...state.entries, [key]: { ticket, view } } };
}

export const reportViewOf = (
  state: ReportsState,
  rootThreadId: string,
  target: string,
): ReportView | undefined => state.entries[keyOf(rootThreadId, target)]?.view;

/** Structured data as indented JSON; data that cannot be written out is said so rather than dropped. */
export function structuredText(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2);
    if (text !== undefined) return text;
  } catch {
    // Falls through to the statement below.
  }
  return "The structured data could not be shown.";
}
