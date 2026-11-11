// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M05 Plan step 6 (D14, M06 hand-off) — production `projectRootOf`: M03's async `deriveProject` bridged to the thread index's synchronous rule by
// precomputing canonical facts for observed working folders.
//
// Boundary. The cache is tested with an injected derivation (its logic: sync read, async precompute, refresh, failure to null). The production derivation is
// tested against the REAL awareness archive's `deriveProject` and `nodeFs` over real temporary folders (a symlink alias, a Git-marked foreign project, a
// checkout that cannot be read). It does not show the thread index's use of the answer in the running Backend; service.aetheria.test.ts does that.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  createProductionProjectRootCache,
  createProjectRootCache,
  PROJECT_ROOT_CACHE_LIMIT,
} from "./projectRoot.ts";

const roots: string[] = [];
const tmp = (): string => {
  const root = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m05-root-")));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

describe("project root cache — the sync rule over an async derivation", () => {
  it("is null before a folder is observed and the derived root after, never the folder by guess", async () => {
    const cache = createProjectRootCache({ derive: async (folder) => `${folder}/root` });
    expect(cache.projectRootOf("/work/a")).toBeNull();
    expect(await cache.observe("/work/a")).toBe("/work/a/root");
    expect(cache.projectRootOf("/work/a")).toBe("/work/a/root");
    expect(cache.projectRootOf("/work/b")).toBeNull();
  });

  it("a failed, throwing or non-canonical derivation is null, and a later success replaces it", async () => {
    const answers: Array<() => Promise<string | null>> = [
      async () => null,
      async () => {
        throw new Error("denied");
      },
      async () => "relative/root",
      async () => "/a/../b",
      async () => "/ok/root/",
      async () => "/ok/root",
    ];
    const cache = createProjectRootCache({ derive: () => answers.shift()!() });
    for (let i = 0; i < 5; i += 1) {
      expect(await cache.observe("/work/a")).toBeNull();
      expect(cache.projectRootOf("/work/a")).toBeNull();
    }
    expect(await cache.observe("/work/a")).toBe("/ok/root");
    expect(cache.projectRootOf("/work/a")).toBe("/ok/root");
  });

  it("observing again re-derives (a refresh on launch or resume) and a now-failing derivation forgets the stale root", async () => {
    let answer: string | null = "/one";
    const cache = createProjectRootCache({ derive: async () => answer });
    await cache.observe("/work/a");
    expect(cache.projectRootOf("/work/a")).toBe("/one");
    answer = "/two";
    await cache.observe("/work/a");
    expect(cache.projectRootOf("/work/a")).toBe("/two");
    answer = null;
    await cache.observe("/work/a");
    expect(cache.projectRootOf("/work/a")).toBeNull();
  });

  it("shares one in-flight derivation per folder and ignores a non-absolute folder", async () => {
    let calls = 0;
    const cache = createProjectRootCache({
      derive: async () => {
        calls += 1;
        return "/r";
      },
    });
    await Promise.all([cache.observe("/work/a"), cache.observe("/work/a")]);
    expect(calls).toBe(1);
    expect(await cache.observe("relative")).toBeNull();
    expect(cache.projectRootOf("relative")).toBeNull();
    expect(calls).toBe(1);
  });

  it("is bounded: past the limit the oldest folder is forgotten (null), never a wrong root", async () => {
    const cache = createProjectRootCache({ derive: async (folder) => `${folder}/r` });
    for (let i = 0; i <= PROJECT_ROOT_CACHE_LIMIT; i += 1) await cache.observe(`/w/${i}`);
    expect(cache.projectRootOf("/w/0")).toBeNull();
    expect(cache.projectRootOf(`/w/${PROJECT_ROOT_CACHE_LIMIT}`)).toBe(
      `/w/${PROJECT_ROOT_CACHE_LIMIT}/r`,
    );
  });
});

describe("production derivation over the real awareness archive", () => {
  it("resolves an alias of a foreign Git project to its canonical root", async () => {
    const base = tmp();
    const project = NodePath.join(base, "project");
    NodeFS.mkdirSync(NodePath.join(project, ".git"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(project, "src"));
    const alias = NodePath.join(base, "alias");
    NodeFS.symlinkSync(project, alias);
    const checkout = tmp();
    const cache = createProductionProjectRootCache({ checkout });
    expect(await cache.observe(NodePath.join(alias, "src"))).toBe(project);
    expect(cache.projectRootOf(NodePath.join(alias, "src"))).toBe(project);
    expect(await cache.observe(NodePath.join(project, "src"))).toBe(project);
  });

  it("the home checkout and a foreign worktree each derive their own root", async () => {
    const base = tmp();
    const checkout = NodePath.join(base, "home");
    NodeFS.mkdirSync(NodePath.join(checkout, ".git"), { recursive: true });
    const worktree = NodePath.join(base, "worktree");
    NodeFS.mkdirSync(worktree);
    NodeFS.writeFileSync(NodePath.join(worktree, ".git"), "gitdir: /elsewhere\n");
    const cache = createProductionProjectRootCache({ checkout });
    expect(await cache.observe(checkout)).toBe(checkout);
    expect(await cache.observe(worktree)).toBe(worktree);
  });

  it("without an absolute checkout nothing is derived: unavailable, never the working folder", async () => {
    const folder = tmp();
    for (const checkout of [undefined, "relative/checkout"]) {
      const cache = createProductionProjectRootCache({ checkout });
      expect(await cache.observe(folder)).toBeNull();
      expect(cache.projectRootOf(folder)).toBeNull();
    }
  });

  it("a folder that does not exist derives no root", async () => {
    const cache = createProductionProjectRootCache({ checkout: tmp() });
    expect(await cache.observe(NodePath.join(tmp(), "gone", "deeper"))).toBeNull();
  });
});
