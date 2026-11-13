// The five request bodies and the checks made before anything is sent. Boundary: pure builders; the 8 KiB cap is the
// carried request limit (plan conservative reading b), which is neither raised nor traded for the 200-id bound.
import { describe, expect, it } from "vite-plus/test";

import { detachBody, effectShown, MAX_BODY_BYTES, pairBody, renameBody } from "./operations";
import type { GroupRecord } from "./record";

const ids = (count: number, length = 6): string[] =>
  Array.from({ length: count }, (_, i) => `s${String(i).padStart(length - 1, "0")}`);

describe("pair and detach bodies", () => {
  it("carry exactly op, a and b with a before b", () => {
    expect(pairBody("group", "b", "a")).toMatchObject({
      ok: true,
      body: { op: "group", a: "a", b: "b" },
    });
    const built = pairBody("dismiss", "x", "y");
    expect(built.ok && Object.keys(built.body)).toEqual(["op", "a", "b"]);
    const detach = detachBody("z");
    expect(detach).toMatchObject({ ok: true, body: { op: "detach", a: "z" } });
    expect(detach.ok && Object.keys(detach.body)).toEqual(["op", "a"]);
  });

  it.each([
    ["the same id twice", () => pairBody("ungroup", "a", "a")],
    ["an empty id", () => pairBody("group", "", "b")],
    ["a 513-character id", () => pairBody("group", "a", "b".repeat(513))],
    ["an empty detach id", () => detachBody("")],
  ])("refuses %s locally", (_label, build) => {
    const built = build();
    expect(built).toMatchObject({ ok: false, code: "GROUPS_INVALID_REQUEST" });
  });
});

describe("renameBody", () => {
  it("sends exactly op, members, name; members sorted and unique; name trimmed", () => {
    const built = renameBody(["b", "a", "b", "c"], "  Topic ");
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(Object.keys(built.body)).toEqual(["op", "members", "name"]);
      expect(built.body).toEqual({ op: "rename", members: ["a", "b", "c"], name: "Topic" });
    }
  });

  it("sends an empty name to clear", () => {
    expect(renameBody(["a", "b"], "   ")).toMatchObject({ ok: true, body: { name: "" } });
  });

  it.each([
    ["one unique id", () => renameBody(["a", "a"], "x")],
    ["201 ids", () => renameBody(ids(201), "x")],
    ["an 81-character name", () => renameBody(["a", "b"], "n".repeat(81))],
    ["an empty id", () => renameBody(["a", ""], "x")],
    ["a 513-character id", () => renameBody(["a", "b".repeat(513)], "x")],
  ])("refuses %s locally", (_label, build) => {
    expect(build()).toMatchObject({ ok: false, code: "GROUPS_INVALID_REQUEST" });
  });

  it("builds a 200-member body that fits the 8 KiB cap", () => {
    const built = renameBody(ids(200), "A topic");
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.bytes).toBe(new TextEncoder().encode(JSON.stringify(built.body)).length);
      expect(built.bytes).toBeLessThanOrEqual(MAX_BODY_BYTES);
      expect(built.body).toMatchObject({ members: expect.arrayContaining(["s00000"]) });
    }
  });

  it("refuses a valid-shape body over the cap with its reason and does not cut the id bound", () => {
    const long = Array.from(
      { length: 200 },
      (_, i) => `session-${String(i).padStart(3, "0")}-${"x".repeat(40)}`,
    );
    const built = renameBody(long, "A topic");
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.code).toBe("GROUPS_REQUEST_TOO_LARGE");
      expect(built.reason).toMatch(/8192/);
      expect(built.reason).toMatch(/200/);
    }
    // A shorter list of the same long ids that fits is still accepted: the bound is bytes, not a cut count.
    expect(renameBody(long.slice(0, 20), "A topic").ok).toBe(true);
  });

  it("counts UTF-8 bytes, not characters", () => {
    const wide = Array.from({ length: 200 }, (_, i) => `会话${String(i).padStart(3, "0")}`);
    const built = renameBody(wide, "话题");
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.bytes).toBeGreaterThan(JSON.stringify(built.body).length);
  });
});

describe("effectShown: what a re-read must show before success", () => {
  const record = (over: Partial<GroupRecord>): GroupRecord => ({
    version: 2,
    links: [],
    dismissed: [],
    names: [],
    ...over,
  });
  const body = <T>(built: { ok: boolean; body?: T }): T => (built as { body: T }).body;

  it("group, ungroup, dismiss", () => {
    const link = { a: "a", b: "b", kind: "grouped" as const, at: 1 };
    const group = body(pairBody("group", "a", "b"));
    expect(effectShown(group, record({ links: [link] }))).toBe(true);
    expect(effectShown(group, record({}))).toBe(false);
    const ungroup = body(pairBody("ungroup", "a", "b"));
    expect(effectShown(ungroup, record({}))).toBe(true);
    expect(effectShown(ungroup, record({ links: [link] }))).toBe(false);
    const dismiss = body(pairBody("dismiss", "a", "b"));
    expect(effectShown(dismiss, record({ dismissed: [{ a: "a", b: "b", at: 1 }] }))).toBe(true);
    expect(effectShown(dismiss, record({}))).toBe(false);
  });

  it("detach: no confirmed link touches the session; forks and other pairs do not matter", () => {
    const detach = body(detachBody("a"));
    const other = { a: "b", b: "c", kind: "grouped" as const, at: 1 };
    expect(effectShown(detach, record({ links: [other] }))).toBe(true);
    expect(
      effectShown(detach, record({ links: [{ a: "a", b: "z", kind: "grouped", at: 1 }] })),
    ).toBe(false);
  });

  it("rename: the saved name is the only one touching the members; empty clears every overlap", () => {
    const rename = body(renameBody(["b", "a"], "Topic"));
    const saved = { members: ["a", "b"], name: "Topic", at: 1 };
    expect(effectShown(rename, record({ names: [saved] }))).toBe(true);
    expect(effectShown(rename, record({ names: [{ ...saved, name: "Old" }] }))).toBe(false);
    expect(
      effectShown(
        rename,
        record({ names: [saved, { members: ["b", "c"], name: "Other", at: 2 }] }),
      ),
    ).toBe(false);
    const clear = body(renameBody(["a", "b"], ""));
    expect(effectShown(clear, record({}))).toBe(true);
    expect(effectShown(clear, record({ names: [saved] }))).toBe(false);
  });
});
