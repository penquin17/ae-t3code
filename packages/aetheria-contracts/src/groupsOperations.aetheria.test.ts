// AETHERIA M10 Plan step 7 (D3, D4, R3, XC-22): the strict client contracts for the Backend's session-group store — one read and one apply whose body is DSH's five-operation union. A payload
// names sessions and a name; it carries no actor, scope or root. A reply is the confirmed version-2 record or a coded refusal; GROUPS_UNAVAILABLE means nothing was done and GROUPS_OUTCOME_UNKNOWN
// means a write may have landed, so a client re-reads and never resends.
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  AETHERIA_WS_METHODS,
  AetheriaGroupsRpcGroup,
  AetheriaRpcGroup,
  GROUPS_CODE_CLASSES,
  GROUPS_MAX_BODY_BYTES,
  GROUPS_MAX_ID_LENGTH,
  GROUPS_MAX_NAME_LENGTH,
  GROUPS_MAX_RENAME_MEMBERS,
  GroupsApplyPayload,
  GroupsApplyResult,
  GroupsReadPayload,
  GroupsReadResult,
} from "./index.ts";

const strict = { onExcessProperty: "error" } as const;
const decode = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(schema as never, strict) as (input: unknown) => S["Type"];

const record = {
  version: 2,
  links: [{ a: "a", b: "b", kind: "grouped", at: 1 }],
  dismissed: [{ a: "a", b: "c", at: 2 }],
  names: [{ members: ["a", "b"], name: "Plans", at: 3 }],
} as const;

