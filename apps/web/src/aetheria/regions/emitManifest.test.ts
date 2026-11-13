// @effect-diagnostics nodeBuiltinImport:off - runs the real generator script as a child process and reads the file it writes.
// AETHERIA M10 review 3, F2 (D17, XC-19): the build writes the manifest of declared regions with `emitManifest.mjs`. Boundary: the real script, run by Node as the build adapter runs it, over the real declarations;
// the file it writes is compared with `manifestJson(REGION_DECLARATIONS)` byte for byte. This shows the script's output and its failure on a bad call; it does not show the outer build adapter placing the file
// in the server's client folder (the outer adapter test shows the stage, and the fresh build shows the file).
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DECLARED_REGION_IDS, REGION_DECLARATIONS } from "./declarations";
import { buildManifest, manifestJson } from "./manifest";

const SCRIPT = NodeURL.fileURLToPath(new URL("./emitManifest.mjs", import.meta.url));

let dir = "";
beforeEach(() => {
  dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "region-manifest-"));
});
afterEach(() => NodeFS.rmSync(dir, { recursive: true, force: true }));

const emit = (...args: string[]) =>
  NodeChildProcess.spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

describe("the manifest generator the build runs", () => {
  it("writes exactly the manifest of the declared regions, creating the folders on the way", () => {
    const out = NodePath.join(dir, "client", "aetheria", "region-manifest.json");
    const ran = emit(out);
    expect(ran.status, ran.stderr).toBe(0);
    const written = NodeFS.readFileSync(out, "utf8");
    expect(written).toBe(manifestJson(REGION_DECLARATIONS));
    const parsed = JSON.parse(written) as { regions: Array<{ id: string }> };
    expect(parsed).toEqual(JSON.parse(JSON.stringify(buildManifest(REGION_DECLARATIONS))));
    expect(parsed.regions.map((r) => r.id).toSorted()).toEqual([...DECLARED_REGION_IDS].toSorted());
  });

  it("writes the same bytes on every run and replaces a stale file", () => {
    const out = NodePath.join(dir, "region-manifest.json");
    NodeFS.writeFileSync(out, '{"stale":true}\n');
    expect(emit(out).status).toBe(0);
    const first = NodeFS.readFileSync(out, "utf8");
    expect(emit(out).status).toBe(0);
    expect(NodeFS.readFileSync(out, "utf8")).toBe(first);
    expect(first).toBe(manifestJson(REGION_DECLARATIONS));
  });

  it("fails, and writes nothing, when it is not told where to write", () => {
    const ran = emit();
    expect(ran.status).not.toBe(0);
    expect(ran.stderr).toMatch(/usage/i);
    expect(NodeFS.readdirSync(dir)).toEqual([]);
  });
});
