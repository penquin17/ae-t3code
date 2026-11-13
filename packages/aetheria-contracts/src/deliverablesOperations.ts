// AETHERIA M10 step 13 (D9, D10, XC-6): `deliverables.declare` (args: requestId, path, optional title; session, root, turn and file facts are the Backend's) and
// `deliverables.attach-snapshot` (settles the as-delivered state once). Both are idempotent under their ids. `done {ok:false}` is a definite refusal; XC-6 `unavailable` records nothing known.
// Imports nothing from `@t3tools/contracts` (see rpc.ts).
import * as Schema from "effect/Schema";

export const DELIVERABLES_DECLARE_OPERATION = "deliverables.declare";
export const DELIVERABLES_ATTACH_SNAPSHOT_OPERATION = "deliverables.attach-snapshot";

/** The declaration store's `formatVersion` (XC-22): a top-level field readable without parsing the rest. A newer version is refused unread. */
export const DELIVERABLES_FORMAT_VERSION = 1;
export const DELIVERABLE_MAX_PATH_LENGTH = 4096;
export const DELIVERABLE_MAX_TITLE_LENGTH = 200;
const DELIVERABLE_MAX_REQUEST_ID_LENGTH = 128;

/** What kind of preview a card offers, derived by the Backend from the file's extension: a model cannot claim one. */
export const DELIVERABLE_KINDS = [
  "text",
  "markdown",
  "html",
  "pdf",
  "image",
  "audio",
  "video",
  "office",
  "other",
] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

/** Why no snapshot exists: the reasons `attachments.store-snapshot` and the Backend's own check can give. */
export const DELIVERABLE_SNAPSHOT_FAILURE_CODES = [
  "SNAPSHOT_CHANGED",
  "SNAPSHOT_NOT_REGULAR",
  "SNAPSHOT_TOO_LARGE",
  "ATTACHMENT_MISSING",
  "unavailable",
] as const;
export type DeliverableSnapshotFailureCode = (typeof DELIVERABLE_SNAPSHOT_FAILURE_CODES)[number];

/** A definite refusal of `deliverables.declare`: no declaration exists afterwards. */
export const DECLARE_FAILURE_CODES = [
  "DELIVERABLE_REQUEST_INVALID",
  "DELIVERABLE_NOT_FOUND",
  "DELIVERABLE_NOT_REGULAR",
  "DELIVERABLE_UNREADABLE",
  "DELIVERABLE_OUTSIDE_ROOT",
  "DELIVERABLE_CHANGED",
  "DELIVERABLE_TURN_UNKNOWN",
  "DELIVERABLE_REQUEST_CONFLICT",
  "DELIVERABLE_STORE_FULL",
] as const;
export type DeclareFailureCode = (typeof DECLARE_FAILURE_CODES)[number];

/** A definite refusal of `deliverables.attach-snapshot`: the declaration's snapshot state is unchanged. */
const ATTACH_FAILURE_CODES = [
  "DELIVERABLE_UNKNOWN",
  "DELIVERABLE_SNAPSHOT_MISSING",
  "DELIVERABLE_SNAPSHOT_MISMATCH",
  "DELIVERABLE_SNAPSHOT_CONFLICT",
] as const;
export type AttachFailureCode = (typeof ATTACH_FAILURE_CODES)[number];

/**
 * The XC-6 `unavailable` codes of either operation: the module is not running, or its store cannot be used. The store file is never repaired; a newer format is refused unread.
 * Identity that cannot be verified is the carrier's `unavailable`, not one of these.
 */
export const DECLARE_STORE_CODES = [
  "DELIVERABLES_NOT_RUNNING",
  "DELIVERABLES_STORE_UNUSABLE",
  "DELIVERABLES_FORMAT_NEWER",
] as const;
export type DeclareStoreCode = (typeof DECLARE_STORE_CODES)[number];

const RequestId = Schema.String.check(
  Schema.isPattern(new RegExp(`^[A-Za-z0-9._:-]{1,${DELIVERABLE_MAX_REQUEST_ID_LENGTH}}$`)),
);
const DeclarationId = Schema.String.check(Schema.isPattern(/^dlv_[0-9a-f]{32}$/));
const SnapshotId = Schema.String.check(Schema.isPattern(/^snap_[0-9a-f]{64}$/));
const Digest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
const Nat = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Text = Schema.String.check(Schema.isMinLength(1));

/** The path is a string the model supplies; whether it is absolute, regular, readable and inside the caller's root is the Backend's judgement, answered as a coded refusal. */
export const DeclareArgs = Schema.Struct({
  requestId: RequestId,
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(DELIVERABLE_MAX_PATH_LENGTH)),
  title: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(DELIVERABLE_MAX_TITLE_LENGTH)),
  ),
});
export type DeclareArgs = typeof DeclareArgs.Type;

export const AttachSnapshotArgs = Schema.Union([
  Schema.Struct({ declarationId: DeclarationId, snapshotId: SnapshotId }),
  Schema.Struct({
    declarationId: DeclarationId,
    unavailable: Schema.Literals(DELIVERABLE_SNAPSHOT_FAILURE_CODES),
  }),
]);
export type AttachSnapshotArgs = typeof AttachSnapshotArgs.Type;

