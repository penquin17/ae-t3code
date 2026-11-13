// The drift detector: a canonical code with no display line (in either language), or a line for no canonical code, is reported. Boundary: the pure function `refusalDrift` over data.
import { NON_CODE_REFUSALS, REFUSAL_TABLE } from "@aetheria/awareness/permissions";
import {
  CHILDREN_CONTROL_CODE_CLASSES,
  CHILDREN_PASSTHROUGH_CODES,
  GROUPS_CODE_CLASSES,
  INTERACTION_CODE_CLASSES,
} from "@t3tools/aetheria-contracts";
import { describe, expect, it } from "vite-plus/test";

import { CANONICAL_CODES } from "./canonical";
import { refusalDrift } from "./drift";
import { LINES } from "./lines";

const canonical = { codes: CANONICAL_CODES };

describe("the shipped table covers exactly the canonical codes", () => {
  it("reports no drift for the shipped lines against the canonical list read from the real tables", () => {
    expect(refusalDrift(canonical, LINES)).toEqual({ missing: [], extra: [], missingLocale: [] });
  });

  it("lists the owners: M04, M03, M06, M10, M05 and T3", () => {
    expect(new Set(CANONICAL_CODES.map((c) => c.owner))).toEqual(
      new Set(["M04", "M03", "M06", "M10", "M05", "T3"]),
    );
  });

  it("holds the fourteen M06 interaction codes and the thirteen M10 codes (five children, eight group)", () => {
    expect(CANONICAL_CODES.filter((c) => c.owner === "M06")).toHaveLength(14);
    expect(CANONICAL_CODES.filter((c) => c.owner === "M10")).toHaveLength(13);
  });
});

describe("the canonical list is the real tables, code for code", () => {
  const codes = CANONICAL_CODES.map((c) => c.code);
  const classOf = (code: string) => CANONICAL_CODES.find((c) => c.code === code)?.class;

  it("holds every row of the packed awareness refusal table (M04 and M03) with its own class", () => {
    expect(REFUSAL_TABLE.length).toBeGreaterThan(30);
    for (const row of REFUSAL_TABLE) expect(classOf(row.code), row.code).toBe(row.class);
    for (const row of NON_CODE_REFUSALS) expect(codes, row.id).toContain(row.id);
  });

  it("holds every interaction, children and group code of the contracts with its own class, and M05's passed-through codes", () => {
    for (const table of [
      INTERACTION_CODE_CLASSES,
      CHILDREN_CONTROL_CODE_CLASSES,
      GROUPS_CODE_CLASSES,
    ] as Array<Readonly<Record<string, string>>>)
      for (const [code, cls] of Object.entries(table)) expect(classOf(code), code).toBe(cls);
    for (const code of CHILDREN_PASSTHROUGH_CODES) expect(classOf(code), code).toBe("passthrough");
  });

  it("lists no code twice and holds nothing the tables do not", () => {
    expect(new Set(codes).size).toBe(codes.length);
    const real = new Set<string>([
      ...REFUSAL_TABLE.map((r) => r.code),
      ...NON_CODE_REFUSALS.map((r) => r.id),
      ...Object.keys(INTERACTION_CODE_CLASSES),
      ...Object.keys(CHILDREN_CONTROL_CODE_CLASSES),
      ...Object.keys(GROUPS_CODE_CLASSES),
      ...CHILDREN_PASSTHROUGH_CODES,
    ]);
    expect(new Set(codes)).toEqual(real);
  });

  it("a code the real table gains and the display lacks is drift (mutation: the group table grown by one)", () => {
    const grown = {
      codes: [...CANONICAL_CODES, { code: "GROUPS_NEW_CODE", class: "refusal", owner: "M10" }],
    };
    expect(refusalDrift(grown, LINES).missing).toEqual(["GROUPS_NEW_CODE"]);
  });
});

describe("the web reads the packed awareness archive through its permissions subpath only (IP-28)", () => {
  const sources = import.meta.glob("/src/**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  it("imports no other awareness subpath and no outer source", () => {
    const offending: string[] = [];
    const read = Object.entries(sources).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    // The scan must have seen the app's own sources, or it proves nothing.
    expect(read.length).toBeGreaterThan(100);
    expect(read.some(([file]) => file.endsWith("/refusals/canonical.ts"))).toBe(true);
    for (const [file, text] of read) {
      if (file.includes("/refusals/drift.test.ts")) continue;
      for (const match of text.matchAll(
        /["'](@aetheria\/[^"']*|[./]*\/packages\/aetheria-[^"']*)["']/g,
      )) {
        if (match[1] !== "@aetheria/awareness/permissions") offending.push(`${file}: ${match[1]}`);
      }
    }
    expect(offending).toEqual([]);
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
