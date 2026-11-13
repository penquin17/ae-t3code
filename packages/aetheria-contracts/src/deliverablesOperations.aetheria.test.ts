// AETHERIA M10 Plan step 13 (D9, D10, XC-5, XC-6, XC-22) — the strict contracts of the two deliverable operations `deliverables.declare` and `deliverables.attach-snapshot` and of the
// client read step 14 serves. The arguments carry no session, root, turn or actor (the carrier and the Backend bind those), and an extra key is refused.
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  AttachSnapshotArgs,
  AttachSnapshotResult,
  ClientDeliverablesListPayload,
  ClientDeliverablesListResult,
  DECLARE_FAILURE_CODES,
  DECLARE_STORE_CODES,
  DELIVERABLES_ATTACH_SNAPSHOT_OPERATION,
  DELIVERABLES_CLIENT_CODE_CLASSES,
  DELIVERABLES_DECLARE_OPERATION,
  DELIVERABLES_FORMAT_VERSION,
  DELIVERABLE_KINDS,
  DELIVERABLE_MAX_PATH_LENGTH,
  DELIVERABLE_MAX_TITLE_LENGTH,
  DeclareArgs,
  DeclareResult,
  XC6_OPERATION_NAME_PATTERN,
  decodeAttachSnapshotArgs,
  decodeDeclareArgs,
} from "./index.ts";

const strict = { onExcessProperty: "error" } as const;
const decode = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(schema as never, strict) as (input: unknown) => S["Type"];

const digest = `sha256:${"a".repeat(64)}`;
const snapshotId = `snap_${"b".repeat(64)}`;
const declarationId = `dlv_${"c".repeat(32)}`;

const view = {
  id: declarationId,
  turnId: "run-1",
  canonicalPath: "/work/report.md",
  title: "Report",
  kind: "markdown",
  size: 12,
  digest,
  declaredAt: 1700000000000,
  snapshot: { state: "pending" },
} as const;

