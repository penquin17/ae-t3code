// How the workflow calls' replies are read (M07 Plan step 29). A reply is the Backend's `{ok:true,value}` or `{ok:false,code,detail?}`; the value is decoded with the contract's own schema (excess fields
// refused, so a run that carried a script, an argument or child output is not shown), and a reply that does not decode is unknown, never an empty list. Failure classes follow the contract:
// `WORKFLOWS_UNAVAILABLE` means nothing was done; `WORKFLOWS_OUTCOME_UNKNOWN` (a cancel that did not finish) and a reply that never came mean the effect may have landed, so the caller reads and never resends;
// every other code (not authorized, device revoked, not found) is a refusal. Plain TypeScript over the contract; no DOM, no T3.
import {
  WorkflowCancelResult,
  WorkflowRunsResult,
  type WorkflowRunView,
} from "@t3tools/aetheria-contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { TransportResult } from "../types";

export type { WorkflowRunView };

const strict = { onExcessProperty: "error" } as const;
const decodeRuns = Schema.decodeUnknownOption(WorkflowRunsResult as never, strict) as (
  input: unknown,
) => Option.Option<{
  readonly ok: true;
  readonly value: {
    readonly runs: readonly WorkflowRunView[];
    readonly version: number;
    readonly unreadable?: number;
  };
}>;
const decodeCancel = Schema.decodeUnknownOption(WorkflowCancelResult as never, strict) as (
  input: unknown,
) => Option.Option<{ readonly ok: true; readonly value: { readonly run: WorkflowRunView } }>;

export type FailureKind = "unavailable" | "unknown" | "refused";

export interface WorkflowFailure {
  readonly tag: "failed";
  readonly kind: FailureKind;
  readonly reason: string;
  readonly code?: string;
}

/** One runs read: a decoded list, or why there is none. A failure of any kind is a failed read, never "no runs". */
export type RunsRead =
  | {
      readonly tag: "ok";
      readonly runs: readonly WorkflowRunView[];
      readonly version: number;
      /** How many run records could not be read; above zero the list is not claimed complete. */
      readonly unreadable: number;
    }
  | WorkflowFailure;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const NOT_A_REPLY = "the Backend's answer was not a reply this view can read";
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

type Raw =
  | { readonly tag: "reply"; readonly reply: Record<string, unknown> }
  | { readonly tag: "failure"; readonly failure: WorkflowFailure };

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
function failureOf(reply: Record<string, unknown>): WorkflowFailure {
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

export function classifyRuns(result: TransportResult): RunsRead {
  const raw = rawOf(result);
  if (raw.tag === "failure") return raw.failure;
  if (raw.reply.ok !== true) return failureOf(raw.reply);
  const decoded = decodeRuns(raw.reply);
  if (Option.isNone(decoded)) {
    return {
      tag: "failed",
      kind: "unknown",
      reason: "the Backend's runs were not in the shape this view reads",
    };
  }
  const { runs, version, unreadable } = decoded.value.value;
  return { tag: "ok", runs, version, unreadable: unreadable ?? 0 };
}

/** What a `workflow.cancel` reply says, in the four ways it can end. */
export type CancelReply =
  | { readonly tag: "accepted"; readonly run: WorkflowRunView }
  | { readonly tag: "unknown"; readonly reason: string }
  | { readonly tag: "unavailable"; readonly reason: string }
  | { readonly tag: "refused"; readonly code: string; readonly detail?: string };

export function classifyCancel(result: TransportResult): CancelReply {
  const raw = rawOf(result);
  if (raw.tag === "failure") {
    const { failure } = raw;
    return failure.kind === "refused"
      ? { tag: "refused", code: failure.code ?? "COMMAND_FAILED", detail: failure.reason }
      : { tag: "unknown", reason: failure.reason };
  }
  if (raw.reply.ok === true) {
    const decoded = decodeCancel(raw.reply);
    return Option.isNone(decoded)
      ? {
          tag: "unknown",
          reason:
            "the Backend accepted the cancel but its run was not in the shape this view reads",
        }
      : { tag: "accepted", run: decoded.value.value.run };
  }
  const failure = failureOf(raw.reply);
  if (failure.kind === "unavailable") return { tag: "unavailable", reason: failure.reason };
  if (failure.kind === "unknown") return { tag: "unknown", reason: failure.reason };
  const detail = text(raw.reply.detail);
  return {
    tag: "refused",
    code: failure.code ?? "UNKNOWN",
    ...(detail === undefined ? {} : { detail }),
  };
}
