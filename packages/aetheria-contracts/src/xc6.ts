// AETHERIA — XC-6, the Agent-to-Backend operations channel: the request/reply envelope and the in-process shape of an operation.
//
// Owners: this file owns the wire vocabulary (what a request may carry, which five replies exist). The transport owns bearer resolution,
// the identity port owns the thread-to-session binding, and each operation owns its meaning. Nothing here names a caller: identity is
// attached at the transport and is never a request field, so a request that names one is refused as an unknown key.
import * as Schema from "effect/Schema";

export const XC6_VERSION = 1;

/** One pattern for operation names, shared by the wire schema and every registration seam. */
export const XC6_OPERATION_NAME_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
export const Xc6OperationName = Schema.String.check(Schema.isPattern(XC6_OPERATION_NAME_PATTERN));

const Token = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Code = Schema.String.check(Schema.isMinLength(1));

/** A call names an operation and carries untrusted data; a poll carries only the token an earlier `pending` reply returned. */
export const Xc6Request = Schema.Union([
  Schema.Struct({
    v: Schema.Literal(XC6_VERSION),
    op: Xc6OperationName,
    args: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  Schema.Struct({ v: Schema.Literal(XC6_VERSION), poll: Token }),
]);
export type Xc6Request = typeof Xc6Request.Type;

/** The five explicit replies. `unavailable` is a result the caller must handle, never a silent success. */
export const Xc6Reply = Schema.Union([
  Schema.Struct({
    v: Schema.Literal(XC6_VERSION),
    status: Schema.Literal("done"),
    result: Schema.Unknown,
  }),
  Schema.Struct({
    v: Schema.Literal(XC6_VERSION),
    status: Schema.Literal("pending"),
    token: Token,
  }),
  Schema.Struct({
    v: Schema.Literal(XC6_VERSION),
    status: Schema.Literal("unavailable"),
    code: Code,
  }),
  Schema.Struct({ v: Schema.Literal(XC6_VERSION), status: Schema.Literal("refused"), code: Code }),
  Schema.Struct({ v: Schema.Literal(XC6_VERSION), status: Schema.Literal("error"), code: Code }),
]);
export type Xc6Reply = typeof Xc6Reply.Type;

/** What the transport proves about the caller (T3's provider-session scope). Never taken from a request. */
export interface Xc6Caller {
  readonly threadId: string;
  readonly providerSessionId: string;
  readonly providerInstanceId: string;
}

/** What an operation receives: the verified caller and the untrusted arguments, kept apart. */
export interface Xc6OperationContext {
  readonly caller: Xc6Caller;
  /** Verified against the identity port: the only session id an operation may treat as the caller. */
  readonly sessionId: string;
  readonly kind: string;
  readonly rootSessionId: string;
  /** Untrusted data. A session named here is a subject, never the caller. */
  readonly args: Readonly<Record<string, unknown>>;
}

/**
 * How an operation ends. `refused` is for a verified caller the operation itself may not serve (an M03 `AUTH_*` code), distinct from `unavailable`
 * (the Backend or its store cannot answer now) and from `done` (an answer, including evidence that says "unverified").
 */
export type Xc6Settled =
  | { readonly status: "done"; readonly result: unknown }
  | { readonly status: "unavailable"; readonly code: string }
  | { readonly status: "refused"; readonly code: string };

export type Xc6OperationResult =
  | Xc6Settled
  | { readonly status: "pending"; readonly settle: Promise<Xc6Settled> };

export type Xc6Operation = (
  context: Xc6OperationContext,
) => Xc6OperationResult | Promise<Xc6OperationResult>;
