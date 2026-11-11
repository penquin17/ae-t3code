// @effect-diagnostics nodeBuiltinImport:off - reads the package's own files to check them.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

import * as design from "../src/index.ts";

const packageRoot = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const read = (...parts: string[]) =>
  NodeFS.readFileSync(NodePath.join(packageRoot, ...parts), "utf8");

// Canonical-JSON SHA-256 (sorted keys, no whitespace) of the one-time port of
// dsh/packages/aetheria-design/tokens/aetheria.tokens.json at outer commit 875f88ad, whose own byte hash is
// 39d2cbf54c9cdca4dda035b489926c747073b282db7c76d06d88cd92327ffa08. The fork's formatter rewrites the copy's
// whitespace on commit, so the pinned hash is of the content, not of the bytes.
const PORTED_TOKEN_CANONICAL_SHA256 =
  "d4f1251ded833f262ff4d6a090f2e84f31f0ea101af1a402458cd125a32bc054";

const FOREGROUND_ON_PRIMARY = "semantic.color.label.primary";
const HOVER = "semantic.opacity.hover";

// T3 variable, Aetheria source, light value, dark value (an overlay is the role at the opacity token).
const EXPECTED_MAPPING: ReadonlyArray<readonly [string, string, string | null, string, string]> = [
  ["--background", "semantic.color.bg.base", null, "#FFFFFF", "#0F172A"],
  ["--foreground", FOREGROUND_ON_PRIMARY, null, "#0F172A", "#F8FAFC"],
  ["--card", "semantic.color.bg.layer", null, "#F8FAFC", "#1E293B"],
  ["--card-foreground", FOREGROUND_ON_PRIMARY, null, "#0F172A", "#F8FAFC"],
  ["--popover", "semantic.color.bg.overlay", null, "#FFFFFF", "#1E293B"],
  ["--popover-foreground", FOREGROUND_ON_PRIMARY, null, "#0F172A", "#F8FAFC"],
  ["--primary", "semantic.color.accent", null, "#2563EB", "#60A5FA"],
  ["--primary-foreground", "semantic.color.accent.fg", null, "#FFFFFF", "#0A1020"],
  ["--secondary", "semantic.color.bg.layer", null, "#F8FAFC", "#1E293B"],
  ["--secondary-foreground", FOREGROUND_ON_PRIMARY, null, "#0F172A", "#F8FAFC"],
  ["--muted", "semantic.color.bg.layer", null, "#F8FAFC", "#1E293B"],
  ["--muted-foreground", "semantic.color.label.secondary", null, "#64748B", "#CBD5E1"],
  ["--secondary-label", "semantic.color.label.secondary", null, "#64748B", "#CBD5E1"],
  ["--surface-raised", "semantic.color.bg.layer", null, "#F8FAFC", "#1E293B"],
  ["--accent", FOREGROUND_ON_PRIMARY, HOVER, "#0F172A14", "#F8FAFC14"],
  ["--accent-foreground", FOREGROUND_ON_PRIMARY, null, "#0F172A", "#F8FAFC"],
  ["--border", "semantic.color.border", null, "#E2E8F0", "#334155"],
  ["--input", "semantic.color.border", null, "#E2E8F0", "#334155"],
  ["--ring", "semantic.color.accent", null, "#2563EB", "#60A5FA"],
  ["--message-surface", FOREGROUND_ON_PRIMARY, HOVER, "#0F172A14", "#F8FAFC14"],
  ["--message-foreground", FOREGROUND_ON_PRIMARY, null, "#0F172A", "#F8FAFC"],
  ["--error", "semantic.color.state.error", null, "#DC2626", "#EF4444"],
  ["--warning", "semantic.color.state.warning", null, "#D97706", "#F59E0B"],
  ["--success", "semantic.color.state.success", null, "#16A34A", "#22C55E"],
  ["--sidebar", "semantic.color.bg.layer", null, "#F8FAFC", "#1E293B"],
  ["--sidebar-foreground", FOREGROUND_ON_PRIMARY, null, "#0F172A", "#F8FAFC"],
  ["--sidebar-muted-foreground", "semantic.color.label.secondary", null, "#64748B", "#CBD5E1"],
  ["--sidebar-control-surface", "semantic.color.bg.base", null, "#FFFFFF", "#0F172A"],
  ["--sidebar-row-hover", "semantic.color.bg.base", null, "#FFFFFF", "#0F172A"],
  ["--sidebar-row-active", "semantic.color.bg.base", null, "#FFFFFF", "#0F172A"],
  ["--sidebar-row-selected", "semantic.color.bg.base", null, "#FFFFFF", "#0F172A"],
  ["--sidebar-border", "semantic.color.border", null, "#E2E8F0", "#334155"],
];

