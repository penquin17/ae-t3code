// AETHERIA M10 step 23 (D17, D19, R3, XC-19) — the declared region registry's client contracts: the region DESCRIPTOR (what a view declares), `aetheria.regions.report` (the client says which of its declared regions are
// mounted and visible, as a WHOLE replacement with a rising sequence) and `aetheria.regions.read` (what the Backend holds for this connection's own client). The Backend binds the principal to the authenticated
// connection and observes the viewed thread from T3's own `subscribeThread`: a payload has no field for a principal, a session, a viewed session or a value, and a strict decode refuses one. Values never reach
// the Backend at all — a region's props and state are read from the page only when M11's client responder queries it (the web registry's `query`). Imports nothing from `@t3tools/contracts` (see rpc.ts).
import * as Schema from "effect/Schema";

/** The one descriptor version this contract carries. A descriptor of another version decodes (a number) so the Backend can refuse it with `REGIONS_SCHEMA_UNSUPPORTED` instead of failing to decode. */
export const REGIONS_SCHEMA_VERSION = 1;
/** Regions one client may hold at once. */
export const REGIONS_MAX_REGIONS = 64;
/** Props, or state fields, one descriptor may declare; and likewise its tokens. */
export const REGIONS_MAX_FIELDS = 32;
export const REGIONS_MAX_TOKENS = 32;
export const REGIONS_MAX_DESCRIPTION = 200;
/** Clients one principal may hold at once, clients in all, and threads one connection may be observed viewing. */
export const REGIONS_MAX_CLIENTS_PER_PRINCIPAL = 8;
export const REGIONS_MAX_CLIENTS = 256;
export const REGIONS_MAX_VIEWING = 16;
/** One report is at most this many bytes of UTF-8 JSON; a larger body is `REGIONS_TOO_LARGE`. */
export const REGIONS_MAX_BODY_BYTES = 65_536;
/** Calls one connection may make in a burst, and how many it earns back each second. */
export const REGIONS_RATE_BURST = 20;
export const REGIONS_RATE_PER_SECOND = 5;

const REGION_KINDS = ["screen", "panel", "region", "control-group"] as const;
const REGION_FIELD_TYPES = ["string", "number", "boolean", "null", "array", "object"] as const;

/** The Backend's codes, with M12's class per code. A report replaces the whole set, so a lost reply is repeated safely: there is no unknown-outcome code. */
export const REGIONS_CODE_CLASSES = {
  REGIONS_NOT_AUTHORIZED: "refusal",
  REGIONS_DEVICE_REVOKED: "refusal",
  /** The client id is bound to another connection or principal, or this connection already reports a different client id. */
  REGIONS_CLIENT_CONFLICT: "refusal",
  REGIONS_SCHEMA_UNSUPPORTED: "refusal",
  /** The sequence is not above the one the Backend holds for this client: nothing was changed. */
  REGIONS_STALE: "refusal",
  REGIONS_TOO_LARGE: "refusal",
  /** The Backend's own judgement of a report the schema admitted, such as a region id that repeats. */
  REGIONS_INVALID_REPORT: "refusal",
  REGIONS_RATE_LIMITED: "refusal",
  REGIONS_UNAVAILABLE: "failure",
} as const;
export type RegionsCode = keyof typeof REGIONS_CODE_CLASSES;

const RegionId = Schema.String.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/),
);
const OwnerId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9._-]{0,63}$/));
const FieldName = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]{0,63}$/));
const TokenName = Schema.String.check(Schema.isPattern(/^--[a-z][a-z0-9-]{0,63}$/));
const ClientId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{16,128}$/));
const ThreadKey = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const PositiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));

/** One declared prop or state field: its name, its type, and whether a query reports its value or only its shape. */
const RegionField = Schema.Struct({
  name: FieldName,
  type: Schema.Literals(REGION_FIELD_TYPES),
  report: Schema.Literals(["value", "shape"]),
});

