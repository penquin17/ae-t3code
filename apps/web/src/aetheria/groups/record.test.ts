// The strict client reading of the Backend's group record (copy of DSH's v2 shape). Boundary: a pure function over an
// unknown value; it shows what the client accepts, not what a real Backend sends.
import { describe, expect, it } from "vite-plus/test";

import { readGroupRecord } from "./record";

const valid = {
  version: 2,
  links: [{ a: "a", b: "b", kind: "grouped", at: 5 }],
  dismissed: [{ a: "c", b: "d", at: 6 }],
  names: [{ members: ["a", "b"], name: "Topic", at: 7 }],
};
const clone = (): Record<string, unknown> => structuredClone(valid);
const with_ = (patch: (record: Record<string, unknown>) => void): unknown => {
  const record = clone();
  patch(record);
  return record;
};

describe("readGroupRecord accepts exactly the version-2 record", () => {
  it("returns the record as supplied, empty only when the Backend says so", () => {
    expect(readGroupRecord(valid)).toEqual({ ok: true, record: valid });
    const empty = { version: 2, links: [], dismissed: [], names: [] };
    expect(readGroupRecord(empty)).toEqual({ ok: true, record: empty });
  });
});

describe("readGroupRecord refuses what it cannot trust, as unsupported, without repair", () => {
  const BAD: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["an array", []],
    ["a string", "{}"],
    ["version 1", { version: 1, links: [], dismissed: [] }],
    ["version 3", with_((r) => (r.version = 3))],
    ["version as a string", with_((r) => (r.version = "2"))],
    ["a missing names key", with_((r) => delete r.names)],
    ["an unknown top-level key", with_((r) => (r.extra = 1))],
    ["links that are not an array", with_((r) => (r.links = {}))],
    ["a link with an unknown key", with_((r) => (r.links = [{ ...valid.links[0], x: 1 }]))],
    ["a link of another kind", with_((r) => (r.links = [{ a: "a", b: "b", kind: "fork", at: 1 }]))],
    ["a link with a > b", with_((r) => (r.links = [{ a: "b", b: "a", kind: "grouped", at: 1 }]))],
    ["a link with a == b", with_((r) => (r.links = [{ a: "a", b: "a", kind: "grouped", at: 1 }]))],
    ["a link with a non-finite time", with_((r) => (r.links = [{ ...valid.links[0], at: NaN }]))],
    ["a link with an empty id", with_((r) => (r.links = [{ ...valid.links[0], a: "" }]))],
    [
      "a link with a 513-character id",
      with_((r) => (r.links = [{ ...valid.links[0], b: "b".repeat(513) }])),
    ],
    ["a duplicate link", with_((r) => (r.links = [valid.links[0], valid.links[0]]))],
    ["a dismissed pair with a > b", with_((r) => (r.dismissed = [{ a: "z", b: "y", at: 1 }]))],
    [
      "a duplicate dismissed pair",
      with_((r) => (r.dismissed = [valid.dismissed[0], valid.dismissed[0]])),
    ],
    ["a name with one member", with_((r) => (r.names = [{ members: ["a"], name: "x", at: 1 }]))],
    [
      "a name with unsorted members",
      with_((r) => (r.names = [{ members: ["b", "a"], name: "x", at: 1 }])),
    ],
    [
      "a name with repeated members",
      with_((r) => (r.names = [{ members: ["a", "a"], name: "x", at: 1 }])),
    ],
    ["an empty name", with_((r) => (r.names = [{ members: ["a", "b"], name: "", at: 1 }]))],
    ["an untrimmed name", with_((r) => (r.names = [{ members: ["a", "b"], name: " x", at: 1 }]))],
    [
      "an 81-character name",
      with_((r) => (r.names = [{ members: ["a", "b"], name: "n".repeat(81), at: 1 }])),
    ],
    [
      "two names with the same members",
      with_(
        (r) =>
          (r.names = [
            { members: ["a", "b"], name: "x", at: 1 },
            { members: ["a", "b"], name: "y", at: 2 },
          ]),
      ),
    ],
  ];

  it.each(BAD)("refuses %s", (_label, value) => {
    const read = readGroupRecord(value);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.code).toBe("unsupported");
      expect(read.reason.length).toBeGreaterThan(0);
    }
  });

  it("accepts a name of exactly 80 characters and an id of exactly 512", () => {
    const ok = with_((r) => {
      r.names = [{ members: ["a", "b"], name: "n".repeat(80), at: 1 }];
      r.links = [{ a: "a", b: "b".repeat(512), kind: "grouped", at: 1 }];
    });
    expect(readGroupRecord(ok).ok).toBe(true);
  });
});
