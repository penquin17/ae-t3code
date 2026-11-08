// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the Node filesystem build boundary.
// Added by Aetheria for IP-15 (the marked hunks are in third-party-licenses.ts): Aetheria's own
// packages are first-party for the licence check. No marker here: a marker outside the registered file is "moved".

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { generateThirdPartyLicenseManifest } from "./third-party-licenses.js";

const tempDirectories: string[] = [];

async function writeJson(path: string, value: unknown): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
  await NodeFSP.writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function createFixture(dependencies: Record<string, string>): Promise<{
  readonly appManifest: string;
  readonly configFile: string;
  readonly root: string;
}> {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-aetheria-licenses-"));
  tempDirectories.push(root);
  const appManifest = NodePath.join(root, "package.json");
  const configFile = NodePath.join(root, "third-party-licenses.config.json");
  await writeJson(appManifest, { name: "fixture-app", dependencies });
  await writeJson(configFile, { customNotices: [], packageOverrides: [] });
  return { appManifest, configFile, root };
}

/** A package with no `license` field and no notice file. */
async function writeUnlicensedPackage(root: string, name: string): Promise<string> {
  const packageRoot = NodePath.join(root, "node_modules", name);
  await writeJson(NodePath.join(packageRoot, "package.json"), {
    name,
    version: "0.0.1",
    main: "index.js",
  });
  await NodeFSP.writeFile(NodePath.join(packageRoot, "index.js"), "export {};\n", "utf8");
  return NodePath.join(packageRoot, "index.js");
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { force: true, recursive: true })),
  );
});

describe("third-party license check treats @aetheria/ packages as first-party", () => {
  it("skips a declared @aetheria/ dependency that has no licence", async () => {
    const fixture = await createFixture({ "@aetheria/awareness": "0.0.1" });
    await writeUnlicensedPackage(fixture.root, "@aetheria/awareness");

    const manifest = await generateThirdPartyLicenseManifest({
      configFile: fixture.configFile,
      packageManifests: [{ bundle: "web", path: fixture.appManifest }],
    });

    expect(manifest.entries).toEqual([]);
  });

  it("skips a bundled @aetheria/ module that has no licence", async () => {
    const fixture = await createFixture({});
    const modulePath = await writeUnlicensedPackage(fixture.root, "@aetheria/awareness");

    const manifest = await generateThirdPartyLicenseManifest({
      configFile: fixture.configFile,
      packageManifests: [{ bundle: "web", path: fixture.appManifest }],
      bundledModuleIds: [modulePath],
      bundleName: "web",
    });

    expect(manifest.entries).toEqual([]);
  });

  it("still fails an unlicensed package that is not first-party, declared or bundled", async () => {
    const declared = await createFixture({ "third-party-demo": "0.0.1" });
    await writeUnlicensedPackage(declared.root, "third-party-demo");
    await expect(
      generateThirdPartyLicenseManifest({
        configFile: declared.configFile,
        packageManifests: [{ bundle: "web", path: declared.appManifest }],
      }),
    ).rejects.toThrow("does not declare a distributable license");

    const bundled = await createFixture({});
    const modulePath = await writeUnlicensedPackage(bundled.root, "third-party-demo");
    await expect(
      generateThirdPartyLicenseManifest({
        configFile: bundled.configFile,
        packageManifests: [{ bundle: "web", path: bundled.appManifest }],
        bundledModuleIds: [modulePath],
        bundleName: "web",
      }),
    ).rejects.toThrow("does not declare a distributable license");
  });

  it("does not exempt an unscoped name that merely starts with aetheria", async () => {
    const fixture = await createFixture({ "aetheria-demo": "0.0.1" });
    await writeUnlicensedPackage(fixture.root, "aetheria-demo");
    await expect(
      generateThirdPartyLicenseManifest({
        configFile: fixture.configFile,
        packageManifests: [{ bundle: "web", path: fixture.appManifest }],
      }),
    ).rejects.toThrow("aetheria-demo@0.0.1 does not declare a distributable license");
  });
});
