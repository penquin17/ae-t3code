// AETHERIA M10 step 18 (D14, D20, XC-11) — `aetheria.usage.read`: the providers' usage readings and the route availability of one root's children, read from M09 through the Backend's running service.
// The payload names a root thread only. Wherever a value can be missing the reply keeps the answers apart: read, could not be read (with a reason) and, for a route, none or unknown. A reading or state that
// failed is `unavailable`, never a window at 0 percent; the main thread's own route is `not-supplied` (the Backend does not supply it), never guessed. Imports nothing from `@t3tools/contracts` (see rpc.ts).
import * as Schema from "effect/Schema";

import { RouteState, UsageReading } from "./providersOperations.ts";

/** The Backend's own codes, with M12's class per code. A read has no unknown outcome. */
export const USAGE_CODE_CLASSES = {
  USAGE_NOT_AUTHORIZED: "refusal",
  USAGE_DEVICE_REVOKED: "refusal",
  USAGE_NOT_FOUND: "absence",
  USAGE_UNAVAILABLE: "failure",
} as const;
export type UsageCode = keyof typeof USAGE_CODE_CLASSES;

/** What the page says of the main thread's own route: the Backend supplies a route for a role child only. */
export const USAGE_MAIN_ROUTE_TEXT = "not supplied by the Backend";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Text = Schema.String.check(Schema.isMinLength(1));
const PositiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));

export const ClientUsageReadPayload = Schema.Struct({ rootThreadId: Id });
export type ClientUsageReadPayload = typeof ClientUsageReadPayload.Type;

/** The providers' readings (each `ok`, `stale` or `unavailable` as M09 supplies it), or why none could be read. An empty list is a known empty, not a failure. */
const UsageSection = Schema.Union([
  Schema.Struct({ status: Schema.Literal("read"), readings: Schema.Array(UsageReading) }),
  Schema.Struct({ status: Schema.Literal("unavailable"), detail: Text }),
]);

const MainRoute = Schema.Struct({
  threadId: Id,
  route: Schema.Struct({ status: Schema.Literal("not-supplied") }),
});

/** A child's route as M05's `currentRoute` says it, in Pi's vocabulary (provider, bare model): known, none recorded, or unknown with M05's reason. */
const ChildRoute = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("known"),
    index: PositiveInt,
    provider: Text,
    model: Text,
    effort: Schema.optionalKey(Text),
  }),
  Schema.Struct({ status: Schema.Literal("none") }),
  Schema.Struct({ status: Schema.Literal("unknown"), detail: Text }),
]);

/** M09's `routeStates(…, 'display')` answer for a known route, or why it could not be had. */
const ChildAvailability = Schema.Union([
  Schema.Struct({ status: Schema.Literal("read"), state: RouteState }),
  Schema.Struct({ status: Schema.Literal("unavailable"), detail: Text }),
]);

const ChildRow = Schema.Struct({
  childThreadId: Id,
  route: ChildRoute,
  /** Present only for a known route; none and unknown have nothing to ask about. */
  availability: Schema.optionalKey(ChildAvailability),
}).check(
  Schema.makeFilter<{ route: { status: string }; availability?: unknown }>(
    (row) =>
      row.availability === undefined ||
      row.route.status === "known" ||
      "only a known route has an availability",
  ),
);

const ChildrenSection = Schema.Union([
  Schema.Struct({ status: Schema.Literal("listed"), rows: Schema.Array(ChildRow) }),
  Schema.Struct({ status: Schema.Literal("unavailable"), detail: Text }),
]);

const Failure = Schema.Struct({
  ok: Schema.Literal(false),
  code: Schema.Literals(Object.keys(USAGE_CODE_CLASSES) as [UsageCode, ...UsageCode[]]),
  detail: Schema.optionalKey(Schema.String),
});

export const ClientUsageReadResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.Struct({
      rootThreadId: Id,
      usage: UsageSection,
      main: MainRoute,
      children: ChildrenSection,
    }),
  }),
  Failure,
]);
export type ClientUsageReadResult = typeof ClientUsageReadResult.Type;
