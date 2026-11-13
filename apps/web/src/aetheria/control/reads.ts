// Single-value Backend reads (plan mode, tasks) and the sequencing of re-reads (D14, C7). Plain TypeScript.
import type { TransportResult } from "./types";

export type ReadResult<T> =
  | { readonly tag: "ok"; readonly value: T }
  | { readonly tag: "failed"; readonly reason: string; readonly code?: string };

/** A coded failure keeps the Backend's words, else its code; a read that did not come back is a failed read, never an empty value. */
export function classifyRead<T>(result: TransportResult): ReadResult<T> {
  if (result.tag === "lost")
    return { tag: "failed", reason: "the reply to the read never arrived" };
  if (result.tag === "failed") return { tag: "failed", reason: result.message };
  const reply = result.reply as {
    ok?: unknown;
    value?: T;
    code?: unknown;
    detail?: unknown;
  } | null;
  if (reply === null || typeof reply !== "object" || typeof reply.ok !== "boolean") {
    return { tag: "failed", reason: "the Backend's reply was not a reply" };
  }
  if (!reply.ok) {
    const code = typeof reply.code === "string" ? reply.code : "UNKNOWN";
    const detail = typeof reply.detail === "string" && reply.detail !== "" ? reply.detail : code;
    return { tag: "failed", reason: detail, code };
  }
  return "value" in reply && reply.value !== undefined
    ? { tag: "ok", value: reply.value }
    : { tag: "failed", reason: "the Backend's reply was not a reply" };
}

export type ReadState<T> =
  | { readonly status: "waiting" }
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "failed"; readonly reason: string; readonly last?: T };

export type ReadView<T> =
  | { readonly state: "unknown"; readonly reason: string }
  | { readonly state: "unavailable"; readonly reason: string }
  | {
      readonly state: "known";
      readonly value: T;
      readonly stale: boolean;
      readonly reason?: string;
    };

/** What a card may show: nothing before the first read; a value; the last value marked stale after a failed read; unavailable when there never was one. */
export function readView<T>(state: ReadState<T>): ReadView<T> {
  if (state.status === "waiting") {
    return { state: "unknown", reason: "waiting for the Backend's first read" };
  }
  if (state.status === "ok") return { state: "known", value: state.value, stale: false };
  return "last" in state && state.last !== undefined
    ? { state: "known", value: state.last, stale: true, reason: state.reason }
    : { state: "unavailable", reason: state.reason };
}

/** The next state after a read finished. */
export function afterRead<T>(previous: ReadState<T>, result: ReadResult<T>): ReadState<T> {
  if (result.tag === "ok") return { status: "ok", value: result.value };
  const last =
    previous.status === "ok"
      ? previous.value
      : previous.status === "failed"
        ? previous.last
        : undefined;
  return last === undefined
    ? { status: "failed", reason: result.reason }
    : { status: "failed", reason: result.reason, last };
}

/**
 * Serialises reads so one that starts after an action never shares a read that began before it. Idle: a call starts a read. While one runs: every call shares ONE further read that starts
 * when the running one ends. `run` must not reject (it reports failure as a value).
 */
export function createSequencedReader<T>(run: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  let queued: Promise<T> | null = null;
  const start = (): Promise<T> => {
    const mine = run();
    running = mine;
    void mine.then(() => {
      if (running === mine) running = null;
    });
    return mine;
  };
  return () => {
    if (running === null) return start();
    if (queued === null) {
      queued = running.then(() => {
        queued = null;
        return start();
      });
    }
    return queued;
  };
}
