// AETHERIA M11 Plan step 6 (D3, D5, D10) — the strict wire shapes of read-only inspection: `inspect.list` and `inspect.query` requests, their results, and the XC-6 replies that
// carry them. They mirror the outer codecs of `@aetheria/inspect` and decode the same data-only vectors (inspectOperations.vectors.ts). Two operations exist; a request names no
// caller, session, root, thread, actor or composition (the bearer proves them) and a strict decode refuses one as an unknown key. A result outcome without data carries no payload;
// `truncated` says what is missing; an inspect exchange is `done`, `refused` or `unavailable` and never `pending`, `error` or a poll. Imports nothing from `@t3tools/contracts` (see rpc.ts).
import * as Schema from "effect/Schema";

const INSPECT_LIST_OPERATION = "inspect.list";
const INSPECT_QUERY_OPERATION = "inspect.query";
export const INSPECT_OPERATIONS = [INSPECT_LIST_OPERATION, INSPECT_QUERY_OPERATION] as const;

/** List page bound (P), and the bounds of the strings a request or result carries. */
const INSPECT_PAGE_LIMIT = 100;
const INSPECT_MAX_OFFSET = 10_000_000;
const INSPECT_MAX_CLIENTS = 64;

export const INSPECT_HOSTS = ["agent", "backend", "client"] as const;
export const INSPECT_STATES = ["active", "inactive", "unsupported", "failed", "absent"] as const;
export const INSPECT_OUTCOMES = [
  "ok",
  "no-client",
  "ambiguous",
  "disconnected",
  "timeout",
  "forbidden",
  "unavailable",
  "region-not-found",
  "schema-unsupported",
  "truncated",
] as const;
export const INSPECT_OMISSION_REASONS = ["secret", "not-allowed", "credential-store"] as const;

/** The inspector's own refusal and unavailable codes, with M12's class per code. M03's `AUTH_*` codes travel in a `refused` reply unchanged. */
export const INSPECT_CODE_CLASSES = {
  INSPECT_READONLY: "refusal",
  INSPECT_INVALID: "refusal",
  INSPECT_FORBIDDEN: "refusal",
  INSPECT_UNAVAILABLE: "unavailable",
  INSPECT_UNKNOWN_PROVIDER: "unavailable",
  INSPECT_PROVIDER_FAILED: "unavailable",
} as const;

const ProviderId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,47}$/));
const TargetId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/));
const Kind = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/));
const ClientId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{16,128}$/));
const Time = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/),
);
const Code = Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9_]{0,63}$/));
/** A dotted field path with optional `[n]` indexes: it can name a part of an exact shape and cannot be a call, an assignment or a command. */
const Selector = Schema.String.check(
  Schema.isMaxLength(256),
  Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_][A-Za-z0-9_-]*|\[\d{1,6}\])*$/),
);
const OmissionPath = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.[\]-]{1,200}$/));
const Nat = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Host = Schema.Literals(INSPECT_HOSTS);
const State = Schema.Literals(INSPECT_STATES);

export const InspectListArgs = Schema.Struct({
  providerId: Schema.optionalKey(ProviderId),
  host: Schema.optionalKey(Host),
  kind: Schema.optionalKey(Kind),
  offset: Schema.optionalKey(Nat.check(Schema.isLessThanOrEqualTo(INSPECT_MAX_OFFSET))),
  limit: Schema.optionalKey(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(INSPECT_PAGE_LIMIT),
    ),
  ),
});
export type InspectListArgs = typeof InspectListArgs.Type;

export const InspectQueryArgs = Schema.Struct({
  providerId: ProviderId,
  targetId: TargetId,
  selector: Schema.optionalKey(Selector),
  clientId: Schema.optionalKey(ClientId),
});
export type InspectQueryArgs = typeof InspectQueryArgs.Type;

const Truncation = Schema.Struct({
  capBytes: Nat.check(Schema.isGreaterThanOrEqualTo(1)),
  missing: Schema.Struct({ entries: Nat, bytes: Nat }),
});

/** `truncated` says what is missing, and a complete answer does not. */
const truncationMatchesOutcome = Schema.makeFilter<{
  outcome: string;
  truncation?: unknown;
}>(
  (r) =>
    (r.outcome === "truncated") === (r.truncation !== undefined) ||
    "truncation belongs to a truncated answer and to nothing else",
);

