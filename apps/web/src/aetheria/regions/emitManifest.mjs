// The build's manifest generator (M10 review 3, F2; D17, XC-19): `node emitManifest.mjs <output file>` writes `manifestJson(REGION_DECLARATIONS)`, the manifest of the declared regions, to the file named, creating
// its folders. The fresh build runs it after the web build and puts the file beside the client the Backend serves (apps/server/dist/client/aetheria/region-manifest.json). It loads the TypeScript declarations through
// Vite's own module runner, so it needs no compiled copy and no tool beyond the ones the fork already has; it edits no T3 file. It fails — exit 1, naming the reason, and leaving the output file alone when the
// manifest cannot be built (a duplicate id, an undeclared parent, a parent cycle) — and it reads the file back and refuses to finish if it differs from what it meant to write.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { runnerImport } from "vite-plus";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const webRoot = NodePath.resolve(here, "../../..");

const target = process.argv[2];
if (process.argv.length !== 3 || target === undefined || target === "") {
  console.error("usage: node emitManifest.mjs <output file>");
  process.exit(1);
}

try {
  const load = async (file) =>
    (
      await runnerImport(NodePath.resolve(here, file), {
        configFile: false,
        root: webRoot,
        logLevel: "error",
      })
    ).module;
  const { REGION_DECLARATIONS } = await load("declarations.ts");
  const { manifestJson } = await load("manifest.ts");
  const text = manifestJson(REGION_DECLARATIONS);
  const out = NodePath.resolve(target);
  NodeFS.mkdirSync(NodePath.dirname(out), { recursive: true });
  const partial = `${out}.partial`;
  NodeFS.writeFileSync(partial, text);
  NodeFS.renameSync(partial, out);
  if (NodeFS.readFileSync(out, "utf8") !== text)
    throw new Error(`${out} does not hold the manifest that was written`);
} catch (error) {
  console.error(`region manifest not written: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
