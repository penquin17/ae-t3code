// AETHERIA M06 step 16 — session → root for grant and mode writes, over the REAL M03 reader and on-disk records (testkit).
// Shows: the root comes from the record; unknown or retired is absent; corrupt, misfiled, pending or a throwing reader is unavailable.
// Does not show the interaction service's use of the answer (the archive's own suite).
import { describe, expect, it } from "vite-plus/test";

import { createIdentityReader } from "./backendEntry.ts";
import { createSessionDirectory } from "./sessionDirectory.ts";
import { childRecord, mainRecord, rootOf, SESSION, SESSION_B, writeEnvelope } from "./testkit.ts";

const CHILD = "0197d3c0-3333-7000-8000-000000000003";
const OTHER = "0197d3c0-4444-7000-8000-000000000004";

describe("the session directory", () => {
  it("finds the root of a main session and of a child from its record, and nothing else", async () => {
    const stateRoot = rootOf();
    writeEnvelope(stateRoot, mainRecord(SESSION));
    writeEnvelope(stateRoot, childRecord(CHILD, SESSION, [SESSION]));
    const directory = createSessionDirectory(createIdentityReader({ stateRoot }));
    expect(await directory.lookup(SESSION)).toEqual({
      kind: "found",
      sessionId: SESSION,
      rootSessionId: SESSION,
    });
    expect(await directory.lookup(CHILD)).toEqual({
      kind: "found",
      sessionId: CHILD,
      rootSessionId: SESSION,
    });
  });

  it("calls an unknown or retired session absent, and an unreadable, misfiled or pending record unavailable", async () => {
    const stateRoot = rootOf();
    writeEnvelope(stateRoot, mainRecord(SESSION_B), { state: "retired" });
    writeEnvelope(stateRoot, mainRecord(OTHER), { raw: "not json" });
    writeEnvelope(stateRoot, mainRecord(CHILD), { fileStem: SESSION });
    const directory = createSessionDirectory(createIdentityReader({ stateRoot }));
    expect(await directory.lookup("0197d3c0-9999-7000-8000-000000000009")).toEqual({
      kind: "absent",
    });
    expect(await directory.lookup(SESSION_B)).toEqual({ kind: "absent" });
    expect(await directory.lookup(OTHER)).toMatchObject({ kind: "unavailable" });
    // A record filed under another session's name is invalid for that name.
    expect(await directory.lookup(SESSION)).toMatchObject({ kind: "unavailable" });
  });

  it("is unavailable when the reader throws", async () => {
    const directory = createSessionDirectory({
      read: () => {
        throw new Error("EIO");
      },
    } as never);
    expect(await directory.lookup(SESSION)).toEqual({
      kind: "unavailable",
      reason: "record-unreadable",
    });
  });
});
