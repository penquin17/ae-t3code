// AETHERIA — the XC-6 operations of the `awareness` tool and its summary: `awareness.action` (the nine DSH actions) and `awareness.summary`.
// The caller is the bearer's identity; a key naming a session is an invalid argument, not a caller. Expected rejections are `done` values
// `{ ok: false, code, message }`; unavailable replies name what is missing (the board, liveness, XC-10 for assign, XC-8 for resolve).
import * as Schema from "effect/Schema";

export const AWARENESS_ACTION_OPERATION = "awareness.action";
export const AWARENESS_SUMMARY_OPERATION = "awareness.summary";

/** Production `assign` needs the owned-child status of XC-10 (M05); unknown child status is unavailable too. */
export const XC10_CHILD_STATUS_UNAVAILABLE_CODE = "XC10_CHILD_STATUS_UNAVAILABLE";
/** Production `resolve` needs M06's durable verified-human evidence (XC-8). */
export const XC8_DECISION_EVIDENCE_UNAVAILABLE_CODE = "XC8_DECISION_EVIDENCE_UNAVAILABLE";

export const AWARENESS_ACTIONS = [
  "status",
  "goal",
  "claim",
  "assign",
  "release",
  "interface",
  "withdraw",
  "depend",
  "resolve",
] as const;

const Text = Schema.optionalKey(Schema.String);

/** The model's arguments. The Backend rejects any other key as `AWARENESS_INVALID`, so a caller id cannot be smuggled in. */
export const AwarenessActionArgs = Schema.Struct({
  action: Schema.Literals(AWARENESS_ACTIONS),
  path: Text,
  kind: Text,
  idea: Text,
  claimId: Text,
  agentId: Text,
  name: Text,
  signature: Text,
  notes: Text,
  text: Text,
  interface: Text,
  decision: Text,
  answer: Text,
  askCallId: Text,
});
export type AwarenessActionArgs = typeof AwarenessActionArgs.Type;

/** DSH's result value: `{ ok: true, ... }` or `{ ok: false, code, message, field? }`. */
export const AwarenessActionResult = Schema.Record(Schema.String, Schema.Unknown);
export type AwarenessActionResult = typeof AwarenessActionResult.Type;

/** The bounded summary this session has not yet received: `text` is null when nothing is new. `bytes` is its UTF-8 size (cap 2048, least 512). */
export const AwarenessSummaryResult = Schema.Struct({
  text: Schema.NullOr(Schema.String),
  revision: Schema.Number,
  bytes: Schema.Number,
});
export type AwarenessSummaryResult = typeof AwarenessSummaryResult.Type;
