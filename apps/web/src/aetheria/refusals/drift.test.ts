// The drift detector: a canonical code with no display line (in either language), or a line for no canonical code, is reported. Boundary: the pure function `refusalDrift` over data.
import { describe, expect, it } from "vite-plus/test";

import { CANONICAL_CODES } from "./canonical";
import { refusalDrift } from "./drift";
import { LINES } from "./lines";

const canonical = { codes: CANONICAL_CODES };

describe("the shipped table covers exactly the canonical codes", () => {
  it("reports no drift for the shipped lines against the transcribed canonical list", () => {
    expect(refusalDrift(canonical, LINES)).toEqual({ missing: [], extra: [], missingLocale: [] });
  });

  it("lists the owners it transcribes: M04, M03, M06, M10, M05 and T3", () => {
    expect(new Set(CANONICAL_CODES.map((c) => c.owner))).toEqual(
      new Set(["M04", "M03", "M06", "M10", "M05", "T3"]),
    );
  });

  it("holds the fourteen M06 interaction codes and the five M10 children codes", () => {
    expect(CANONICAL_CODES.filter((c) => c.owner === "M06")).toHaveLength(14);
    expect(CANONICAL_CODES.filter((c) => c.owner === "M10")).toHaveLength(5);
  });
});

describe("removing a line makes the drift visible (mutation, restored by the test)", () => {
  it("a removed code's line is reported as missing", () => {
    const { INTERACTION_STALE_REVISION: _removed, ...without } = LINES;
    expect(refusalDrift(canonical, without).missing).toEqual(["INTERACTION_STALE_REVISION"]);
  });

  it("a removed translation is reported with its locale", () => {
    const mutated = { ...LINES, T1_STALE: { en: LINES["T1_STALE"]!.en, zh: "" } };
    expect(refusalDrift(canonical, mutated).missingLocale).toEqual([
      { code: "T1_STALE", locale: "zh" },
    ]);
    const noEnglish = { ...LINES, T1_STALE: { en: "  ", zh: LINES["T1_STALE"]!.zh } };
    expect(refusalDrift(canonical, noEnglish).missingLocale).toEqual([
      { code: "T1_STALE", locale: "en" },
    ]);
  });

  it("a line for a code the canonical set lacks is reported as extra", () => {
    const withStranger = { ...LINES, NOT_A_CODE: { en: "x", zh: "y" } };
    expect(refusalDrift(canonical, withStranger).extra).toEqual(["NOT_A_CODE"]);
  });

  it("a canonical list that gains a code reports it missing", () => {
    const grown = {
      codes: [...CANONICAL_CODES, { code: "NEW_CODE", class: "refusal", owner: "M06" }],
    };
    expect(refusalDrift(grown, LINES).missing).toEqual(["NEW_CODE"]);
  });

  it("an empty line set misses every code, in the canonical order", () => {
    expect(refusalDrift(canonical, {}).missing).toEqual(CANONICAL_CODES.map((c) => c.code));
  });
});