/** The JSON value with keys sorted at every level and no whitespace: the same hash however the file is formatted. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const canonicalSha256 = (value: unknown) =>
  NodeCrypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

describe("the ported token source", () => {
  const source: unknown = JSON.parse(read("tokens", "aetheria.tokens.json"));

  it("carries the one-time port's content, historical font and DSH metadata included, however it is formatted", () => {
    expect(canonicalSha256(source)).toBe(PORTED_TOKEN_CANONICAL_SHA256);
  });

  it("notices a changed value, a removed key and a reordered list", () => {
    const edit = (change: (copy: Record<string, any>) => void) => {
      const copy = JSON.parse(JSON.stringify(source)) as Record<string, any>;
      change(copy);
      return canonicalSha256(copy);
    };
    expect(edit(() => {})).toBe(PORTED_TOKEN_CANONICAL_SHA256);
    expect(edit((copy) => (copy.primitive.blue["600"].$value = "#2563EC"))).not.toBe(
      PORTED_TOKEN_CANONICAL_SHA256,
    );
    expect(edit((copy) => delete copy.semantic.font)).not.toBe(PORTED_TOKEN_CANONICAL_SHA256);
    expect(edit((copy) => copy.semantic.color.bg.base.$extensions.aetheria.dsw.push("x"))).not.toBe(
      PORTED_TOKEN_CANONICAL_SHA256,
    );
  });

  it("is independent of key order and whitespace", () => {
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .reverse()
            .map(([key, child]) => [key, reverseKeys(child)]),
        );
      }
      return value;
    };
    const reordered = JSON.stringify(reverseKeys(source), null, 7);
    expect(reordered).not.toBe(JSON.stringify(source, null, 2));
    expect(canonicalSha256(JSON.parse(reordered))).toBe(canonicalSha256(source));
  });
});

describe("the package exports", () => {
  it("are exactly the plain names, values, mapping and contrast helpers", () => {
    expect(Object.keys(design).sort()).toEqual([
      "compositeOver",
      "contrastRatio",
      "keptT3Variables",
      "mappedPairs",
      "notClaimedPairs",
      "pairRatio",
      "parseColor",
      "t3Mapping",
      "t3Resolved",
      "tokenNames",
      "tokenValues",
    ]);
  });

  it("lists every declared --ae variable, and only those, in tokenNames", () => {
    const css = read("src", "generated", "aetheria.css");
    const declared = new Set([...css.matchAll(/(--ae-[a-z0-9-]+):/g)].map((match) => match[1]));
    expect([...declared].sort()).toEqual([...design.tokenNames].sort());
    expect(Object.keys(design.tokenValues).sort()).toEqual([...design.tokenNames].sort());
  });

  it("keeps primitives out of the names and tiers out of every name", () => {
    for (const name of design.tokenNames) {
      expect(name).not.toMatch(/^--ae-(?:p-|primitive|semantic|component)/);
    }
    expect(design.tokenNames).toContain("--ae-color-bg-base");
    expect(design.tokenNames).toContain("--ae-color-accent-fg");
    expect(design.tokenNames).toContain("--ae-opacity-hover");
  });
});

describe("the T3 mapping", () => {
  it.each(EXPECTED_MAPPING)("maps %s to %s", (variable, role, overlay, light, dark) => {
    const entry = design.t3Mapping.find((candidate) => candidate.variable === variable);
    expect(entry, `${variable} is not mapped`).toBeDefined();
    expect(entry!.role).toBe(role);
    expect(entry!.overlay ?? null).toBe(overlay);
    expect(entry!.consumer.length).toBeGreaterThan(10);
    expect(design.t3Resolved[variable]).toEqual({ light, dark });
  });

  it("maps no T3 variable beyond the table, and none twice", () => {
    const variables = design.t3Mapping.map((entry) => entry.variable);
    expect(new Set(variables).size).toBe(variables.length);
    expect([...variables].sort()).toEqual(EXPECTED_MAPPING.map((row) => row[0]).sort());
  });

  it("keeps the listed T3-only variables unmapped and unchanged", () => {
    const mapped = new Set(design.t3Mapping.map((entry) => entry.variable));
    expect(design.keptT3Variables.length).toBeGreaterThan(10);
    for (const kept of design.keptT3Variables) {
      expect(mapped.has(kept.variable), kept.variable).toBe(false);
      expect(kept.reason.length).toBeGreaterThan(10);
    }
  });

  it("maps no geometry: T3's radius already equals the one same-meaning Aetheria value", () => {
    expect(design.tokenValues["--ae-radius-md"]).toEqual({ light: "8px", dark: "8px" });
    expect(
      design.t3Mapping.some((entry) => /^--(?:radius|control-radius|spacing)/.test(entry.variable)),
    ).toBe(false);
  });
});

describe("the guideline", () => {
  const guideline = read("DESIGN.md");

  it("names only tokens the stylesheet declares", () => {
    const named = new Set(guideline.match(/--ae-[a-z0-9]+(?:-[a-z0-9]+)*/g));
    expect(named.size).toBeGreaterThan(10);
    const declared = new Set<string>(design.tokenNames);
    expect([...named].filter((name) => !declared.has(name))).toEqual([]);
  });

  it("carries no DSH mounting or variable-mapping instruction", () => {
    expect(guideline).not.toMatch(/--dsw|--dsh|acquire|plugin/i);
  });
});

