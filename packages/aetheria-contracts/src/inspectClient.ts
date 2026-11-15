// M11 step 19 (C5, C6; D5, D6, D8–D11; B3): `aetheria.inspect.requests` (Backend → the one page viewing the requesting thread) and `aetheria.inspect.reply` (the page's answer), under `orchestration:read`.
// No browser-initiated list or query; a reply only settles a request the Backend still waits on. No payload names a principal, session, thread, actor or client: the connection and the XC-6 caller supply them.
// Strict at the wire (`onExcessProperty: "error"`); the requests payload is exact-empty. Imports nothing from `@t3tools/contracts` (see rpc.ts).
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

export const INSPECT_CLIENT_METHODS = {
  requests: "aetheria.inspect.requests",
  reply: "aetheria.inspect.reply",
} as const;

/** Codes of a refused reply, with M12's class per code. A subscription that is refused ends empty instead (a stream carries no code). */
export const INSPECT_CLIENT_CODE_CLASSES = {
  INSPECT_CLIENT_NOT_AUTHORIZED: "refusal",
  INSPECT_CLIENT_DEVICE_REVOKED: "refusal",
  INSPECT_CLIENT_UNAVAILABLE: "failure",
} as const;
export type InspectClientCode = keyof typeof INSPECT_CLIENT_CODE_CLASSES;

/** The same spelling as a declared region id (regionsOperations.ts); this package's test holds the two together. */
const RegionId = Schema.String.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/),
);
const RequestId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/));
const PositiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));

/** The subscription takes nothing (see regionsOperations `RegionsReadPayload`: an empty struct passes any key, so the exactness is the check). */
export const InspectRequestsPayload = Schema.Struct({}).check(
  Schema.makeFilter<object>(
    (payload) => Reflect.ownKeys(payload).length === 0 || "the subscription takes no field",
  ),
);
export type InspectRequestsPayload = typeof InspectRequestsPayload.Type;

/** One request to this page: the correlation id, the region, its descriptor version and the time left to answer. Nothing to call. */
export const InspectClientRequest = Schema.Struct({
  requestId: RequestId,
  regionId: RegionId,
  schemaVersion: PositiveInt,
  remainingMs: PositiveInt,
});
export type InspectClientRequest = typeof InspectClientRequest.Type;

/** The page's answer: its region's plain shape and values, or one of the three outcomes only the page can know. */
export const InspectReplyPayload = Schema.Union([
  Schema.Struct({
    requestId: RequestId,
    outcome: Schema.Literal("ok"),
    state: Schema.Literals(["active", "inactive"]),
    shape: Schema.Unknown,
    values: Schema.Record(Schema.String, Schema.Unknown),
  }),
  Schema.Struct({
    requestId: RequestId,
    outcome: Schema.Literals(["region-not-found", "schema-unsupported", "unavailable"]),
  }),
]);
export type InspectReplyPayload = typeof InspectReplyPayload.Type;

const Failure = Schema.Struct({
  ok: Schema.Literal(false),
  code: Schema.Literals(
    Object.keys(INSPECT_CLIENT_CODE_CLASSES) as [InspectClientCode, ...InspectClientCode[]],
  ),
  detail: Schema.optionalKey(Schema.String),
});

/** `accepted: false` says the reply settled nothing (no such waiting request, another connection's, or already settled) — never why. */
export const InspectReplyResult = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ accepted: Schema.Boolean }) }),
  Failure,
]);
export type InspectReplyResult = typeof InspectReplyResult.Type;

const STRICT_WIRE = { onExcessProperty: "error" } as const;
const AetheriaInspectRequestsRpc = Rpc.make(INSPECT_CLIENT_METHODS.requests, {
  payload: InspectRequestsPayload,
  success: InspectClientRequest,
  stream: true,
}).annotate(Rpc.ParseOptions, STRICT_WIRE);
const AetheriaInspectReplyRpc = Rpc.make(INSPECT_CLIENT_METHODS.reply, {
  payload: InspectReplyPayload,
  success: InspectReplyResult,
}).annotate(Rpc.ParseOptions, STRICT_WIRE);

/** The two methods, merged into the Aetheria group by rpc.ts. */
export const AetheriaInspectRpcGroup = RpcGroup.make(
  AetheriaInspectRequestsRpc,
  AetheriaInspectReplyRpc,
);
