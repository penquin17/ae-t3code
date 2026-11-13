import { describe, expect, it } from "vite-plus/test";

import { classifyReply, readViewFromReply } from "./reply";

describe("one reply is one of four things", () => {
  it("an accepted reply carries its value untouched", () => {
    expect(classifyReply({ ok: true, value: { a: 1 } })).toEqual({ tag: "ok", value: { a: 1 } });
  });

  it("a code ending _UNAVAILABLE is unavailable, in the Backend's words when it gave some", () => {
    expect(classifyReply({ ok: false, code: "JOBS_UNAVAILABLE", detail: "not wired" })).toEqual({
      tag: "unavailable",
      reason: "not wired",
    });
    expect(classifyReply({ ok: false, code: "ORCHESTRATION_UNAVAILABLE" })).toMatchObject({
      tag: "unavailable",
    });
  });

  it("a code ending _OUTCOME_UNKNOWN is unknown, never refused or unavailable", () => {
    expect(
      classifyReply({ ok: false, code: "JOBS_OUTCOME_UNKNOWN", detail: "the socket closed" }),
    ).toEqual({ tag: "unknown", reason: "the socket closed" });
  });

  it("any other code is a refusal that keeps its code and detail exactly", () => {
    expect(classifyReply({ ok: false, code: "JOB_NOT_FOUND", detail: "no such job" })).toEqual({
      tag: "refused",
      code: "JOB_NOT_FOUND",
      detail: "no such job",
    });
    expect(classifyReply({ ok: false, code: "JOB_NOT_FOUND" })).toEqual({
      tag: "refused",
      code: "JOB_NOT_FOUND",
    });
  });

  it.each([null, undefined, 3, "ok", {}, { ok: "yes" }, { ok: false }, { ok: false, code: 4 }])(
    "a non-reply (%j) is unknown, not an empty success",
    (value) => {
      expect(classifyReply(value).tag).toBe("unknown");
    },
  );
});

describe("a read view", () => {
  const parse = (value: unknown) =>
    Array.isArray(value)
      ? ({ ok: true, value: value as number[] } as const)
      : ({ ok: false, reason: "not a list" } as const);

  it("a parsed value is read; one that does not parse is unknown with the parser's reason", () => {
    expect(readViewFromReply({ ok: true, value: [1, 2] }, parse)).toEqual({
      tag: "read",
      value: [1, 2],
    });
    expect(readViewFromReply({ ok: true, value: 5 }, parse)).toEqual({
      tag: "unknown",
      reason: "not a list",
    });
  });

  it("failures keep their class", () => {
    expect(readViewFromReply({ ok: false, code: "X_UNAVAILABLE", detail: "d" }, parse)).toEqual({
      tag: "unavailable",
      reason: "d",
    });
    expect(readViewFromReply({ ok: false, code: "X_DENIED" }, parse)).toEqual({
      tag: "refused",
      code: "X_DENIED",
    });
  });
});
