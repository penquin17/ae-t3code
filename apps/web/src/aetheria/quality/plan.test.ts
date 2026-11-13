// The quality matrix's plan and its index (M10 Plan step 26): which views and states are captured at which widths, themes and motion settings, the file each capture has, and the index that lists
// them. Pure: no DOM. The browser matrix (matrix.browser.test.tsx) fills the entries; these tests say what a complete and honest index is.
import { describe, expect, it } from "vite-plus/test";

import {
  DROPPED,
  KNOWN_DEFECTS,
  type KnownDefect,
  MOTION_PNG_WIDTHS,
  splitFindings,
  QUALITY_MOTIONS,
  QUALITY_STATES,
  QUALITY_THEMES,
  QUALITY_WIDTHS,
  captureFile,
  expectedCombos,
  indexMarkdown,
  shouldCapture,
  validateIndex,
  type IndexEntry,
} from "./plan";

const entryOf = (
  combo: ReturnType<typeof expectedCombos>[number],
  over: Partial<IndexEntry> = {},
): IndexEntry => ({
  ...combo,
  file: shouldCapture(combo.motion, combo.width) ? captureFile(combo) : null,
  findings: [],
  advisories: [],
  known: [],
  ...over,
});
const complete = () => expectedCombos().map((combo) => entryOf(combo));

describe("the plan", () => {
  it("covers the seven widths, both themes and both motion settings the Plan names", () => {
    expect([...QUALITY_WIDTHS]).toEqual([1280, 1023, 980, 768, 767, 640, 390]);
    expect([...QUALITY_THEMES]).toEqual(["light", "dark"]);
    expect([...QUALITY_MOTIONS]).toEqual(["reduce", "motion"]);
  });

  it("names every view the brief lists: sessions with groups, control, deliverables, connection states and the running indicator", () => {
    const views = new Set(QUALITY_STATES.map((state) => state.view));
    expect([...views].toSorted()).toEqual(["control", "deliverables", "sessions", "status"]);
    const names = QUALITY_STATES.map((state) => `${state.view}/${state.state}`);
    expect(names).toEqual([
      "sessions/groups",
      "control/full",
      "control/degraded",
      "deliverables/cards",
      "deliverables/unavailable",
      "status/banners-and-running",
    ]);
    for (const state of QUALITY_STATES) expect(state.covers.trim(), name(state)).not.toBe("");
  });

  it("has one combination per state, width, theme and motion setting", () => {
    const combos = expectedCombos();
    expect(combos).toHaveLength(QUALITY_STATES.length * 7 * 2 * 2);
    expect(new Set(combos.map((c) => JSON.stringify(c))).size).toBe(combos.length);
  });

  it("captures an image for every reduced-motion combination, and for the motion-on ones only at the widest and the phone width", () => {
    expect([...MOTION_PNG_WIDTHS]).toEqual([1280, 390]);
    expect(shouldCapture("reduce", 768)).toBe(true);
    expect(shouldCapture("motion", 1280)).toBe(true);
    expect(shouldCapture("motion", 390)).toBe(true);
    expect(shouldCapture("motion", 768)).toBe(false);
    const images = expectedCombos().filter((c) => shouldCapture(c.motion, c.width));
    // 6 states x (7 widths x 2 themes reduced + 2 widths x 2 themes motion-on)
    expect(images).toHaveLength(QUALITY_STATES.length * (14 + 4));
  });

  it("gives every image a distinct, readable file name", () => {
    const files = expectedCombos()
      .filter((c) => shouldCapture(c.motion, c.width))
      .map(captureFile);
    expect(new Set(files).size).toBe(files.length);
    expect(
      captureFile({ view: "control", state: "full", width: 390, theme: "dark", motion: "reduce" }),
    ).toBe("quality-control-full-390-dark-reduce.png");
  });

  it("says what it dropped and why", () => {
    expect(DROPPED.length).toBeGreaterThan(0);
    for (const item of DROPPED) {
      expect(item.what.trim()).not.toBe("");
      expect(item.why.trim()).not.toBe("");
    }
  });
});

