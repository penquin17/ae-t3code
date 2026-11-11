// @effect-diagnostics nodeBuiltinImport:off - reads the web app's own source files.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const srcDir = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const STYLESHEET_IMPORT = 'import "@t3tools/aetheria-design/aetheria.css";';

function sourceFiles(dir: string): string[] {
  return NodeFS.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = NodePath.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "aetheria" ? [] : sourceFiles(full);
    return /\.(?:ts|tsx|css)$/.test(entry.name) ? [full] : [];
  });
}

describe("the Aetheria stylesheet entry", () => {
  const main = NodeFS.readFileSync(NodePath.join(srcDir, "main.tsx"), "utf8");

  it("is imported once, right after T3's own stylesheet and its bundled font", () => {
    expect(main).toContain(
      `import "@fontsource-variable/inter";\nimport "./index.css";\n${STYLESHEET_IMPORT}`,
    );
    expect(main.split(STYLESHEET_IMPORT)).toHaveLength(2);
  });

  it("is imported nowhere else in the app", () => {
    const importers = sourceFiles(srcDir).filter((file) =>
      NodeFS.readFileSync(file, "utf8").includes("aetheria-design/aetheria.css"),
    );
    expect(importers.map((file) => NodePath.relative(srcDir, file))).toEqual(["main.tsx"]);
  });

  it("carries the registered marker only in main.tsx and keeps it out of this folder", () => {
    // Built from parts: the registry check reads every committed file for the token.
    const marker = ["AETHERIA-IP", "IP-27"].join(":");
    expect(main.split(marker)).toHaveLength(2);
    const folder = NodePath.join(srcDir, "aetheria");
    for (const entry of NodeFS.readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|tsx|css)$/.test(entry.name)) continue;
      expect(
        NodeFS.readFileSync(NodePath.join(folder, entry.name), "utf8"),
        entry.name,
      ).not.toContain(marker);
    }
  });

  it("adds no web font: T3's bundled Inter import stays the only font import", () => {
    expect(main.match(/@fontsource/g)).toHaveLength(1);
  });
});
