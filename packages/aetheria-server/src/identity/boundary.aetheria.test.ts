// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M04 Plan step 13 — the identity module is not a writer, and reaches the pinned artifact in one place.
//
// Boundary: this folder's own sources (text), and the pinned Backend entry as installed. Shows: no source here calls a store writer
// (stage, activate, discard, retire, noteAccepted) or builds a store; the artifact is imported only by `backendEntry.ts`, only through the
// Backend entry; the exports the module takes from the archive exist on the installed archive. Does not show behaviour; the other test
// files do. A text scan cannot see a writer reached through a computed name, which is why the archive's Backend entry is also checked to
// export no store at all.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

import * as backendEntry from "@aetheria/awareness/backend";

import { BACKEND_ENTRY_NAMES } from "./backendEntry.ts";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const sources = NodeFS.readdirSync(here).filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "testkit.ts",
);
const strip = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the identity module", () => {
  it("has the sources it should", () => {
    expect(sources.sort()).toEqual([
      "backendEntry.ts",
      "feed.ts",
      "lifecycle.ts",
      "resolver.ts",
      "threadIndex.ts",
    ]);
  });

  it("calls no store writer and builds no store", () => {
    for (const file of sources) {
      const code = strip(NodeFS.readFileSync(NodePath.join(here, file), "utf8"));
      expect(code, file).not.toMatch(/\.(stage|activate|discard|retire|noteAccepted)\s*\(/);
      expect(code, file).not.toMatch(/createIdentityStore|STORE_FORMAT_VERSION/);
    }
  });

  it("imports the artifact from backendEntry.ts only, through the Backend entry, and never outer source", () => {
    const specifierPattern = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
    for (const file of sources) {
      const text = NodeFS.readFileSync(NodePath.join(here, file), "utf8");
      for (const match of text.matchAll(specifierPattern)) {
        const specifier = match[1]!;
        if (specifier.startsWith("@aetheria/"))
          expect({ file, specifier }).toEqual({
            file: "backendEntry.ts",
            specifier: "@aetheria/awareness/backend",
          });
        expect(specifier).not.toMatch(/packages\/aetheria-|apps\/aetheria|(\.\.\/){2,}/);
      }
    }
  });

  it("finds every name it takes on the installed archive, and the archive offers no writer", () => {
    for (const name of BACKEND_ENTRY_NAMES)
      expect(typeof (backendEntry as Record<string, unknown>)[name]).toBe("function");
    expect(Object.keys(backendEntry)).not.toContain("createIdentityStore");
  });

  it("keeps the lifecycle module free of the artifact so M03's store can drive it unchanged", () => {
    expect(NodeFS.readFileSync(NodePath.join(here, "lifecycle.ts"), "utf8")).not.toMatch(
      /@aetheria\//,
    );
  });
});