/** The as-delivered state a declaration settles into, once: `pending` until `deliverables.attach-snapshot` settles it. */
export const DeliverableSnapshotState = Schema.Union([
  Schema.Struct({ state: Schema.Literal("pending") }),
  Schema.Struct({
    state: Schema.Literal("attached"),
    snapshotId: SnapshotId,
    digest: Digest,
    size: Nat,
  }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    code: Schema.Literals(DELIVERABLE_SNAPSHOT_FAILURE_CODES),
  }),
]);
export type DeliverableSnapshotState = typeof DeliverableSnapshotState.Type;

const Kind = Schema.Literals(DELIVERABLE_KINDS);

/** A declaration as the Agent sees it: its own facts, never the session or root. `canonicalPath` is a Backend path, used as a label. */
export const DeliverableView = Schema.Struct({
  id: DeclarationId,
  turnId: Text,
  canonicalPath: Text,
  title: Text,
  kind: Kind,
  size: Nat,
  digest: Digest,
  declaredAt: Schema.Number.check(Schema.isFinite()),
  snapshot: DeliverableSnapshotState,
});
export type DeliverableView = typeof DeliverableView.Type;

const Failure = <C extends readonly [string, ...string[]]>(codes: C) =>
  Schema.Struct({
    ok: Schema.Literal(false),
    code: Schema.Literals(codes),
    detail: Schema.optionalKey(Schema.String),
  });
const Success = Schema.Struct({
  ok: Schema.Literal(true),
  /** True when this request id (or this settled state) was already recorded: nothing was written. */
  replayed: Schema.Boolean,
  declaration: DeliverableView,
});

export const DeclareResult = Schema.Union([Success, Failure(DECLARE_FAILURE_CODES)]);
export type DeclareResult = typeof DeclareResult.Type;
export const AttachSnapshotResult = Schema.Union([Success, Failure(ATTACH_FAILURE_CODES)]);
export type AttachSnapshotResult = typeof AttachSnapshotResult.Type;

const strict = { onExcessProperty: "error" } as const;
const decodeDeclare = Schema.decodeUnknownSync(DeclareArgs, strict);
const decodeAttach = Schema.decodeUnknownSync(AttachSnapshotArgs, strict);

/** Decode a request's untrusted arguments; any extra key (a session, root, turn, kind, digest or actor among them) or wrong shape throws. */
export const decodeDeclareArgs = (args: unknown): DeclareArgs => decodeDeclare(args);
export const decodeAttachSnapshotArgs = (args: unknown): AttachSnapshotArgs => decodeAttach(args);

// The client read below is served by step 14; its shapes are fixed here.
/** The Backend's client-read codes, with M12's class per code. */
export const DELIVERABLES_CLIENT_CODE_CLASSES = {
  DELIVERABLES_NOT_AUTHORIZED: "refusal",
  DELIVERABLES_DEVICE_REVOKED: "refusal",
  DELIVERABLES_NOT_FOUND: "absence",
  DELIVERABLES_UNAVAILABLE: "failure",
  DELIVERABLES_STORE_UNUSABLE: "failure",
  DELIVERABLES_FORMAT_NEWER: "failure",
} as const;
export type DeliverablesClientCode = keyof typeof DELIVERABLES_CLIENT_CODE_CLASSES;

const ThreadId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

/** A thread id is all a client names; the Backend verifies the root is one the connection may reach and lists the declarations of every session under it. */
export const ClientDeliverablesListPayload = Schema.Struct({ rootThreadId: ThreadId });
export type ClientDeliverablesListPayload = typeof ClientDeliverablesListPayload.Type;

/** The as-delivered state a browser may see: the store's snapshot id is not a browser fact (a download names the declaration, and the Backend resolves the snapshot). */
export const DeliverableCardSnapshot = Schema.Union([
  Schema.Struct({ state: Schema.Literal("pending") }),
  Schema.Struct({ state: Schema.Literal("attached"), digest: Digest, size: Nat }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    code: Schema.Literals(DELIVERABLE_SNAPSHOT_FAILURE_CODES),
  }),
]);
export type DeliverableCardSnapshot = typeof DeliverableCardSnapshot.Type;

/**
 * One card. `threadId` is the thread of the declaring session, so a root's list reaches every child's delivery; `digest` is the digest at declaration, which a client compares with the
 * current file's digest to say "changed since delivered". `supersededBy` names the later declaration of the same file in the same session, or null.
 */
export const DeliverableCard = Schema.Struct({
  id: DeclarationId,
  threadId: ThreadId,
  turnId: Text,
  canonicalPath: Text,
  title: Text,
  kind: Kind,
  size: Nat,
  digest: Digest,
  declaredAt: Schema.Number.check(Schema.isFinite()),
  snapshot: DeliverableCardSnapshot,
  supersededBy: Schema.NullOr(DeclarationId),
});
export type DeliverableCard = typeof DeliverableCard.Type;

export const ClientDeliverablesListResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.Struct({
      rootThreadId: ThreadId,
      /** Oldest declaration first. */
      deliverables: Schema.Array(DeliverableCard),
    }),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    code: Schema.Literals(
      Object.keys(DELIVERABLES_CLIENT_CODE_CLASSES) as [
        DeliverablesClientCode,
        ...DeliverablesClientCode[],
      ],
    ),
    detail: Schema.optionalKey(Schema.String),
  }),
]);
export type ClientDeliverablesListResult = typeof ClientDeliverablesListResult.Type;
