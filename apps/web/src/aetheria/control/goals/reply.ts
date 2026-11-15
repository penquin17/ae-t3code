// How the goal calls' replies are read (M07 Plan step 18, D24, XC-23). A reply is the Backend's `{ok:true,value}` or `{ok:false,code,detail?,field?,current?}`; the value is decoded with the contract's own schema
// (excess fields refused, so a view that carried an origin id or any other unnamed field is not shown), and a reply that does not decode is unknown, never an empty goal. Failure classes follow the contract:
// `GOALS_UNAVAILABLE` means nothing was done; `GOALS_OUTCOME_UNKNOWN` (an action that threw) and a reply that never came mean the effect may have landed, so the caller reads and never resends;
// `GOAL_STALE_REVISION` carries the goal's current view. Plain TypeScript over the contract; no DOM, no T3.
import { GoalSnapshotResult, GoalView } from "@t3tools/aetheria-contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { TransportResult } from "../types";

const strict = { onExcessProperty: "error" } as const;
const decodeSnapshot = Schema.decodeUnknownOption(GoalSnapshotResult as never, strict) as (
  input: unknown,
) => Option.Option<{ readonly ok: true; readonly value: SnapshotValue }>;
const decodeView = Schema.decodeUnknownOption(GoalView as never, strict) as (
  input: unknown,
) => Option.Option<GoalView>;

export type { GoalView };
export interface SnapshotValue {
  readonly goal: GoalView | null;
  readonly version: number;
}

export type FailureKind = "unavailable" | "unknown" | "refused";

/** One goal snapshot read: a decoded value, or why there is none. A failure of any kind is a failed read, never "no goal". */
export type GoalRead =
  | { readonly tag: "ok"; readonly goal: GoalView | null; readonly version: number }
  | {
      readonly tag: "failed";
      readonly kind: FailureKind;
      readonly reason: string;
      readonly code?: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const NOT_A_REPLY = "the Backend's answer was not a reply this view can read";
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** A settled transport result as the Backend's reply, or the failure that stands in for one. */
type Raw =
  | { readonly tag: "reply"; readonly reply: Record<string, unknown> }
  | { readonly tag: "failure"; readonly failure: Extract<GoalRead, { tag: "failed" }> };

function rawOf(result: TransportResult): Raw {
  if (result.tag === "lost") {
    return {
      tag: "failure",
      failure: { tag: "failed", kind: "unknown", reason: "the reply never arrived" },
    };
  }
  if (result.tag === "failed") {
    return {
      tag: "failure",
      failure: { tag: "failed", kind: "refused", reason: result.message, code: "COMMAND_FAILED" },
    };
  }
  if (!isRecord(result.reply) || typeof result.reply.ok !== "boolean") {
    return { tag: "failure", failure: { tag: "failed", kind: "unknown", reason: NOT_A_REPLY } };
  }
  return { tag: "reply", reply: result.reply };
}

/** The class a coded failure belongs to, by the contract's code names. */
function failureOf(reply: Record<string, unknown>): Extract<GoalRead, { tag: "failed" }> {
  const code = text(reply.code);
  const detail = text(reply.detail);
  if (code === undefined) return { tag: "failed", kind: "unknown", reason: NOT_A_REPLY };
  if (code.endsWith("_UNAVAILABLE")) {
    return {
      tag: "failed",
      kind: "unavailable",
      reason: detail ?? "The Backend could not take the request.",
      code,
    };
  }
  if (code.endsWith("_OUTCOME_UNKNOWN")) {
    return {
      tag: "failed",
      kind: "unknown",
      reason: detail ?? "The Backend did not say what happened.",
      code,
    };
  }
  return { tag: "failed", kind: "refused", reason: detail ?? code, code };
}

export function classifySnapshot(result: TransportResult): GoalRead {
  const raw = rawOf(result);
  if (raw.tag === "failure") return raw.failure;
  if (raw.reply.ok !== true) return failureOf(raw.reply);
  const decoded = decodeSnapshot(raw.reply);
  if (Option.isNone(decoded)) {
    return {
      tag: "failed",
      kind: "unknown",
      reason: "the Backend's goal was not in the shape this view reads",
    };
  }
  return { tag: "ok", goal: decoded.value.value.goal, version: decoded.value.value.version };
}

/** What a `goal.rearm` reply says, in the five ways it can end. */
export type RearmReply =
  | { readonly tag: "accepted"; readonly goal: GoalView }
  | {
      readonly tag: "stale";
      readonly detail?: string;
      /** The goal's current view, when the Backend supplied one and it decodes. */
      readonly current?: GoalView | null;
    }
  | { readonly tag: "unknown"; readonly reason: string }
  | { readonly tag: "unavailable"; readonly reason: string }
  | {
      readonly tag: "refused";
      readonly code: string;
      readonly detail?: string;
      readonly field?: string;
    };

export function classifyRearm(result: TransportResult): RearmReply {
  const raw = rawOf(result);
  if (raw.tag === "failure") {
    const { failure } = raw;
    return failure.kind === "refused"
      ? { tag: "refused", code: failure.code ?? "COMMAND_FAILED", detail: failure.reason }
      : { tag: "unknown", reason: failure.reason };
  }
  const { reply } = raw;
  if (reply.ok === true) {
    const value = isRecord(reply.value) ? reply.value : null;
    const goal: Option.Option<GoalView> = value === null ? Option.none() : decodeView(value.goal);
    if (Option.isNone(goal) || Object.keys(value ?? {}).length !== 1) {
      return {
        tag: "unknown",
        reason: "the Backend accepted the Re-arm but its goal was not in the shape this view reads",
      };
    }
    return { tag: "accepted", goal: goal.value };
  }
  const code = text(reply.code);
  const detail = text(reply.detail);
  if (code === "GOAL_STALE_REVISION") {
    const current =
      reply.current === null
        ? null
        : reply.current === undefined
          ? undefined
          : Option.getOrUndefined(decodeView(reply.current));
    return {
      tag: "stale",
      ...(detail === undefined ? {} : { detail }),
      ...(current === undefined ? {} : { current }),
    };
  }
  const failure = failureOf(reply);
  if (failure.kind === "unavailable") return { tag: "unavailable", reason: failure.reason };
  if (failure.kind === "unknown") return { tag: "unknown", reason: failure.reason };
  const field = text(reply.field);
  return {
    tag: "refused",
    code: failure.code ?? "UNKNOWN",
    ...(detail === undefined ? {} : { detail }),
    ...(field === undefined ? {} : { field }),
  };
}
