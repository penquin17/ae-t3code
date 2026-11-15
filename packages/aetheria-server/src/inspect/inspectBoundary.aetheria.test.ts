// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M11 Plan steps 8–10 (C2, C7) — the inspection module's archive boundary.
//
// Boundary: the source files of this folder and the installed `@aetheria/inspect` Backend entry. It shows that the archive is reached from `inspectEntry.ts` only, through `/backend`, with no
// outer-source path, that every name the folder takes exists on the installed archive, and that no file here calls a method that could write, spawn or invoke. It does NOT show the archive's own behavior.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as backendEntry from "@aetheria/inspect/backend";
import { describe, expect, it } from "vite-plus/test";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const sources = NodeFS.readdirSync(here).filter((f) => f.endsWith(".ts") && !f.includes(".test."));

describe("the archive boundary", () => {
  it("is reached from inspectEntry.ts only, through the Backend entry, and never by an outer-source path", () => {
    const specifierPattern = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
    for (const file of sources) {
      const text = NodeFS.readFileSync(NodePath.join(here, file), "utf8");
      for (const match of text.matchAll(specifierPattern)) {
        const specifier = match[1] as string;
        if (specifier.startsWith("@aetheria/"))
          expect({ file, specifier }).toEqual({
            file: "inspectEntry.ts",
            specifier: "@aetheria/inspect/backend",
          });
        expect(specifier).not.toMatch(/packages\/aetheria-|apps\/aetheria|(\.\.\/){3,}/);
      }
    }
  });

  it("finds every runtime name inspectEntry.ts takes on the installed archive", () => {
    const text = NodeFS.readFileSync(NodePath.join(here, "inspectEntry.ts"), "utf8");
    const block = /export \{([^}]*)\} from "@aetheria\/inspect\/backend"/.exec(text)?.[1] ?? "";
    const names = block
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n !== "");
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) expect(name in backendEntry, name).toBe(true);
  });

  it("calls no method that could write, spawn or invoke a service", () => {
    for (const file of sources) {
      const code = NodeFS.readFileSync(NodePath.join(here, file), "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(code, file).not.toMatch(
        /\b(writeFile|appendFile|rmSync|unlink|spawn|exec|execSync|fork)\s*\(/,
      );
      expect(code, file).not.toMatch(/node:(fs|child_process)/);
    }
  });
});
