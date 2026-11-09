// AETHERIA M09 — strict schemas for the four `providers.*` XC-6 operations (XC-11). Decode with `onExcessProperty: "error"`:
// the caller is the bearer's identity, so any caller, header or account field is refused, and no shape carries a credential.
// Answer shapes take an optional `label: "fixture"` that only FX-AV sets. The XC-6 envelope (xc6.ts) is unchanged.
import * as Schema from "effect/Schema";

export const PROVIDERS_ROUTE_STATES_OPERATION = "providers.route-states";
export const PROVIDERS_REPORT_FAILURE_OPERATION = "providers.report-failure";
export const PROVIDERS_ROUTE_CAPABILITIES_OPERATION = "providers.route-capabilities";
export const PROVIDERS_USAGE_OPERATION = "providers.usage";

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Iso = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/),
);
const NonNegativeInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

export const AetheriaRoute = Schema.Struct({ provider: Name, model: Name });
export type AetheriaRoute = typeof AetheriaRoute.Type;

export const RouteStatesArgs = Schema.Struct({
  routes: Schema.Array(AetheriaRoute),
  purpose: Schema.Literals(["launch", "switch", "display"]),
});
export type RouteStatesArgs = typeof RouteStatesArgs.Type;

const BasisEntry = Schema.Struct({
  signal: Schema.Literals(["memory", "credential", "window"]),
  result: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  at: Iso,
  windowId: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))),
});

/** FX-AV's mark (D15). Only the production-forbidden fixture sets it, on every answer it gives; the production service never emits it. */
const labelField = { label: Schema.optionalKey(Schema.Literal("fixture")) } as const;
const stateFields = { observedAt: Iso, basis: Schema.Array(BasisEntry), ...labelField } as const;
const stateOptional = {
  resetsAt: Schema.optionalKey(Iso),
  memoryEmptySince: Schema.optionalKey(Iso),
} as const;

/** The reason class fixes the state: a state/reason pair outside the design's table is not a value. */
export const RouteState = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("out"),
    reasonClass: Schema.Literals([
      "limit-remembered",
      "sign-in-remembered",
      "extra-usage-refused",
      "no-sign-in",
      "api-key-not-eligible",
      "usage-window-full",
    ]),
    ...stateFields,
    ...stateOptional,
  }),
  Schema.Struct({
    state: Schema.Literal("available"),
    reasonClass: Schema.Literals(["signed-in-window-ok", "signed-in-no-quota-reader"]),
    ...stateFields,
    ...stateOptional,
  }),
  Schema.Struct({
    state: Schema.Literal("unknown"),
    reasonClass: Schema.Literals(["no-signal", "read-late", "read-failed", "service-unavailable"]),
    ...stateFields,
    ...stateOptional,
  }),
  // After a restart the answer must say since when its memory has been empty.
  Schema.Struct({
    state: Schema.Literal("unknown"),
    reasonClass: Schema.Literal("restarted"),
    memoryEmptySince: Iso,
    resetsAt: Schema.optionalKey(Iso),
    ...stateFields,
  }),
]);
export type RouteState = typeof RouteState.Type;

export const RouteStatesResult = Schema.Struct({ states: Schema.Array(RouteState) });
export type RouteStatesResult = typeof RouteStatesResult.Type;

/** A failure as received (possibly redacted by the caller). Any field may be absent; an unclassifiable failure is `other`, not remembered. */
export const ReportFailureArgs = Schema.Struct({
  route: AetheriaRoute,
  failure: Schema.Struct({
    code: Schema.optionalKey(Name),
    status: Schema.optionalKey(Schema.Number.check(Schema.isInt())),
    message: Schema.optionalKey(Schema.String),
  }),
});
export type ReportFailureArgs = typeof ReportFailureArgs.Type;

