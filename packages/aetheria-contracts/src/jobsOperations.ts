// AETHERIA M10 step 18 (D14, D20, XC-15, XC-16) — `aetheria.jobs.{list,output,outbox.list,kill}`: a root's jobs, one job's output read at explicit offsets, the root's completion-outbox rows and the user's kill.
// A payload names a root thread (and a job, and offsets) only, never an actor, user flag or scope. A reply is `{ok:true,value}` or `{ok:false,code,detail?}`: JOBS_UNAVAILABLE means nothing was
// done (and a read found nothing); JOBS_OUTCOME_UNKNOWN (a kill that threw) and M05's ORCHESTRATION_UNAVAILABLE mean the effect may have landed, so a client reads the list and never resends.
// The output read never moves the agent's cursor and never waits; the outbox list never acknowledges anything. Imports nothing from `@t3tools/contracts` (see rpc.ts).
import * as Schema from "effect/Schema";

import { JobRow, JobsKillValue, JobsOutputValue } from "./orchestrationOperations.ts";

/** The Backend's own codes, with M12's class per code. */
export const JOBS_CONTROL_CODE_CLASSES = {
  JOBS_NOT_AUTHORIZED: "refusal",
  JOBS_DEVICE_REVOKED: "refusal",
  JOBS_NOT_FOUND: "absence",
  JOBS_UNAVAILABLE: "failure",
  JOBS_OUTCOME_UNKNOWN: "failure",
} as const;
export type JobsControlCode = keyof typeof JOBS_CONTROL_CODE_CLASSES;

/** M05's canonical codes these four calls can return, passed through unchanged with the service's detail. Any other code from M05 becomes `JOBS_OUTCOME_UNKNOWN` (kill) or `JOBS_UNAVAILABLE` (reads). */
export const JOBS_PASSTHROUGH_CODES = [
  "NOT_AUTHORIZED",
  "JOB_NOT_FOUND",
  "JOB_CONFLICT",
  "JOB_IDENTITY_MISMATCH",
  "ORCHESTRATION_UNAVAILABLE",
] as const;
export type JobsPassthroughCode = (typeof JOBS_PASSTHROUGH_CODES)[number];

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Nat = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

export const ClientJobsListPayload = Schema.Struct({ rootThreadId: Id });
export type ClientJobsListPayload = typeof ClientJobsListPayload.Type;
export const ClientJobsOutboxListPayload = Schema.Struct({ rootThreadId: Id });
export type ClientJobsOutboxListPayload = typeof ClientJobsOutboxListPayload.Type;
export const ClientJobsKillPayload = Schema.Struct({ rootThreadId: Id, jobId: Id });
export type ClientJobsKillPayload = typeof ClientJobsKillPayload.Type;

/** Where each stream's read starts, in bytes. Both are explicit: the browser holds its own position and the agent's cursor is never involved. */
export const ClientJobsOutputPayload = Schema.Struct({
  rootThreadId: Id,
  jobId: Id,
  offsets: Schema.Struct({ stdout: Nat, stderr: Nat }),
});
export type ClientJobsOutputPayload = typeof ClientJobsOutputPayload.Type;

const OUTBOX_KINDS = [
  "job-completion",
  "job-lost",
  "restart-notice",
  "route-notice",
  "goal-round",
  "goal-notice",
  "child-report",
] as const;
const OUTBOX_STATES = ["pending", "attempting", "inserted", "recorded", "abandoned"] as const;
const OUTBOX_DELIVERIES = [...OUTBOX_STATES, "delivery-uncertain"] as const;

/** One completion-outbox entry as M05's list shows it: the notice's key and kind, its stored state, its delivery (an unsettled outcome is `delivery-uncertain`, never plain pending) and its attempts. No text, message or session. */
export const OutboxRow = Schema.Struct({
  key: Id,
  kind: Schema.Literals(OUTBOX_KINDS),
  state: Schema.Literals(OUTBOX_STATES),
  delivery: Schema.Literals(OUTBOX_DELIVERIES),
  attempts: Nat,
  uncertainSince: Schema.NullOr(Nat),
  nextAttemptAt: Schema.NullOr(Nat),
});
export type OutboxRow = typeof OutboxRow.Type;

const Failure = Schema.Struct({
  ok: Schema.Literal(false),
  code: Schema.Literals([
    ...(Object.keys(JOBS_CONTROL_CODE_CLASSES) as JobsControlCode[]),
    ...JOBS_PASSTHROUGH_CODES,
  ]),
  detail: Schema.optionalKey(Schema.String),
});
const reply = <S extends Schema.Top>(value: S) =>
  Schema.Union([Schema.Struct({ ok: Schema.Literal(true), value }), Failure]);

/**
 * `unreadable` is M05's count of records it could not read: above zero, the list may miss a job or a notice of this root and is NOT complete, so it travels to the client instead of being
 * hidden. Optional so a reply that omits it reads as zero.
 */
export const ClientJobsListResult = reply(
  Schema.Struct({ jobs: Schema.Array(JobRow), unreadable: Schema.optionalKey(Nat) }),
);
export type ClientJobsListResult = typeof ClientJobsListResult.Type;

/** A chunk of one stream as the user's read shows it: where it lies, whether bytes remain after `to`, and the stream's size at the read. */
const ClientOutputChunk = Schema.Struct({
  stream: Schema.Literals(["stdout", "stderr"]),
  from: Nat,
  to: Nat,
  text: Schema.String,
  truncated: Schema.Boolean,
  size: Nat,
}).check(
  Schema.makeFilter<{ from: number; to: number }>(
    (chunk) => chunk.to >= chunk.from || "a chunk's end is not before its start",
  ),
);
/** The user's output value: M05's agent value without a wait (the user's read never waits), and with each stream's size. */
export const ClientJobsOutputValue = Schema.Struct({
  jobId: Id,
  state: JobsOutputValue.fields.state,
  streams: Schema.Array(ClientOutputChunk).check(
    Schema.makeFilter<ReadonlyArray<{ stream: string }>>(
      (chunks) =>
        new Set(chunks.map((chunk) => chunk.stream)).size === chunks.length ||
        "one chunk per stream",
    ),
  ),
  exit: JobsOutputValue.fields.exit,
  livenessIndeterminate: JobsOutputValue.fields.livenessIndeterminate,
  terminationUnconfirmed: JobsOutputValue.fields.terminationUnconfirmed,
});
export type ClientJobsOutputValue = typeof ClientJobsOutputValue.Type;
export const ClientJobsOutputResult = reply(ClientJobsOutputValue);
export type ClientJobsOutputResult = typeof ClientJobsOutputResult.Type;
export const ClientJobsOutboxListResult = reply(
  Schema.Struct({ rows: Schema.Array(OutboxRow), unreadable: Schema.optionalKey(Nat) }),
);
export type ClientJobsOutboxListResult = typeof ClientJobsOutboxListResult.Type;
export const ClientJobsKillResult = reply(JobsKillValue);
export type ClientJobsKillResult = typeof ClientJobsKillResult.Type;
