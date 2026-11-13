// AETHERIA M05/M10 — the kind of a Pi session from M03's identity record, for a handler that must refuse a child named as a root (the thread index's `subagent` flag is never set for an
// M05 child). Boundary: `createSessionKind` over a FAKE reader returning M03's read statuses. It shows: an active child record is `child`; an active main record, an absent record and a retired
// one are `not-child` (nothing proves a child); a record that cannot be read, a pending or corrupt one, one that fails validation, and one filed under another session id are `unavailable`; a
// throwing reader is `unavailable`, never an exception. It does NOT show the real store or the handler (childrenControlRpc.aetheria.test.ts).
import { describe, expect, it } from "vite-plus/test";

import { createSessionKind } from "./sessionKind.ts";

const reader = (read: (id: string) => unknown) => ({ read }) as never;
const child = (sessionId: string) => ({
  sessionId,
  kind: "child",
  rootSessionId: "root-1",
  parentChain: ["root-1"],
  role: "reader",
  roleOrigin: "checkout",
  roleDigest: null,
  authoritySource: "role",
});
const main = (sessionId: string) => ({
  sessionId,
  kind: "main",
  rootSessionId: sessionId,
  parentChain: [],
  role: null,
  roleOrigin: null,
  roleDigest: null,
  authoritySource: "main",
});

describe("identityKind", () => {
  it("is child only for an active, valid child record of that session", () => {
    const kind = createSessionKind(reader((id) => ({ status: "active", record: child(id) })));
    expect(kind("s1")).toBe("child");
  });

  it("is not-child for a main record, an absent record and a retired one", () => {
    expect(createSessionKind(reader((id) => ({ status: "active", record: main(id) })))("s1")).toBe(
      "not-child",
    );
    expect(createSessionKind(reader(() => ({ status: "absent" })))("s1")).toBe("not-child");
    expect(createSessionKind(reader(() => ({ status: "retired" })))("s1")).toBe("not-child");
  });

  it("is unavailable for anything that cannot be trusted: pending, corrupt, invalid, another session's record, a throw", () => {
    for (const read of [
      () => ({ status: "pending" }),
      () => ({ status: "corrupt" }),
      () => ({ status: "unreadable" }),
      () => undefined,
      () => ({ status: "active", record: { sessionId: "s1", kind: "child" } }),
      (_id: string) => ({ status: "active", record: child("someone-else") }),
      () => {
        throw new Error("EIO");
      },
    ])
      expect(createSessionKind(reader(read))("s1")).toBe("unavailable");
  });
});