const uniqueNames = Schema.makeFilter<ReadonlyArray<{ name: string }>>(
  (fields) => new Set(fields.map((f) => f.name)).size === fields.length || "a field name repeats",
);
const Fields = Schema.Array(RegionField).check(Schema.isMaxLength(REGIONS_MAX_FIELDS), uniqueNames);
const Tokens = Schema.Array(TokenName).check(
  Schema.isMaxLength(REGIONS_MAX_TOKENS),
  Schema.makeFilter<ReadonlyArray<string>>(
    (names) => new Set(names).size === names.length || "a token name repeats",
  ),
);

/** A region as a view declares it: a stable dotted id, its kind and owning module, its parent (or null), a plain description and its declared props, state and token names. Nothing here carries a value. */
export const RegionDescriptor = Schema.Struct({
  id: RegionId,
  kind: Schema.Literals(REGION_KINDS),
  owner: OwnerId,
  parent: Schema.NullOr(RegionId),
  description: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(REGIONS_MAX_DESCRIPTION),
  ),
  schemaVersion: PositiveInt,
  props: Fields,
  state: Fields,
  tokens: Tokens,
}).check(
  Schema.makeFilter<{ id: string; parent: string | null }>(
    (d) => d.parent !== d.id || "a region cannot be its own parent",
  ),
);
export type RegionDescriptor = typeof RegionDescriptor.Type;

const MountedRegion = Schema.Struct({ descriptor: RegionDescriptor, visible: Schema.Boolean });

/**
 * The whole set of regions this client has mounted, replacing the last report. The sequence rises on every call; the Backend refuses one that does not. No principal, session or value is a field: the
 * Backend takes the principal from the connection and the viewed thread from the connection's own `subscribeThread`.
 */
export const RegionsReportPayload = Schema.Struct({
  clientId: ClientId,
  sequence: PositiveInt,
  regions: Schema.Array(MountedRegion).check(
    Schema.isMaxLength(REGIONS_MAX_REGIONS),
    Schema.makeFilter<ReadonlyArray<{ descriptor: { id: string } }>>(
      (regions) =>
        new Set(regions.map((r) => r.descriptor.id)).size === regions.length ||
        "a region id repeats",
    ),
  ),
});
export type RegionsReportPayload = typeof RegionsReportPayload.Type;

const Failure = Schema.Struct({
  ok: Schema.Literal(false),
  code: Schema.Literals(Object.keys(REGIONS_CODE_CLASSES) as [RegionsCode, ...RegionsCode[]]),
  detail: Schema.optionalKey(Schema.String),
});

const Viewing = Schema.Array(ThreadKey).check(Schema.isMaxLength(REGIONS_MAX_VIEWING));

/** What the Backend now holds: the client, the confirmed sequence, each region's id and visibility, and the threads this connection is observed viewing. */
export const RegionsReportResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.Struct({
      clientId: ClientId,
      sequence: PositiveInt,
      regions: Schema.Array(Schema.Struct({ id: RegionId, visible: Schema.Boolean })),
      viewing: Viewing,
    }),
  }),
  Failure,
]);
export type RegionsReportResult = typeof RegionsReportResult.Type;

/**
 * The read takes nothing: the Backend reads this connection's own client. An empty `Schema.Struct({})` passes any key through whole even under `onExcessProperty: "error"` (Effect 4.1 builds no key check for a struct with
 * no fields), so the exactness is the check: the decoded value has no own key at all.
 */
export const RegionsReadPayload = Schema.Struct({}).check(
  Schema.makeFilter<object>(
    (payload) => Reflect.ownKeys(payload).length === 0 || "the read takes no field",
  ),
);
export type RegionsReadPayload = typeof RegionsReadPayload.Type;

/** This connection's own client as stored, or a known none (nothing reported yet). Another connection's client is never returned. */
export const RegionsReadResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.Struct({
      client: Schema.NullOr(
        Schema.Struct({
          clientId: ClientId,
          sequence: PositiveInt,
          regions: Schema.Array(
            Schema.Struct({
              id: RegionId,
              kind: Schema.Literals(REGION_KINDS),
              owner: OwnerId,
              parent: Schema.NullOr(RegionId),
              schemaVersion: PositiveInt,
              visible: Schema.Boolean,
            }),
          ),
          viewing: Viewing,
        }),
      ),
    }),
  }),
  Failure,
]);
export type RegionsReadResult = typeof RegionsReadResult.Type;
