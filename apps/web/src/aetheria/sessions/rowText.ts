import type { TreeRow } from "./types";

const STATE_WORDS = {
  "needs-you": "Needs you",
  working: "Working",
  ongoing: "Ongoing",
  dormant: "Idle",
} as const;

/**
 * The row's second-line status: the tag when it has one, otherwise the state word. A state that
 * rests on a fact the backend has not supplied is "State unknown", never "Idle". A pending request
 * and a running thread are known whatever else is hidden, and keep their words.
 */
export function rowStatusText(row: TreeRow): string {
  const base =
    row.tag ??
    (!row.stateKnown && (row.state === "dormant" || row.state === "ongoing")
      ? "State unknown"
      : STATE_WORDS[row.state]);
  return row.snoozed ? `${base} · snoozed` : base;
}

/** A compact age: now, minutes, hours or days; never negative. */
export function ageText(timestamp: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