describe("the consumed stylesheet", () => {
  const css = read("src", "generated", "aetheria.css");
  const gate = ':root:not([data-theme-id]):not([data-theme-id=""])';

  it("holds no font variable, DSH variable, import, url or important flag", () => {
    expect(css).not.toMatch(/--ae-font|font-family|--dsw|--dsh|--ae-transcript/);
    expect(css).not.toMatch(/@import|url\(|!important/);
  });

  it("gates every T3 variable to the default appearance, the sidebar subtree included", () => {
    expect(css).toContain(`${gate},\n${gate} [data-app-sidebar] {`);
    const block = css.slice(css.indexOf(`${gate},`));
    const declared = [...block.matchAll(/^\s+(--[a-z0-9-]+):/gm)].map((match) => match[1]);
    expect(declared.sort()).toEqual(design.t3Mapping.map((entry) => entry.variable).sort());
    // Outside the gated block only the --ae namespace is declared.
    const outside = css.slice(0, css.indexOf(`${gate},`));
    for (const match of outside.matchAll(/^\s+(--[a-z0-9-]+):/gm)) {
      expect(match[1]).toMatch(/^--ae-/);
    }
  });

  it("never names a custom palette: no data-theme-id selector without the empty/absent gate", () => {
    const selectors = [...css.matchAll(/data-theme-id[^\]]*\]/g)].map((match) => match[0]);
    expect(
      selectors.every(
        (selector) => selector === "data-theme-id]" || selector === 'data-theme-id=""]',
      ),
    ).toBe(true);
  });

  it("switches --ae values with the dark class and zeroes motion under reduced motion", () => {
    expect(css).toContain(":root {\n");
    expect(css).toContain(":root.dark {\n");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const name of ["fast", "slow", "grain", "loop", "settle"]) {
      expect(reduced).toMatch(new RegExp(`--ae-motion-${name}:\\s*0ms;`));
    }
    expect(reduced).not.toContain("--ae-running");
  });
});

