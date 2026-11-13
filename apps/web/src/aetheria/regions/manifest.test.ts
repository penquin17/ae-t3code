// AETHERIA M10 step 23 (D17, XC-19): the manifest is generated from the declarations, never inferred from the page. It lists every declared region in one order, so a generator run is
// deterministic and a full-page test (step 24) can compare the mounted set with it exactly.
import { tokenNames } from "@t3tools/aetheria-design";
import { describe, expect, it } from "vite-plus/test";

import { declareRegion, type RegionDescriptor } from "./descriptor";
import { DECLARED_REGION_IDS, REGION_DECLARATIONS } from "./declarations";
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

/** The regions an Aetheria component mounts, by the page that mounts them (step 24). T3's own surfaces (shell, drawer, rail, transcript, composer, diff, settings, terminal) are not here: no Aetheria component owns them. */
const EXPECTED_REGIONS = {
  sidebar: ["panel", null],
  "sidebar.connection": ["region", "sidebar"],
  "sidebar.sessions": ["panel", "sidebar"],
  sessions: ["screen", null],
  "sessions.list": ["panel", "sessions"],
  control: ["screen", null],
  "control.connection": ["region", "control"],
  "control.interactions": ["panel", "control"],
  "control.children": ["panel", "control"],
  "control.jobs": ["panel", "control"],
  "control.usage": ["panel", "control"],
  "control.goals": ["panel", "control"],
  deliverables: ["screen", null],
  "deliverables.connection": ["region", "deliverables"],
  "deliverables.cards": ["panel", "deliverables"],
  "deliverables.files": ["panel", "deliverables"],
  "deliverables.terminal": ["panel", "deliverables"],
  "conversation.running": ["region", null],
} as const;

/** The only fields a query answers with a value; every other declared field reports its shape. Each is a closed word, a count or a flag, never content a person wrote. */
const VALUE_FIELDS: Record<string, readonly string[]> = {
  sidebar: ["state.mobile"],
  "sidebar.connection": ["state.status"],
  "sidebar.sessions": ["state.groups", "state.projects", "state.filtered"],
  "sessions.list": ["state.groups", "state.projects", "state.filtered"],
  control: ["state.identity"],
  "control.connection": ["state.status"],
  "control.interactions": ["state.view", "state.open", "state.settled"],
  "control.children": ["state.list", "state.refreshing"],
  "control.jobs": ["state.list", "state.refreshing"],
  "control.usage": ["state.list", "state.refreshing"],
  "deliverables.connection": ["state.status"],
  "deliverables.cards": ["state.list", "state.cardCount", "state.refreshing"],
  "deliverables.files": ["state.list", "state.editedCount", "state.refreshing"],
  "conversation.running": ["state.shape", "state.phase"],
};

const fieldsOf = (descriptor: RegionDescriptor, mode: "value" | "shape") =>
  (["props", "state"] as const).flatMap((kind) =>
    descriptor[kind].filter((f) => f.report === mode).map((f) => `${kind}.${f.name}`),
  );

describe("the declared M10 regions", () => {
  it("are the regions an Aetheria component mounts, each declared once with its kind and parent", () => {
    expect([...DECLARED_REGION_IDS].toSorted()).toEqual(Object.keys(EXPECTED_REGIONS).toSorted());
    expect(REGION_DECLARATIONS.map((d) => d.id).toSorted()).toEqual(
      [...DECLARED_REGION_IDS].toSorted(),
    );
    for (const d of REGION_DECLARATIONS) {
      const [kind, parent] = EXPECTED_REGIONS[d.id as keyof typeof EXPECTED_REGIONS];
      expect({ id: d.id, kind, parent }).toEqual({ id: d.id, kind: d.kind, parent: d.parent });
    }
  });

  it("build into a manifest of module-owned regions whose parents are all declared", () => {
    const manifest = buildManifest(REGION_DECLARATIONS);
    expect(manifest.regions).toHaveLength(DECLARED_REGION_IDS.length);
    expect(manifest.regions.every((r) => r.owner === "aetheria-ui")).toBe(true);
    expect(
      manifest.regions
        .filter((r) => r.parent === null)
        .map((r) => r.id)
        .toSorted(),
    ).toEqual(["control", "conversation.running", "deliverables", "sessions", "sidebar"]);
  });

  it("report a value only for the listed status fields and the shape for everything else", () => {
    const actual = Object.fromEntries(
      REGION_DECLARATIONS.map((d) => [d.id, fieldsOf(d, "value")] as const).filter(
        ([, fields]) => fields.length > 0,
      ),
    );
    expect(actual).toEqual(VALUE_FIELDS);
    // The names alone must not say content: a path, title, message, text, query or id never reports a value.
    const contentWords =
      /path|title|message|text|name|query|search|content|reason|detail|url|token|secret|id$/i;
    for (const [region, fields] of Object.entries(VALUE_FIELDS))
      for (const field of fields)
        expect(`${region} ${field.split(".")[1]}`, `${region} ${field}`).not.toMatch(contentWords);
  });

  it("declare the identifying and typed-in fields as shape-only", () => {
    const shapes = Object.fromEntries(
      REGION_DECLARATIONS.map((d) => [d.id, fieldsOf(d, "shape")] as const).filter(
        ([, fields]) => fields.length > 0,
      ),
    );
    expect(shapes).toEqual({
      "sidebar.sessions": ["state.search"],
      "sessions.list": ["state.search"],
      control: ["props.environmentId", "props.threadId"],
      "control.interactions": ["props.rootSessionId"],
      "control.children": ["props.threadId"],
      "control.jobs": ["props.threadId"],
      "control.usage": ["props.threadId"],
      deliverables: ["props.environmentId", "props.threadId"],
      "deliverables.cards": ["props.rootThreadId"],
      "deliverables.files": ["props.rootThreadId"],
    });
  });

  it("name only design-package tokens, and none for a region that draws nothing of its own", () => {
    for (const d of REGION_DECLARATIONS) for (const t of d.tokens) expect(tokenNames).toContain(t);
    const byId = Object.fromEntries(REGION_DECLARATIONS.map((d) => [d.id, d.tokens] as const));
    expect(byId["conversation.running"]).toEqual([
      "--ae-color-brand-ink-top",
      "--ae-color-brand-ink-bottom",
      "--ae-color-brand-stalk-bottom",
      "--ae-color-brand-deep-bottom",
      "--ae-color-brand-spark",
      "--ae-running-mark",
      "--ae-running-faint",
      "--ae-motion-grain",
      "--ae-motion-loop",
      "--ae-motion-settle",
    ]);
    expect(byId["control.interactions"]).toEqual([
      "--ae-color-bg-layer",
      "--ae-color-border",
      "--ae-color-label-primary",
      "--ae-color-label-secondary",
    ]);
  });

  it("leave out T3's own surfaces, which no Aetheria component owns", () => {
    for (const gone of [
      "shell",
      "sidebar.rail",
      "drawer",
      "conversation.transcript",
      "composer",
      "panel.files",
      "panel.terminal",
      "panel.diff",
      "interactions",
      "settings",
    ])
      expect(DECLARED_REGION_IDS).not.toContain(gone);
  });
});
