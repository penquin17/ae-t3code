// @effect-diagnostics nodeBuiltinImport:off - scans the Aetheria-owned web source.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const folder = NodeURL.fileURLToPath(new URL("./", import.meta.url));
const literal = /#[0-9a-fA-F]{3,8}\b|(?<![\w.-])(?:rgba?|hsla?|oklch|oklab|color)\(/;

// measure.ts reads colours back from the browser and writes hex strings for reports; it paints nothing.
const EXEMPT = new Set(["measure.ts"]);

const ownedSource = () =>
  NodeFS.readdirSync(folder)
    .filter(
      (name) => /\.(?:ts|tsx|css)$/.test(name) && !/\.test\.tsx?$/.test(name) && !EXEMPT.has(name),
    )
    .map((name) => [name, NodeFS.readFileSync(NodePath.join(folder, name), "utf8")] as const);

describe("raw colours in Aetheria-owned web source", () => {
  it("appear nowhere: components take their colours from T3's roles and the generated layer", () => {
    const owned = ownedSource();
    expect(owned.length).toBeGreaterThan(5);
    const offenders = owned.flatMap(([name, text]) =>
      text
        .split("\n")
        .flatMap((line, index) => (literal.test(line) ? [`${name}:${index + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });

  it("use no status colour: the changed identity surfaces show names and words, never a state by colour", () => {
    const status =
      /\b(?:text|bg|border|ring|fill|stroke)-(?:error|warning|success|destructive|info)\b|--(?:error|warning|success|destructive|info)\b/;
    const offenders = ownedSource().flatMap(([name, text]) => (status.test(text) ? [name] : []));
    expect(offenders).toEqual([]);
    expect(status.test('className="text-warning"')).toBe(true);
  });

  it("is caught when one is seeded: hex, rgb, hsl, oklch and color()", () => {
    for (const seeded of [
      'const a = "#123456";',
      'x = "rgb(1 2 3)"',
      "y: hsl(10 20% 30%)",
      "z = oklch(0.5 0.1 200)",
      "c = color(srgb 1 0 0)",
    ]) {
      expect(literal.test(seeded), seeded).toBe(true);
    }
    for (const clean of [
      "const accent = 'var(--ring)'",
      "className='bg-card text-foreground'",
      "colorScheme: 'dark'",
    ]) {
      expect(literal.test(clean), clean).toBe(false);
    }
  });
});
