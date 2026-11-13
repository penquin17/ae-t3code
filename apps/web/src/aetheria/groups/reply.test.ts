// A Backend reply becomes one honest result, and the refusal codes it recognises are the contract's own, code for code (M10 step 7, D4). Boundary: the pure functions `changeSendResult` and
// `readResult` over the real contract table; no transport is exercised.
import { GROUPS_CODE_CLASSES } from "@t3tools/aetheria-contracts";
import { describe, expect, it } from "vite-plus/test";

import { changeSendResult, readResult } from "./reply";
import { GROUPS_UNAVAILABLE } from "./transport";

const EMPTY = { version: 2, links: [], dismissed: [], names: [] };

describe("every code of the contract is read as the contract means it", () => {
  it("the client's unavailable code is the contract's", () => {
    expect(Object.keys(GROUPS_CODE_CLASSES)).toContain(GROUPS_UNAVAILABLE);
  });

  it.each(Object.keys(GROUPS_CODE_CLASSES))("%s as a change reply", (code) => {
    const result = changeSendResult({ ok: false, code, detail: "from the backend" });
    if (code === "GROUPS_UNAVAILABLE") expect(result.tag).toBe("unavailable");
    else if (code === "GROUPS_OUTCOME_UNKNOWN") expect(result).toEqual({ tag: "lost" });
    else expect(result).toEqual({ tag: "refused", code, message: "from the backend" });
  });

  it("a code outside the contract is never read as a refusal: the reply is lost, not guessed", () => {
    expect(changeSendResult({ ok: false, code: "GROUPS_SOMETHING_ELSE" })).toEqual({ tag: "lost" });
  });

  it("a confirmed record is accepted and a malformed one is lost", () => {
    expect(changeSendResult({ ok: true, value: EMPTY })).toMatchObject({ tag: "accepted" });
    expect(changeSendResult({ ok: true, value: { ...EMPTY, version: 3 } })).toEqual({
      tag: "lost",
    });
  });

  it("a read of an unusable store is a failed read carrying the contract's code and the Backend's words", () => {
    expect(
      readResult({ ok: false, code: "GROUPS_STORE_UNUSABLE", detail: "left as it was" }),
    ).toMatchObject({ tag: "failed", code: "GROUPS_STORE_UNUSABLE", reason: "left as it was" });
  });
});