describe("the deliverable operations", () => {
  it("names the two operations, both valid XC-6 names, and the store format", () => {
    expect(DELIVERABLES_DECLARE_OPERATION).toBe("deliverables.declare");
    expect(DELIVERABLES_ATTACH_SNAPSHOT_OPERATION).toBe("deliverables.attach-snapshot");
    for (const name of [DELIVERABLES_DECLARE_OPERATION, DELIVERABLES_ATTACH_SNAPSHOT_OPERATION])
      expect(XC6_OPERATION_NAME_PATTERN.test(name)).toBe(true);
    expect(DELIVERABLES_FORMAT_VERSION).toBe(1);
  });

  it("declare takes a request id, an absolute-path string and an optional title, and nothing else", () => {
    expect(decodeDeclareArgs({ requestId: "call-1", path: "/work/report.md" })).toEqual({
      requestId: "call-1",
      path: "/work/report.md",
    });
    expect(
      decodeDeclareArgs({ requestId: "call-1", path: "/work/report.md", title: "Report" }),
    ).toEqual({ requestId: "call-1", path: "/work/report.md", title: "Report" });
    // The session, the root, the turn, the kind, the digest and the actor are never the model's to claim.
    for (const extra of [
      { sessionId: "s" },
      { rootSessionId: "s" },
      { turnId: "t" },
      { kind: "pdf" },
      { digest },
      { size: 1 },
      { actor: "a" },
      { caller: { threadId: "t" } },
    ])
      expect(() =>
        decodeDeclareArgs({ requestId: "call-1", path: "/work/report.md", ...extra }),
      ).toThrow();
    expect(() => decodeDeclareArgs({ path: "/work/report.md" })).toThrow();
    expect(() => decodeDeclareArgs({ requestId: "call-1" })).toThrow();
    expect(DeclareArgs).toBeDefined();
  });

  it("bounds the request id, the path and the title", () => {
    const base = { requestId: "call-1", path: "/work/report.md" };
    for (const requestId of ["", "has space", "x".repeat(129), "a/b", "é"])
      expect(() => decodeDeclareArgs({ ...base, requestId })).toThrow();
    for (const requestId of ["a", "call-1", "toolu_01.A:b-c", "x".repeat(128)])
      expect(decodeDeclareArgs({ ...base, requestId }).requestId).toBe(requestId);
    expect(() => decodeDeclareArgs({ ...base, path: "" })).toThrow();
    expect(() =>
      decodeDeclareArgs({ ...base, path: `/${"a".repeat(DELIVERABLE_MAX_PATH_LENGTH)}` }),
    ).toThrow();
    expect(() => decodeDeclareArgs({ ...base, title: "" })).toThrow();
    expect(() =>
      decodeDeclareArgs({ ...base, title: "t".repeat(DELIVERABLE_MAX_TITLE_LENGTH + 1) }),
    ).toThrow();
    expect(
      decodeDeclareArgs({ ...base, title: "t".repeat(DELIVERABLE_MAX_TITLE_LENGTH) }).title,
    ).toHaveLength(DELIVERABLE_MAX_TITLE_LENGTH);
  });

  it("attach-snapshot takes the declaration and either the stored snapshot's id or the one reason none was stored", () => {
    expect(decodeAttachSnapshotArgs({ declarationId, snapshotId })).toEqual({
      declarationId,
      snapshotId,
    });
    for (const unavailable of [
      "SNAPSHOT_CHANGED",
      "SNAPSHOT_NOT_REGULAR",
      "SNAPSHOT_TOO_LARGE",
      "ATTACHMENT_MISSING",
      "unavailable",
    ])
      expect(decodeAttachSnapshotArgs({ declarationId, unavailable })).toEqual({
        declarationId,
        unavailable,
      });
    // Both, neither, an unknown reason, a malformed id, and any claimed identity are refused.
    expect(() =>
      decodeAttachSnapshotArgs({ declarationId, snapshotId, unavailable: "unavailable" }),
    ).toThrow();
    expect(() => decodeAttachSnapshotArgs({ declarationId })).toThrow();
    expect(() => decodeAttachSnapshotArgs({ declarationId, unavailable: "OTHER" })).toThrow();
    expect(() => decodeAttachSnapshotArgs({ declarationId, snapshotId: "snap_1" })).toThrow();
    expect(() => decodeAttachSnapshotArgs({ declarationId: "x", snapshotId })).toThrow();
    expect(() => decodeAttachSnapshotArgs({ declarationId, snapshotId, sessionId: "s" })).toThrow();
    expect(() => decodeAttachSnapshotArgs({ declarationId, snapshotId, digest })).toThrow();
    expect(AttachSnapshotArgs).toBeDefined();
  });

  it("declare answers the declaration it recorded, or one coded refusal", () => {
    const result = decode(DeclareResult);
    expect(result({ ok: true, replayed: false, declaration: view })).toBeDefined();
    expect(
      result({
        ok: true,
        replayed: true,
        declaration: {
          ...view,
          snapshot: { state: "attached", snapshotId, digest, size: 12 },
        },
      }),
    ).toBeDefined();
    expect(
      result({
        ok: true,
        replayed: false,
        declaration: { ...view, snapshot: { state: "unavailable", code: "SNAPSHOT_TOO_LARGE" } },
      }),
    ).toBeDefined();
    for (const code of DECLARE_FAILURE_CODES)
      expect(result({ ok: false, code, detail: "why" })).toBeDefined();
    expect(() => result({ ok: false, code: "OTHER" })).toThrow();
    // A reply never carries the caller's session or a root: only the declaration's own facts.
    expect(() =>
      result({ ok: true, replayed: false, declaration: { ...view, sessionId: "s" } }),
    ).toThrow();
    expect(() => result({ ok: true, declaration: view })).toThrow();
    expect(() =>
      result({ ok: true, replayed: false, declaration: { ...view, kind: "spreadsheet" } }),
    ).toThrow();
  });

  it("attach-snapshot answers the declaration with its settled snapshot state, or a coded refusal", () => {
    const result = decode(AttachSnapshotResult);
    expect(
      result({
        ok: true,
        replayed: false,
        declaration: { ...view, snapshot: { state: "attached", snapshotId, digest, size: 12 } },
      }),
    ).toBeDefined();
    for (const code of [
      "DELIVERABLE_UNKNOWN",
      "DELIVERABLE_SNAPSHOT_MISSING",
      "DELIVERABLE_SNAPSHOT_MISMATCH",
      "DELIVERABLE_SNAPSHOT_CONFLICT",
    ])
      expect(result({ ok: false, code })).toBeDefined();
    expect(() => result({ ok: false, code: "DELIVERABLE_NOT_FOUND" })).toThrow();
  });

  it("classes every code once: refusals, absence and failure, with the store codes only where a store can refuse", () => {
    expect(DELIVERABLE_KINDS).toEqual([
      "text",
      "markdown",
      "html",
      "pdf",
      "image",
      "audio",
      "video",
      "office",
      "other",
    ]);
    expect(new Set(DECLARE_FAILURE_CODES).size).toBe(DECLARE_FAILURE_CODES.length);
    // The store codes are XC-6 `unavailable` codes, never a `done` answer.
    expect(DECLARE_STORE_CODES).toEqual([
      "DELIVERABLES_NOT_RUNNING",
      "DELIVERABLES_STORE_UNUSABLE",
      "DELIVERABLES_FORMAT_NEWER",
    ]);
    for (const code of DECLARE_STORE_CODES)
      expect((DECLARE_FAILURE_CODES as readonly string[]).includes(code)).toBe(false);
  });
});