describe("validateIndex", () => {
  it("accepts a complete index", () => {
    expect(validateIndex(complete())).toEqual([]);
  });

  it("refuses a missing combination and names it", () => {
    const entries = complete().slice(1);
    const faults = validateIndex(entries);
    expect(faults.map((f) => f.code)).toEqual(["missing-entry"]);
  });

  it("refuses a duplicate and an unknown combination", () => {
    const entries = complete();
    const faults = validateIndex([
      ...entries,
      entries[0]!,
      { ...entries[0]!, width: 500 as never },
    ]);
    expect(faults.map((f) => f.code).toSorted()).toEqual(["duplicate-entry", "unknown-entry"]);
  });

  it("refuses an image that was due but has no file, and a file where none was due", () => {
    const entries = complete();
    const due = entries.findIndex((e) => e.file !== null);
    const notDue = entries.findIndex((e) => e.file === null);
    entries[due] = { ...entries[due]!, file: null };
    entries[notDue] = { ...entries[notDue]!, file: "stray.png" };
    expect(
      validateIndex(entries)
        .map((f) => f.code)
        .toSorted(),
    ).toEqual(["file-missing", "file-not-due"]);
  });

  it("refuses a file name that is not the plan's name for the combination", () => {
    const entries = complete();
    entries[0] = { ...entries[0]!, file: "other.png" };
    expect(validateIndex(entries).map((f) => f.code)).toEqual(["file-name"]);
  });
});

describe("splitFindings", () => {
  const contrast =
    'contrast: "Code:" 3.38:1 (#c76e2f on #fcf4eb, span.block.break-words.text-xs, 3 texts) (measured on the base colour under a background image)';

  const defect: KnownDefect = {
    id: "list-notice-code-contrast",
    view: "deliverables",
    state: "unavailable",
    finding: /^contrast: "Code:" [0-9.]+:1 .*span\.block\.break-words\.text-xs/,
    file: "a/File.tsx:1",
    fix: "give the description the foreground colour",
  };

  it("sets aside a finding a known defect names, in the state it names, and keeps every other finding", () => {
    const split = splitFindings("deliverables", "unavailable", [contrast, "overflow: x"], [defect]);
    expect(split.known).toEqual(["list-notice-code-contrast"]);
    expect(split.findings).toEqual(["overflow: x"]);
  });

  it("does not set aside the same words in another view or state", () => {
    expect(splitFindings("control", "full", [contrast], [defect]).findings).toEqual([contrast]);
    expect(splitFindings("deliverables", "cards", [contrast], [defect]).known).toEqual([]);
  });

  it("sets nothing aside while no defect is known, so a finding stays a finding", () => {
    expect(splitFindings("deliverables", "unavailable", [contrast]).findings).toEqual([contrast]);
  });

  it("describes every known defect with the file and the smallest fix", () => {
    for (const known of KNOWN_DEFECTS) {
      expect(known.file.trim()).not.toBe("");
      expect(known.fix.trim()).not.toBe("");
    }
  });
});

describe("indexMarkdown", () => {
  it("lists view, state, width, theme, motion and file, and carries each finding verbatim", () => {
    const entries = complete();
    entries[0] = {
      ...entries[0]!,
      findings: ["text 3.9:1 on #fff (muted)"],
      advisories: ["control 30x30 below 44"],
    };
    const md = indexMarkdown(entries);
    expect(md).toContain(
      "| view | state | width | theme | motion | file | findings | known defects | advisories |",
    );
    expect(md).toContain("quality-sessions-groups-1280-light-reduce.png");
    expect(md).toContain("text 3.9:1 on #fff (muted)");
    expect(md).toContain("control 30x30 below 44");
    expect(md.split("\n").filter((line) => line.startsWith("| sessions |"))).toHaveLength(28);
  });

  it("states the phone touch rule: Aetheria's controls fail under 44 px, T3's are listed as advisories", () => {
    const md = indexMarkdown(complete());
    const rules = md.slice(md.indexOf("## What fails"), md.indexOf("## Known defects"));
    expect(rules).toContain("767 px and below");
    expect(rules).toContain("--ae-size-touch-min");
    expect(rules).toMatch(/Aetheria-owned .* finding/);
    expect(rules).toMatch(/T3-owned .* advisor/);
  });

  it("states the counts and the dropped items", () => {
    const md = indexMarkdown(complete());
    expect(md).toContain(`${expectedCombos().length} combinations`);
    expect(md).toContain(`${QUALITY_STATES.length * 18} images`);
    for (const item of DROPPED) expect(md).toContain(item.what);
  });
});

const name = (state: { view: string; state: string }) => `${state.view}/${state.state}`;
