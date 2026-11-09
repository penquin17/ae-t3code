// AETHERIA M09 step 21 — shared vectors for the `attachments.*` operations, decoded by the fork's strict schemas and by the Backend's argument
// decoders in the outer providers package (tests/providers/snapshots/vectors.test.mjs reads this file by path). `accept` must decode and `refuse`
// must not, in both. Data only, no imports; every value is synthetic.

export interface AttachmentVector {
  readonly name: string;
  readonly value: unknown;
}

export interface AttachmentVectorSet {
  readonly accept: readonly AttachmentVector[];
  readonly refuse: readonly AttachmentVector[];
}

const digest = `sha256:${"a".repeat(64)}`;
const snapshotId = `snap_${"a".repeat(64)}`;

export const attachmentVectors: Readonly<Record<string, AttachmentVectorSet>> = {
  storeArgs: {
    accept: [
      {
        name: "a path and a declared digest",
        value: { sourcePath: "/work/report.txt", declaredDigest: digest },
      },
      {
        name: "a path of 4096 characters",
        value: { sourcePath: `/${"p".repeat(4095)}`, declaredDigest: digest },
      },
    ],
    refuse: [
      { name: "digest missing", value: { sourcePath: "/work/report.txt" } },
      { name: "path missing", value: { declaredDigest: digest } },
      { name: "empty path", value: { sourcePath: "", declaredDigest: digest } },
      {
        name: "path over 4096 characters",
        value: { sourcePath: `/${"p".repeat(4096)}`, declaredDigest: digest },
      },
      { name: "path not a string", value: { sourcePath: 5, declaredDigest: digest } },
      {
        name: "digest without the algorithm prefix",
        value: { sourcePath: "/work/a", declaredDigest: "a".repeat(64) },
      },
      {
        name: "digest in capitals",
        value: { sourcePath: "/work/a", declaredDigest: `sha256:${"A".repeat(64)}` },
      },
      {
        name: "digest too short",
        value: { sourcePath: "/work/a", declaredDigest: `sha256:${"a".repeat(63)}` },
      },
      {
        name: "session id smuggled in",
        value: { sourcePath: "/work/a", declaredDigest: digest, sessionId: "s1" },
      },
      {
        name: "a snapshot id is a describe field",
        value: { sourcePath: "/work/a", declaredDigest: digest, snapshotId },
      },
      { name: "not an object", value: "/work/a" },
    ],
  },
  describeArgs: {
    accept: [{ name: "a snapshot id", value: { snapshotId } }],
    refuse: [
      { name: "snapshot id missing", value: {} },
      { name: "a digest where an id belongs", value: { snapshotId: digest } },
      { name: "snapshot id in capitals", value: { snapshotId: `snap_${"A".repeat(64)}` } },
      { name: "snapshot id too short", value: { snapshotId: `snap_${"a".repeat(63)}` } },
      { name: "snapshot id not a string", value: { snapshotId: 3 } },
      { name: "session id smuggled in", value: { snapshotId, sessionId: "s1" } },
      { name: "a path is a store field", value: { snapshotId, sourcePath: "/work/a" } },
      { name: "not an object", value: null },
    ],
  },
  snapshotResult: {
    accept: [
      { name: "stored", value: { ok: true, snapshotId, digest, size: 12 } },
      { name: "an empty file", value: { ok: true, snapshotId, digest, size: 0 } },
      { name: "changed", value: { ok: false, code: "SNAPSHOT_CHANGED" } },
      { name: "not regular", value: { ok: false, code: "SNAPSHOT_NOT_REGULAR" } },
      { name: "too large", value: { ok: false, code: "SNAPSHOT_TOO_LARGE" } },
      { name: "missing", value: { ok: false, code: "ATTACHMENT_MISSING" } },
      { name: "unavailable", value: { ok: false, code: "unavailable" } },
    ],
    refuse: [
      { name: "ok without a size", value: { ok: true, snapshotId, digest } },
      { name: "ok with a negative size", value: { ok: true, snapshotId, digest, size: -1 } },
      { name: "ok with a fractional size", value: { ok: true, snapshotId, digest, size: 1.5 } },
      { name: "ok with a code", value: { ok: true, snapshotId, digest, size: 1, code: "x" } },
      {
        name: "ok with a path (bytes and paths never cross)",
        value: { ok: true, snapshotId, digest, size: 1, path: "/work/a" },
      },
      {
        name: "ok with a malformed id",
        value: { ok: true, snapshotId: "snap_x", digest, size: 1 },
      },
      { name: "refused without a code", value: { ok: false } },
      { name: "refused with an unknown code", value: { ok: false, code: "SNAPSHOT_MADE_UP" } },
      {
        name: "refused with a detail",
        value: { ok: false, code: "SNAPSHOT_CHANGED", detail: "x" },
      },
      { name: "no ok flag", value: { snapshotId, digest, size: 1 } },
    ],
  },
};
