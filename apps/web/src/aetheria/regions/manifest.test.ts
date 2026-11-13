// AETHERIA M10 step 23 (D17, XC-19): the manifest is generated from the declarations, never inferred from the page. It lists every declared region in one order, so a generator run is
// deterministic and a full-page test (step 24) can compare the mounted set with it exactly.
import { describe, expect, it } from "vite-plus/test";

import { declareRegion } from "./descriptor";
import { INITIAL_REGION_IDS, REGION_DECLARATIONS } from "./declarations";
import { buildManifest, manifestJson } from "./manifest";

const a = declareRegion({
  id: "a",
  kind: "screen",
  owner: "aetheria-ui",
  parent: null,
  description: "A",
});
const b = declareRegion({
  id: "a.b",
  kind: "panel",
  owner: "aetheria-ui",
  parent: "a",
  description: "B",
});

describe("the manifest of declared regions", () => {
  it("lists the descriptors sorted by id, whatever order they were declared in", () => {
    expect(buildManifest([b, a])).toEqual({ schemaVersion: 1, regions: [a, b] });
    expect(manifestJson([b, a])).toBe(manifestJson([a, b]));
  });

  it("renders the same bytes for the same declarations every time, ending in one newline", () => {
    const first = manifestJson([a, b]);
    expect(manifestJson([a, b])).toBe(first);
    expect(first.endsWith("}\n")).toBe(true);
    expect(first.endsWith("\n\n")).toBe(false);
    expect(JSON.parse(first)).toEqual(buildManifest([a, b]));
  });

  it("refuses a duplicate id and a parent that is not declared", () => {
    expect(() => buildManifest([a, a])).toThrow(/duplicate region id "a"/);
    expect(() => buildManifest([b])).toThrow(/parent "a" of "a.b" is not declared/);
  });

  it("refuses a parent cycle", () => {
    const x = declareRegion({ id: "x", kind: "region", owner: "m", parent: "y", description: "X" });
    const y = declareRegion({ id: "y", kind: "region", owner: "m", parent: "x", description: "Y" });
    expect(() => buildManifest([x, y])).toThrow(/cycle/);
  });
});

describe("the declared M10 regions", () => {
  it("are the initial list the design names, each declared once", () => {
    expect([...INITIAL_REGION_IDS].toSorted()).toEqual(
      [
        "shell",
        "sidebar.sessions",
        "sidebar.rail",
        "drawer",
        "conversation.transcript",
        "conversation.running",
        "composer",
        "panel.files",
        "panel.terminal",
        "panel.diff",
        "deliverables",
        "interactions",
        "settings",
      ].toSorted(),
    );
    expect(REGION_DECLARATIONS.map((d) => d.id).toSorted()).toEqual(
      [...INITIAL_REGION_IDS].toSorted(),
    );
  });

  it("build into a manifest, with every owner a module id and no secret-bearing text", () => {
    const manifest = buildManifest(REGION_DECLARATIONS);
    expect(manifest.regions).toHaveLength(INITIAL_REGION_IDS.length);
    expect(manifest.regions.every((r) => r.owner === "aetheria-ui")).toBe(true);
    expect(manifest.regions.filter((r) => r.parent === null).map((r) => r.id)).toEqual(["shell"]);
  });
});