describe("the session-group client methods", () => {
  it("adds aetheria.groups.read and aetheria.groups.apply to the joined group, in method order", () => {
    expect(AETHERIA_WS_METHODS).toMatchObject({
      groupsRead: "aetheria.groups.read",
      groupsApply: "aetheria.groups.apply",
    });
    expect([...AetheriaGroupsRpcGroup.requests.keys()]).toEqual([
      "aetheria.groups.read",
      "aetheria.groups.apply",
    ]);
    expect([...AetheriaRpcGroup.requests.keys()]).toEqual(Object.values(AETHERIA_WS_METHODS));
  });

  it("states the limits the store and the web client share", () => {
    expect(GROUPS_MAX_BODY_BYTES).toBe(8192);
    expect(GROUPS_MAX_RENAME_MEMBERS).toBe(200);
    expect(GROUPS_MAX_ID_LENGTH).toBe(512);
    expect(GROUPS_MAX_NAME_LENGTH).toBe(80);
  });

  it("reads with an empty payload; an empty struct admits no field the handler could read, and the handler reads none", () => {
    expect(decode(GroupsReadPayload)({})).toEqual({});
    // Effect's empty struct does not reject an extra key (the same as composition.status); the actor and the scope come from the connection, and nothing reads the payload.
    expect(Object.keys(GroupsReadPayload.fields)).toEqual([]);
  });

  it("accepts exactly the five operation shapes of the union", () => {
    for (const op of ["group", "ungroup", "dismiss"] as const)
      expect(decode(GroupsApplyPayload)({ op, a: "a", b: "b" })).toEqual({ op, a: "a", b: "b" });
    expect(decode(GroupsApplyPayload)({ op: "detach", a: "a" })).toEqual({ op: "detach", a: "a" });
    expect(
      decode(GroupsApplyPayload)({ op: "rename", members: ["a", "b"], name: "Plans" }),
    ).toEqual({
      op: "rename",
      members: ["a", "b"],
      name: "Plans",
    });
    // An empty name is the clearing form; the semantic rules (trim, sort, de-duplicate, a !== b) are the handler's.
    expect(
      decode(GroupsApplyPayload)({ op: "rename", members: ["a", "b"], name: "" }),
    ).toBeTruthy();
  });

  it("refuses an unknown op, an unknown or forged key, a missing field and a detach that carries b", () => {
    for (const bad of [
      { op: "merge", a: "a", b: "b" },
      { op: "group", a: "a" },
      { op: "group", a: "a", b: "b", at: 1 },
      { op: "group", a: "a", b: "b", actor: { clientSessionId: "x" } },
      { op: "group", a: "a", b: "b", scopes: ["orchestration:operate"] },
      { op: "detach", a: "a", b: "b" },
      { op: "detach" },
      { op: "rename", members: ["a", "b"] },
      { op: "rename", members: ["a", "b"], name: "n", extra: 1 },
      { op: "rename", members: "ab", name: "n" },
      {},
    ])
      expect(() => decode(GroupsApplyPayload)(bad), JSON.stringify(bad)).toThrow();
  });

  it("bounds an id to 1..512 characters and a rename to 2..200 members", () => {
    expect(() => decode(GroupsApplyPayload)({ op: "detach", a: "" })).toThrow();
    expect(() => decode(GroupsApplyPayload)({ op: "detach", a: "x".repeat(513) })).toThrow();
    expect(decode(GroupsApplyPayload)({ op: "detach", a: "x".repeat(512) })).toBeTruthy();
    const members = (n: number) =>
      Array.from({ length: n }, (_, i) => `s${String(i).padStart(4, "0")}`);
    expect(
      decode(GroupsApplyPayload)({ op: "rename", members: members(200), name: "n" }),
    ).toBeTruthy();
    expect(() =>
      decode(GroupsApplyPayload)({ op: "rename", members: members(201), name: "n" }),
    ).toThrow();
    expect(() =>
      decode(GroupsApplyPayload)({ op: "rename", members: members(1), name: "n" }),
    ).toThrow();
    expect(() =>
      decode(GroupsApplyPayload)({ op: "rename", members: ["a", ""], name: "n" }),
    ).toThrow();
  });

  it("replies with the version-2 record or a coded refusal, for both methods", () => {
    for (const schema of [GroupsReadResult, GroupsApplyResult]) {
      expect(decode(schema)({ ok: true, value: record })).toEqual({ ok: true, value: record });
      expect(
        decode(schema)({ ok: true, value: { version: 2, links: [], dismissed: [], names: [] } }),
      ).toBeTruthy();
      // Not repaired, not read as empty: another version, an unknown key and an unnormalised shape are not on the wire.
      for (const value of [
        { ...record, version: 1 },
        { ...record, version: 3 },
        { ...record, extra: [] },
        { version: 2, links: [], dismissed: [] },
        { ...record, links: [{ a: "a", b: "b", kind: "forked", at: 1 }] },
        { ...record, names: [{ members: ["a"], name: "n", at: 1 }] },
      ])
        expect(() => decode(schema)({ ok: true, value }), JSON.stringify(value)).toThrow();
    }
  });

  it("accepts a refusal only with a code the Backend can raise, each with a class", () => {
    expect(Object.keys(GROUPS_CODE_CLASSES).sort()).toEqual([
      "GROUPS_DEVICE_REVOKED",
      "GROUPS_INVALID_REQUEST",
      "GROUPS_NOT_AUTHORIZED",
      "GROUPS_OUTCOME_UNKNOWN",
      "GROUPS_REQUEST_TOO_LARGE",
      "GROUPS_SESSION_NOT_FOUND",
      "GROUPS_STORE_UNUSABLE",
      "GROUPS_UNAVAILABLE",
    ]);
    for (const code of Object.keys(GROUPS_CODE_CLASSES))
      for (const schema of [GroupsReadResult, GroupsApplyResult])
        expect(decode(schema)({ ok: false, code, detail: "d" })).toBeTruthy();
    for (const code of ["SOMETHING_ELSE", "CHILDREN_UNAVAILABLE", "INTERACTION_UNAVAILABLE"])
      expect(() => decode(GroupsApplyResult)({ ok: false, code })).toThrow();
    expect(() =>
      decode(GroupsApplyResult)({ ok: false, code: "GROUPS_UNAVAILABLE", user: true }),
    ).toThrow();
  });
});
