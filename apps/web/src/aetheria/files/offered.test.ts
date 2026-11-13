// The offered edit paths as the Backend says them (M10 Plan step 16, D11/D12/R8). Pure: a reply in, a view out. The board's three answers (known, unknown, unavailable) stay apart from each other
// and from a failed call; a known empty list is not an unknown one.
import { describe, expect, it } from "vite-plus/test";

import type { SendResult } from "../core/outcome";
import { OFFERED_LABEL, offeredViewFromSend, TURN_DIFF_NOTE } from "./offered";

const off = (n: number) => `off_${String(n).repeat(32)}`;
const ok = (edits: unknown, root = "root-1"): SendResult<unknown> => ({
  tag: "accepted",
  value: { ok: true, value: { rootThreadId: root, edits } },
});
const fail = (code: string, detail?: string): SendResult<unknown> => ({
  tag: "accepted",
  value: { ok: false, code, ...(detail === undefined ? {} : { detail }) },
});

describe("offeredViewFromSend", () => {
  it("a known list keeps the Backend's order and ids; a known empty list is empty", () => {
    const view = offeredViewFromSend(
      ok({
        status: "known",
        paths: [
          { id: off(1), canonicalPath: "/w/a.ts" },
          { id: off(2), canonicalPath: "/w/b.md" },
        ],
      }),
      "root-1",
    );
    expect(view.tag === "known" && view.paths.map((p) => p.canonicalPath)).toEqual([
      "/w/a.ts",
      "/w/b.md",
    ]);
    expect(offeredViewFromSend(ok({ status: "known", paths: [] }), "root-1")).toEqual({
      tag: "known",
      rootThreadId: "root-1",
      paths: [],
    });
  });

  it("the board saying unknown or unavailable is neither empty nor each other", () => {
    const unknown = offeredViewFromSend(ok({ status: "unknown" }), "root-1");
    const unavailable = offeredViewFromSend(ok({ status: "unavailable" }), "root-1");
    expect(unknown.tag).toBe("unknown");
    expect(unavailable.tag).toBe("unavailable");
    expect(unknown).not.toEqual(unavailable);
    expect(unknown.tag === "unknown" && unknown.reason).toContain("no edit record");
  });

  it("a lost reply or a malformed answer is unknown, never an empty list", () => {
    expect(offeredViewFromSend({ tag: "lost" }, "root-1").tag).toBe("unknown");
    expect(offeredViewFromSend({ tag: "accepted", value: {} }, "root-1").tag).toBe("unknown");
    expect(
      offeredViewFromSend(ok({ status: "known", paths: [{ id: "x", canonicalPath: "" }] }), "r")
        .tag,
    ).toBe("unknown");
    expect(offeredViewFromSend(ok({ status: "known", paths: [] }, "root-2"), "root-1").tag).toBe(
      "unknown",
    );
  });

  it("failure codes are unavailable and refusals refused, each with the Backend's words", () => {
    expect(offeredViewFromSend(fail("DELIVERABLES_UNAVAILABLE", "stopped"), "r")).toMatchObject({
      tag: "unavailable",
      code: "DELIVERABLES_UNAVAILABLE",
      detail: "stopped",
    });
    expect(offeredViewFromSend(fail("DELIVERABLES_NOT_AUTHORIZED", "no"), "r")).toEqual({
      tag: "refused",
      code: "DELIVERABLES_NOT_AUTHORIZED",
      detail: "no",
    });
  });

  it("the labels say per session, not per turn, and that shell writes are not tracked", () => {
    expect(OFFERED_LABEL).toContain("per session, not per turn");
    expect(OFFERED_LABEL).toContain("shell writes not tracked");
    expect(TURN_DIFF_NOTE).toContain("Git");
  });
});