/**
 * Class and remembered are always present. The expiry is present iff remembered; a reset only where one can be observed (limit, sign-in);
 * a wait hint only from limit text; R1's reason only on a limit. `limit` and `sign-in` are exactly the remembered classes.
 */
export const FailureReport = Schema.Union([
  Schema.Struct({
    class: Schema.Literal("limit"),
    remembered: Schema.Literal(true),
    rememberedUntil: Iso,
    resetsAt: Schema.optionalKey(Iso),
    waitHintMinutes: Schema.optionalKey(NonNegativeInt),
    reason: Schema.optionalKey(Schema.Literal("extra-usage-refused")),
    ...labelField,
  }),
  Schema.Struct({
    class: Schema.Literal("sign-in"),
    remembered: Schema.Literal(true),
    rememberedUntil: Iso,
    resetsAt: Schema.optionalKey(Iso),
    ...labelField,
  }),
  Schema.Struct({
    class: Schema.Literals(["struggling", "other"]),
    remembered: Schema.Literal(false),
    ...labelField,
  }),
]);
export type FailureReport = typeof FailureReport.Type;

export const RouteCapabilitiesArgs = Schema.Struct({ route: AetheriaRoute });
export type RouteCapabilitiesArgs = typeof RouteCapabilitiesArgs.Type;

/** Derived from the model catalog only. Without an entry nothing is claimed: both answers are unknown. */
export const RouteCapabilities = Schema.Union([
  Schema.Struct({
    route: AetheriaRoute,
    observedAt: Iso,
    images: Schema.Literal("unknown"),
    efforts: Schema.Struct({ state: Schema.Literal("unknown") }),
    source: Schema.Literal("none"),
    ...labelField,
  }),
  Schema.Struct({
    route: AetheriaRoute,
    observedAt: Iso,
    images: Schema.Literals(["yes", "no", "unknown"]),
    efforts: Schema.Union([
      Schema.Struct({
        state: Schema.Literal("known"),
        supported: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
        default: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
      }),
      Schema.Struct({ state: Schema.Literal("unknown") }),
    ]),
    source: Schema.Literal("catalog"),
    ...labelField,
  }),
]);
export type RouteCapabilities = typeof RouteCapabilities.Type;

export const UsageArgs = Schema.Struct({ provider: Schema.optionalKey(Name) });
export type UsageArgs = typeof UsageArgs.Type;

const UsageFailure = Schema.Literals([
  "no-credential",
  "auth",
  "timeout",
  "network",
  "malformed",
  "redirect",
  "unsupported",
  "reader-threw",
  "late",
]);
/** A window's percent is a real non-negative number or the word "unknown"; a missing or non-finite value is never 0. */
const UsageWindow = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  usedPercent: Schema.Union([
    Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
    Schema.Literal("unknown"),
  ]),
  resetsAt: Schema.optionalKey(Iso),
});
const usageCommon = { provider: Name, observedAt: Iso, fetchedAt: Iso, ...labelField } as const;

export const UsageReading = Schema.Union([
  Schema.Struct({
    ...usageCommon,
    status: Schema.Literal("ok"),
    stale: Schema.Literal(false),
    lastGoodAt: Iso,
    windows: Schema.Array(UsageWindow),
  }),
  Schema.Struct({
    ...usageCommon,
    status: Schema.Literal("stale"),
    stale: Schema.Literal(true),
    lastGoodAt: Iso,
    ageSeconds: NonNegativeInt,
    failure: UsageFailure,
    windows: Schema.Array(UsageWindow),
  }),
  Schema.Struct({
    ...usageCommon,
    status: Schema.Literal("unavailable"),
    stale: Schema.Literal(false),
    lastGoodAt: Schema.Null,
    failure: UsageFailure,
    windows: Schema.Tuple([]),
  }),
]);
export type UsageReading = typeof UsageReading.Type;

export const UsageResult = Schema.Struct({ readings: Schema.Array(UsageReading) });
export type UsageResult = typeof UsageResult.Type;