describe("raw colours", () => {
  const literal = /#[0-9a-fA-F]{3,8}\b|(?<![\w.-])(?:rgba?|hsla?|oklch|color)\(/;

  function files(dir: string): string[] {
    return NodeFS.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = NodePath.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "generated" ? [] : files(full);
      return /\.(?:ts|css|mjs)$/.test(entry.name) ? [full] : [];
    });
  }

  it("appear only in the generated folder and the token source", () => {
    const scanned = [
      ...files(NodePath.join(packageRoot, "src")),
      ...files(NodePath.join(packageRoot, "scripts")),
    ];
    expect(scanned.length).toBeGreaterThan(3);
    const offenders: string[] = [];
    for (const file of scanned) {
      NodeFS.readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (literal.test(line))
            offenders.push(`${NodePath.relative(packageRoot, file)}:${index + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("mapped contrast, both modes", () => {
  const modes = ["light", "dark"] as const;

  it("has pairs for text, controls, sidebar states and state indicators", () => {
    expect(design.mappedPairs.length).toBeGreaterThanOrEqual(25);
    expect(design.mappedPairs.some((pair) => pair.minimum === 3)).toBe(true);
    expect(design.mappedPairs.some((pair) => pair.minimum === 4.5)).toBe(true);
  });

  it("claims text on the composer's raised surface, which T3 reads in dark mode", () => {
    for (const foreground of ["--foreground", "--muted-foreground"]) {
      const claimed = design.mappedPairs.find(
        (pair) => pair.foreground === foreground && pair.background === "--surface-raised",
      );
      expect(claimed, `${foreground} on --surface-raised`).toBeDefined();
      expect(claimed!.minimum).toBe(4.5);
    }
  });

  it.each(modes)("meets each claimed minimum in %s mode", (mode) => {
    const failures = design.mappedPairs
      .map((pair) => ({ pair, ratio: design.pairRatio(pair, mode) }))
      .filter(({ pair, ratio }) => ratio < pair.minimum)
      .map(
        ({ pair, ratio }) =>
          `${pair.consumer}: ${pair.foreground} on ${pair.background} = ${ratio.toFixed(2)} (< ${pair.minimum})`,
      );
    expect(failures).toEqual([]);
  });

  it("names a real consumer for every pair and uses only mapped T3 variables", () => {
    const mapped = new Set(design.t3Mapping.map((entry) => entry.variable));
    for (const pair of [...design.mappedPairs, ...design.notClaimedPairs]) {
      expect(pair.consumer.length).toBeGreaterThan(10);
      expect(mapped.has(pair.foreground), pair.foreground).toBe(true);
      expect(mapped.has(pair.background), pair.background).toBe(true);
    }
  });

  it("lists, with measured failures, every pair it does not claim", () => {
    expect(design.notClaimedPairs.length).toBeGreaterThan(0);
    for (const pair of design.notClaimedPairs) {
      const failing = modes.some((mode) => design.pairRatio(pair, mode) < pair.minimum);
      expect(failing, `${pair.foreground} on ${pair.background} passes; claim it instead`).toBe(
        true,
      );
      expect(
        design.mappedPairs.some(
          (claimed) =>
            claimed.foreground === pair.foreground &&
            claimed.background === pair.background &&
            claimed.over === pair.over,
        ),
      ).toBe(false);
    }
  });

  it("composites a translucent background over the surface it sits on", () => {
    const base = design.parseColor("#FFFFFF");
    const overlay = design.parseColor("#0F172A14");
    const composite = design.compositeOver(overlay, base);
    expect(composite.a).toBe(1);
    expect(composite.r).toBeLessThan(255);
    expect(composite.r).toBeGreaterThan(220);
    expect(design.contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });
});