describe("the deliverable client read", () => {
  it("names a root thread only: no actor, scope, session or path", () => {
    expect(decode(ClientDeliverablesListPayload)({ rootThreadId: "thread-1" })).toEqual({
      rootThreadId: "thread-1",
    });
    expect(() => decode(ClientDeliverablesListPayload)({})).toThrow();
    expect(() =>
      decode(ClientDeliverablesListPayload)({ rootThreadId: "t", sessionId: "s" }),
    ).toThrow();
    expect(() =>
      decode(ClientDeliverablesListPayload)({ rootThreadId: "t", path: "/x" }),
    ).toThrow();
  });

  it("serves cards with a thread, the backend path as a label, a snapshot state with no snapshot id, and the declaration that superseded it", () => {
    const result = decode(ClientDeliverablesListResult);
    const card = {
      id: declarationId,
      threadId: "thread-1",
      turnId: "run-1",
      canonicalPath: "/work/report.md",
      title: "Report",
      kind: "markdown",
      size: 12,
      digest,
      declaredAt: 1700000000000,
      snapshot: { state: "attached", digest, size: 12 },
      supersededBy: null,
    };
    expect(
      result({ ok: true, value: { rootThreadId: "thread-1", deliverables: [card] } }),
    ).toBeDefined();
    expect(
      result({
        ok: true,
        value: {
          rootThreadId: "thread-1",
          deliverables: [{ ...card, snapshot: { state: "unavailable", code: "unavailable" } }],
        },
      }),
    ).toBeDefined();
    expect(
      result({
        ok: true,
        value: {
          rootThreadId: "thread-1",
          deliverables: [{ ...card, supersededBy: `dlv_${"d".repeat(32)}` }],
        },
      }),
    ).toBeDefined();
    // The store's snapshot id is not a browser fact.
    expect(() =>
      result({
        ok: true,
        value: {
          rootThreadId: "thread-1",
          deliverables: [
            { ...card, snapshot: { state: "attached", snapshotId, digest, size: 12 } },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      result({
        ok: true,
        value: { rootThreadId: "thread-1", deliverables: [{ ...card, sessionId: "s" }] },
      }),
    ).toThrow();
    for (const code of Object.keys(DELIVERABLES_CLIENT_CODE_CLASSES))
      expect(result({ ok: false, code })).toBeDefined();
    expect(() => result({ ok: false, code: "OTHER" })).toThrow();
  });

  it("classes the client codes", () => {
    expect(DELIVERABLES_CLIENT_CODE_CLASSES).toEqual({
      DELIVERABLES_NOT_AUTHORIZED: "refusal",
      DELIVERABLES_DEVICE_REVOKED: "refusal",
      DELIVERABLES_NOT_FOUND: "absence",
      DELIVERABLES_UNAVAILABLE: "failure",
      DELIVERABLES_STORE_UNUSABLE: "failure",
      DELIVERABLES_FORMAT_NEWER: "failure",
    });
  });
});
