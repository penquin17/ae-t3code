// @effect-diagnostics nodeBuiltinImport:off - reads the module's own stylesheet.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

import { GRAIN_COUNT, SPARK, WREATH } from "./y4";

const css = NodeFS.readFileSync(
  NodeURL.fileURLToPath(new URL("./running.css", import.meta.url)),
  "utf8",
);

describe("the mark's artwork", () => {
  it("is the Y4 wreath: one stalk, two blades and thirteen grains per side, plus the spark", () => {
    expect(WREATH.filter((path) => path.part === "stalk")).toHaveLength(1);
    expect(WREATH.filter((path) => path.part === "blade")).toHaveLength(2);
    expect(GRAIN_COUNT).toBe(13);
    expect(WREATH.filter((path) => path.part === "ink")).toHaveLength(13);
    expect(SPARK).toBe(
      "M32 7.4 L33.288 10.712 L36.6 12 L33.288 13.288 L32 16.6 L30.712 13.288 L27.4 12 L30.712 10.712 Z",
    );
  });

  it("every path is a closed or open polyline of absolute commands", () => {
    for (const { d } of WREATH) expect(d).toMatch(/^M[-\d. LZ]+$/);
  });
});

describe("the stylesheet", () => {
  it("has no raw colour, only design tokens and currentColor", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch)\(/);
  });

  it("takes every timing from the motion tokens", () => {
    expect(css).toContain("var(--ae-motion-loop");
    expect(css).toContain("var(--ae-motion-grain");
    expect(css).not.toMatch(/animation[^;]*\b\d+(?:ms|s)\b/);
  });

  it("under reduced motion nothing animates and the whole mark is full", () => {
    const block =
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(block).toMatch(/animation:\s*none/);
    expect(block).toMatch(/opacity:\s*1/);
  });
});
