// AETHERIA M09 step 12 — strict schemas for the `research.*` XC-6 operations (C4, D7, D9, R3). Decode with `onExcessProperty: "error"`:
// the caller is the bearer's identity, so a session id or poll token in the arguments is refused. The requestId is the operation-level
// cancel handle the thin tool mints; it is not the carrier's poll token, and a result never repeats it. The XC-6 envelope is unchanged.
import * as Schema from "effect/Schema";

export const RESEARCH_SEARCH_OPERATION = "research.search";
export const RESEARCH_FETCH_OPERATION = "research.fetch";
export const RESEARCH_CANCEL_OPERATION = "research.cancel";

/** The design's ten WEB_* codes plus two this step adds: a refusal of malformed arguments and of a live duplicate requestId. */
export const WEB_CODES = [
  "WEB_INVALID_URL",
  "WEB_BLOCKED_URL",
  "WEB_FETCH_TOO_LARGE",
  "WEB_FETCH_TIMEOUT",
  "WEB_REDIRECT_BLOCKED",
  "WEB_UNSUPPORTED_CONTENT_TYPE",
  "WEB_ABORTED",
  "WEB_PROVIDER_ERROR",
  "WEB_PROVIDER_CREDENTIAL_MISSING",
  "WEB_UNAVAILABLE",
  "WEB_INVALID_ARGUMENTS",
  "WEB_DUPLICATE_REQUEST",
] as const;

/** A refusal or failure carries any code except the two that name their own outcome kind. */
const WEB_REFUSAL_OR_FAILURE_CODES = WEB_CODES.filter(
  (code) => code !== "WEB_ABORTED" && code !== "WEB_UNAVAILABLE",
);

// 8 is the carried search result cap and 2048 the carried URL cap (parameters record); 2000 query characters is this step's bound.
export const ResearchRequestId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{16,64}$/));

export const ResearchSearchArgs = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  limit: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 8 })),
  requestId: ResearchRequestId,
});
export type ResearchSearchArgs = typeof ResearchSearchArgs.Type;

export const ResearchFetchArgs = Schema.Struct({
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  requestId: ResearchRequestId,
});
export type ResearchFetchArgs = typeof ResearchFetchArgs.Type;

export const ResearchCancelArgs = Schema.Struct({ requestId: ResearchRequestId });
export type ResearchCancelArgs = typeof ResearchCancelArgs.Type;

/** D9 as a result value inside `done`: only `ok` carries a value, and abort and unavailable can never read as an empty success. */
export const researchOutcome = <S extends Schema.Top>(value: S) =>
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("ok"), value }),
    Schema.Struct({
      kind: Schema.Literal("refused"),
      code: Schema.Literals(WEB_REFUSAL_OR_FAILURE_CODES),
    }),
    Schema.Struct({
      kind: Schema.Literal("failed"),
      class: Schema.Literals(WEB_REFUSAL_OR_FAILURE_CODES),
    }),
    Schema.Struct({ kind: Schema.Literal("aborted"), code: Schema.Literal("WEB_ABORTED") }),
    Schema.Struct({
      kind: Schema.Literal("unavailable"),
      code: Schema.Literal("WEB_UNAVAILABLE"),
      reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
    }),
  ]);

/** A valid cancel is always accepted, whether the id named live work, settled work or nothing: the answer reveals none of them. */
export const ResearchCancelResult = researchOutcome(
  Schema.Struct({ accepted: Schema.Literal(true) }),
);
export type ResearchCancelResult = typeof ResearchCancelResult.Type;
