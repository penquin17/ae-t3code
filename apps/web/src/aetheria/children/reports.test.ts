// M10 Plan step 10 (D2, C7): how the answer to a stored-report read becomes one view. Missing, unreadable and unavailable are three different things; a report is carried unchanged; a stale
// reply never overwrites a newer read. Boundary: pure functions over supplied replies and the unavailable default transport; no T3, no DOM.
import { describe, expect, it } from "vitest";

import {
  finishReport,
  initialReports,
  reportViewFromReply,
  reportViewOf,
  startReport,
  structuredText,
  UNAVAILABLE_REPORTS,
  type ReportView,
} from "./reports";

const REPORT = {
  status: "failed",
  cause: "the provider said: 429",
  text: "Line one\n\n  indented line — verbatim, even *markdown* and <b>tags</b>.",
  structured: { found: [1, 2, 3] },
  route: 2,
};

describe("reportViewFromReply", () => {
  it("a stored report is carried unchanged, never summarised", () => {
    const view = reportViewFromReply({ ok: true, value: { state: "reported", report: REPORT } });
    expect(view).toEqual({ tag: "reported", report: REPORT });
  });

  it("pending and not-record-only are their own words, not a missing report", () => {
    expect(reportViewFromReply({ ok: true, value: { state: "pending" } }).tag).toBe("pending");
    expect(reportViewFromReply({ ok: true, value: { state: "not-record-only" } }).tag).toBe(
      "not-record-only",
    );
  });

  it.each([
    ["CHILD_NOT_OWNED", "missing"],
    ["CHILDREN_NOT_FOUND", "missing"],
    ["ORCHESTRATION_UNAVAILABLE", "unreadable"],
    ["CHILDREN_OUTCOME_UNKNOWN", "unreadable"],
    ["CHILDREN_UNAVAILABLE", "unavailable"],
    ["CHILDREN_NOT_AUTHORIZED", "refused"],
    ["CHILDREN_DEVICE_REVOKED", "refused"],
    ["A_CODE_NOBODY_KNOWS", "refused"],
  ] as const)("%s is %s, and the Backend's detail is kept verbatim", (code, tag) => {
    const view = reportViewFromReply({ ok: false, code, detail: "the route record is corrupt" });
    expect(view.tag).toBe(tag);
    expect(JSON.stringify(view)).toContain("the route record is corrupt");
  });

  it("an answer that is not a report is unreadable, never missing or empty", () => {
    for (const reply of [null, "x", 7, { ok: true }, { ok: true, value: { state: "weird" } }]) {
      expect(reportViewFromReply(reply).tag).toBe("unreadable");
    }
  });

  it("the no-connection transport answers unavailable, in words that say the read is not connected", async () => {
    const reply = await UNAVAILABLE_REPORTS.read({ rootThreadId: "r", target: "c" });
    const view = reportViewFromReply(reply);
    expect(view).toEqual({
      tag: "unavailable",
      reason: "The report read is not connected",
    });
  });
});

describe("one read per child keeps one owner", () => {
  const unreadable = (reason: string): ReportView => ({ tag: "unreadable", reason });

  it("a stale reply is ignored when a newer read of the same child began", () => {
    const first = startReport(initialReports, "root", "c1");
    const second = startReport(first.state, "root", "c1");
    const stale = finishReport(second.state, "root", "c1", first.ticket, unreadable("old"));
    expect(reportViewOf(stale, "root", "c1")).toEqual({ tag: "reading" });
    const fresh = finishReport(stale, "root", "c1", second.ticket, unreadable("new"));
    expect(reportViewOf(fresh, "root", "c1")).toEqual(unreadable("new"));
  });

  it("the same child id under two roots keeps two reports", () => {
    const a = startReport(initialReports, "root-a", "c1");
    const b = startReport(a.state, "root-b", "c1");
    const done = finishReport(
      finishReport(b.state, "root-a", "c1", a.ticket, { tag: "pending" }),
      "root-b",
      "c1",
      b.ticket,
      { tag: "not-record-only" },
    );
    expect(reportViewOf(done, "root-a", "c1")).toEqual({ tag: "pending" });
    expect(reportViewOf(done, "root-b", "c1")).toEqual({ tag: "not-record-only" });
    expect(reportViewOf(done, "root-a", "other")).toBeUndefined();
  });
});

describe("structuredText", () => {
  it("shows structured data as indented JSON, unchanged in content", () => {
    expect(structuredText({ found: [1, 2] })).toBe('{\n  "found": [\n    1,\n    2\n  ]\n}');
  });

  it("says so when the data cannot be shown, instead of dropping it", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(structuredText(loop)).toMatch(/could not be shown/);
    expect(structuredText(10n)).toMatch(/could not be shown/);
  });
});