const ListEntry = Schema.Struct({
  providerId: ProviderId,
  targetId: TargetId,
  kind: Kind,
  host: Host,
  state: State,
  summary: Schema.String.check(Schema.isMaxLength(200)),
});

const listPageConsistent = Schema.makeFilter<{
  outcome: string;
  entries: ReadonlyArray<unknown>;
  offset: number;
  limit: number;
  nextOffset: number | null;
}>((r) => {
  if (r.entries.length > r.limit) return "more entries than the limit";
  if (
    r.nextOffset !== null &&
    (r.nextOffset !== r.offset + r.entries.length || r.nextOffset <= r.offset)
  )
    return "nextOffset does not follow the page";
  if (r.outcome === "truncated" && r.nextOffset === null)
    return "a truncated page needs a nextOffset";
  return true;
});

const ListData = Schema.Struct({
  outcome: Schema.Literals(["ok", "truncated"]),
  capturedAt: Time,
  entries: Schema.Array(ListEntry).check(Schema.isMaxLength(INSPECT_PAGE_LIMIT)),
  offset: Nat,
  limit: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(INSPECT_PAGE_LIMIT),
  ),
  total: Nat,
  nextOffset: Schema.NullOr(Nat),
  truncation: Schema.optionalKey(Truncation),
}).check(truncationMatchesOutcome, listPageConsistent);

const EmptyOutcome = Schema.Literals([
  "no-client",
  "ambiguous",
  "disconnected",
  "timeout",
  "forbidden",
  "unavailable",
  "region-not-found",
  "schema-unsupported",
]);
const ListEmpty = Schema.Struct({ outcome: EmptyOutcome, capturedAt: Time });

export const InspectListResult = Schema.Union([ListData, ListEmpty]);
export type InspectListResult = typeof InspectListResult.Type;

const Omission = Schema.Struct({
  path: OmissionPath,
  reason: Schema.Literals(INSPECT_OMISSION_REASONS),
});

const QueryData = Schema.Struct({
  outcome: Schema.Literals(["ok", "truncated"]),
  capturedAt: Time,
  providerId: ProviderId,
  targetId: TargetId,
  state: State,
  selector: Schema.optionalKey(Selector),
  clientId: Schema.optionalKey(ClientId),
  shape: Schema.Unknown,
  values: Schema.Record(Schema.String, Schema.Unknown),
  omitted: Schema.Array(Omission),
  truncation: Schema.optionalKey(Truncation),
}).check(truncationMatchesOutcome);

const QueryEmpty = Schema.Struct({
  outcome: Schema.Literals([
    "no-client",
    "disconnected",
    "timeout",
    "forbidden",
    "unavailable",
    "region-not-found",
    "schema-unsupported",
  ]),
  capturedAt: Time,
  providerId: ProviderId,
  targetId: TargetId,
});

/** Ambiguity names the clients by id and last-seen time only: never the thread, the principal or the page they view. */
const QueryAmbiguous = Schema.Struct({
  outcome: Schema.Literal("ambiguous"),
  capturedAt: Time,
  providerId: ProviderId,
  targetId: TargetId,
  clients: Schema.Array(Schema.Struct({ clientId: ClientId, lastSeen: Time })).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(INSPECT_MAX_CLIENTS),
  ),
});

export const InspectQueryResult = Schema.Union([QueryData, QueryEmpty, QueryAmbiguous]);
export type InspectQueryResult = typeof InspectQueryResult.Type;

/**
 * The XC-6 reply to an inspect call: `done` with a result, or `refused` or `unavailable` with a code. The Backend holds the call to its one deadline, so there is no `pending`,
 * no carrier `error` and no poll in this union. Which result a `done` carries follows the operation named, which the schema does not know: the outer codec checks it.
 */
export const InspectCarrierReply = Schema.Union([
  Schema.Struct({
    v: Schema.Literal(1),
    status: Schema.Literal("done"),
    result: Schema.Union([InspectListResult, InspectQueryResult]),
  }),
  Schema.Struct({ v: Schema.Literal(1), status: Schema.Literal("refused"), code: Code }),
  Schema.Struct({ v: Schema.Literal(1), status: Schema.Literal("unavailable"), code: Code }),
]);
export type InspectCarrierReply = typeof InspectCarrierReply.Type;
