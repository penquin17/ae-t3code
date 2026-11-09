// AETHERIA M09 step 21 — strict schemas for the `attachments.*` XC-6 operations (C9, D16 as refined by R7). Decode with `onExcessProperty: "error"`:
// the caller is the bearer's identity, so a session id in the arguments is refused. Bytes and paths never come back: a snapshot is named by its id and
// described by its digest and size; M10 serves the bytes in process. The XC-6 envelope is unchanged.
import * as Schema from "effect/Schema";

export const SNAPSHOT_STORE_OPERATION = "attachments.store-snapshot";
export const SNAPSHOT_DESCRIBE_OPERATION = "attachments.describe-snapshot";

const Digest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
const SnapshotId = Schema.String.check(Schema.isPattern(/^snap_[0-9a-f]{64}$/));

export const SnapshotStoreArgs = Schema.Struct({
  sourcePath: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  declaredDigest: Digest,
});
export type SnapshotStoreArgs = typeof SnapshotStoreArgs.Type;

export const SnapshotDescribeArgs = Schema.Struct({ snapshotId: SnapshotId });
export type SnapshotDescribeArgs = typeof SnapshotDescribeArgs.Type;

/** What both operations answer inside `done`: the stored snapshot's metadata, or the one refusal or failure code. */
export const SnapshotResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    snapshotId: SnapshotId,
    digest: Digest,
    size: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    code: Schema.Literals([
      "SNAPSHOT_CHANGED",
      "SNAPSHOT_NOT_REGULAR",
      "SNAPSHOT_TOO_LARGE",
      "ATTACHMENT_MISSING",
      "unavailable",
    ]),
  }),
]);
export type SnapshotResult = typeof SnapshotResult.Type;
