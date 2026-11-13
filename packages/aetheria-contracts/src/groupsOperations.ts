// AETHERIA M10 step 7 (D3, D4, R3, XC-22) — `aetheria.groups.read` and `aetheria.groups.apply` on the Backend's one session-group store (DSH's version-2 record; `apply` carries the
// five-operation union in ONE body). Payloads name sessions and a name, never an actor or scope. The schema fixes the shape; value rules (8 KiB, name length, pair ids) are the Backend's coded refusals.
// A reply is the confirmed record or `{ok:false,code,detail?}`; GROUPS_OUTCOME_UNKNOWN means a write may have landed, so a client re-reads and never resends.
// Imports nothing from `@t3tools/contracts` (see rpc.ts).
import * as Schema from "effect/Schema";

/** One request body is at most this many bytes of UTF-8 JSON (DSH's route cap, carried; never raised). A 200-id rename fits only when its ids are short. */
export const GROUPS_MAX_BODY_BYTES = 8192;
/** A rename lists at most this many ids before they are sorted and de-duplicated. */
export const GROUPS_MAX_RENAME_MEMBERS = 200;
/** Longest session id the store accepts: ids are opaque, so only a sanity bound. */
export const GROUPS_MAX_ID_LENGTH = 512;
/** Longest group name, in UTF-16 code units, after trimming. */
export const GROUPS_MAX_NAME_LENGTH = 80;

/** The Backend's codes, with M12's class per code. `GROUPS_REQUEST_TOO_LARGE` and `GROUPS_INVALID_REQUEST` are the Backend's own judgement of a body the schema admitted. */
export const GROUPS_CODE_CLASSES = {
  GROUPS_INVALID_REQUEST: "refusal",
  GROUPS_REQUEST_TOO_LARGE: "refusal",
  GROUPS_NOT_AUTHORIZED: "refusal",
  GROUPS_DEVICE_REVOKED: "refusal",
  GROUPS_SESSION_NOT_FOUND: "absence",
  GROUPS_STORE_UNUSABLE: "failure",
  GROUPS_UNAVAILABLE: "failure",
  GROUPS_OUTCOME_UNKNOWN: "failure",
} as const;
export type GroupsCode = keyof typeof GROUPS_CODE_CLASSES;

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(GROUPS_MAX_ID_LENGTH));
const Time = Schema.Number.check(Schema.isFinite());

export const GroupsReadPayload = Schema.Struct({});
export type GroupsReadPayload = typeof GroupsReadPayload.Type;

/** group / ungroup / dismiss one unordered pair. */
const PairOp = Schema.Struct({
  op: Schema.Literals(["group", "ungroup", "dismiss"]),
  a: Id,
  b: Id,
});
/** Remove every confirmed link that touches `a`. */
const DetachOp = Schema.Struct({ op: Schema.Literal("detach"), a: Id });
/** Name the group whose sessions are `members`; an empty name clears. */
const RenameOp = Schema.Struct({
  op: Schema.Literal("rename"),
  members: Schema.Array(Id).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(GROUPS_MAX_RENAME_MEMBERS),
  ),
  name: Schema.String,
});
export const GroupsApplyPayload = Schema.Union([PairOp, DetachOp, RenameOp]);
export type GroupsApplyPayload = typeof GroupsApplyPayload.Type;

/** The confirmed record, version 2 only: another version, an unknown key and an unnormalised shape are not on the wire, so a reader never repairs. */
const GroupedLink = Schema.Struct({ a: Id, b: Id, kind: Schema.Literal("grouped"), at: Time });
const DismissedPair = Schema.Struct({ a: Id, b: Id, at: Time });
const GroupName = Schema.Struct({
  members: Schema.Array(Id).check(Schema.isMinLength(2)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(GROUPS_MAX_NAME_LENGTH)),
  at: Time,
});
export const GroupsRecord = Schema.Struct({
  version: Schema.Literal(2),
  links: Schema.Array(GroupedLink),
  dismissed: Schema.Array(DismissedPair),
  names: Schema.Array(GroupName),
});
export type GroupsRecord = typeof GroupsRecord.Type;

const Failure = Schema.Struct({
  ok: Schema.Literal(false),
  code: Schema.Literals(Object.keys(GROUPS_CODE_CLASSES) as GroupsCode[]),
  detail: Schema.optionalKey(Schema.String),
});
const reply = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: GroupsRecord }),
  Failure,
]);

export const GroupsReadResult = reply;
export type GroupsReadResult = typeof GroupsReadResult.Type;
export const GroupsApplyResult = reply;
export type GroupsApplyResult = typeof GroupsApplyResult.Type;
