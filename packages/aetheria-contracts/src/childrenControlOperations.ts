// AETHERIA M10 step 3 (R1, R3) — `aetheria.children.{cancelTree,list,interrupt,close}`. A payload names threads only, never an actor, user flag or scope.
// A reply is `{ok:true,value}` or `{ok:false,code,detail?}`: CHILDREN_UNAVAILABLE means nothing was done; CHILDREN_OUTCOME_UNKNOWN and M05's
// ORCHESTRATION_UNAVAILABLE mean it may have landed, so a client reads the projection and never resends. Imports nothing from `@t3tools/contracts` (see rpc.ts).
import * as Schema from "effect/Schema";

/** The Backend's own codes, with M12's class per code. */
export const CHILDREN_CONTROL_CODE_CLASSES = {
  CHILDREN_NOT_AUTHORIZED: "refusal",
  CHILDREN_DEVICE_REVOKED: "refusal",
  CHILDREN_NOT_FOUND: "absence",
  CHILDREN_UNAVAILABLE: "failure",
  CHILDREN_OUTCOME_UNKNOWN: "failure",
} as const;
export type ChildrenControlCode = keyof typeof CHILDREN_CONTROL_CODE_CLASSES;

/** M05's canonical codes these four operations can return, passed through unchanged with the service's detail. Any other code from M05 becomes `CHILDREN_OUTCOME_UNKNOWN`. */
export const CHILDREN_PASSTHROUGH_CODES = [
  "NOT_AUTHORIZED",
  "CHILD_NOT_OWNED",
  "CHILD_NOT_ADJACENT",
  "CHILD_NOT_RESUMABLE",
  "CHILD_DELIVERY_UNAVAILABLE",
  "CHILD_PARENT_UNAVAILABLE",
  "ORCHESTRATION_UNAVAILABLE",
] as const;
export type ChildrenPassthroughCode = (typeof CHILDREN_PASSTHROUGH_CODES)[number];

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Text = Schema.String.check(Schema.isMinLength(1));
const Nat = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const PositiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));

/** A thread id is the only thing a client names; the Backend verifies the root is one the connection may reach. */
export const ClientChildrenCancelTreePayload = Schema.Struct({ rootThreadId: Id });
export type ClientChildrenCancelTreePayload = typeof ClientChildrenCancelTreePayload.Type;
export const ClientChildrenListPayload = Schema.Struct({ rootThreadId: Id });
export type ClientChildrenListPayload = typeof ClientChildrenListPayload.Type;
export const ClientChildrenInterruptPayload = Schema.Struct({
  rootThreadId: Id,
  childThreadId: Id,
});
export type ClientChildrenInterruptPayload = typeof ClientChildrenInterruptPayload.Type;
export const ClientChildrenClosePayload = Schema.Struct({ rootThreadId: Id, childThreadId: Id });
export type ClientChildrenClosePayload = typeof ClientChildrenClosePayload.Type;

/** What M05's tree cancel did with one child. */
const CHILDREN_CANCEL_ACTIONS = [
  "interrupted",
  "closed",
  "left-idle",
  "left-closed",
  "failed",
  "unavailable",
] as const;
export type ChildrenCancelAction = (typeof CHILDREN_CANCEL_ACTIONS)[number];

/** One row per open descendant. `failed` and `unavailable` are not handled; the others are. */
const CancelRow = Schema.Struct({
  childId: Id,
  action: Schema.Literals(CHILDREN_CANCEL_ACTIONS),
  detail: Schema.optionalKey(Schema.String),
});
const CancelTreeValue = Schema.Struct({
  rootThreadId: Id,
  rows: Schema.Array(CancelRow),
  /** Whether T3 confirmed the root's stop. */
  rootStopped: Schema.Boolean,
  /** True only when every child was handled and the root stopped. */
  complete: Schema.Boolean,
});

const Mode = Schema.Literals(["one-shot", "continuable"]);
const SettleStatus = Schema.Literals(["completed", "failed", "interrupted"]);
const ChildRow = Schema.Struct({
  childId: Id,
  parentId: Id,
  depth: Nat,
  role: Schema.NullOr(Id),
  mode: Mode,
  label: Schema.optionalKey(Text),
  state: Schema.Literals(["running", "idle", "closed", "unknown"]),
  lastOutcome: Schema.NullOr(
    Schema.Struct({ status: SettleStatus, cause: Schema.optionalKey(Text) }),
  ),
  route: Schema.NullOr(PositiveInt),
});
const ChildDiagnostic = Schema.Struct({
  kind: Schema.Literals(["corrupt", "unsupported", "unavailable", "unregistered-fork"]),
  id: Id,
  detail: Schema.optionalKey(Text),
});
const ListValue = Schema.Struct({
  rows: Schema.Array(ChildRow),
  diagnostics: Schema.Array(ChildDiagnostic),
});

const Report = Schema.Struct({
  status: SettleStatus,
  cause: Schema.optionalKey(Text),
  text: Schema.String,
  structured: Schema.optionalKey(Schema.Unknown),
  route: PositiveInt,
});
const CloseValue = Schema.Struct({
  closed: Schema.Literal(true),
  report: Schema.optionalKey(Report),
  killedJobs: Schema.Array(Id),
});

const Failure = Schema.Struct({
  ok: Schema.Literal(false),
  code: Schema.Literals([
    ...(Object.keys(CHILDREN_CONTROL_CODE_CLASSES) as ChildrenControlCode[]),
    ...CHILDREN_PASSTHROUGH_CODES,
  ]),
  detail: Schema.optionalKey(Schema.String),
});
const reply = <S extends Schema.Top>(value: S) =>
  Schema.Union([Schema.Struct({ ok: Schema.Literal(true), value }), Failure]);

export const ClientChildrenCancelTreeResult = reply(CancelTreeValue);
export type ClientChildrenCancelTreeResult = typeof ClientChildrenCancelTreeResult.Type;
export const ClientChildrenListResult = reply(ListValue);
export type ClientChildrenListResult = typeof ClientChildrenListResult.Type;
export const ClientChildrenInterruptResult = reply(
  Schema.Struct({ accepted: Schema.Literal(true) }),
);
export type ClientChildrenInterruptResult = typeof ClientChildrenInterruptResult.Type;
export const ClientChildrenCloseResult = reply(CloseValue);
export type ClientChildrenCloseResult = typeof ClientChildrenCloseResult.Type;
