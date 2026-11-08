// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M04 Plan step 20 — the Backend's Git port. Boundary: its answers for scripted `git` failures (a named double for the process) and for
// one real repository. It shows known / outside-git / unknown (never clean) and the top-level lookup; it does not show Git's own status rules.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { createGit, type GitRun } from "./git.ts";

const created: string[] = [];
afterAll(() => {
  for (const dir of created.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});
const failure = (fields: Record<string, unknown>, message = "git failed"): Error =>
  Object.assign(new Error(message), fields);

describe("changedFiles with a scripted process", () => {
  it("lists the changed paths against the top-level, both sides of a rename", async () => {
    const run: GitRun = async (_cwd, args) =>
      args[0] === "rev-parse" ? "/repo\n" : "R  new name.txt\0old.txt\0?? dir/u.txt\0";
    expect(await createGit({ run }).changedFiles("/repo/sub")).toEqual({
      status: "known",
      paths: new Set(["/repo/new name.txt", "/repo/old.txt", "/repo/dir/u.txt"]),
    });
  });

  it("is outside git for no repository or no git, and unknown — never clean — for anything else", async () => {
    const reject =
      (error: Error): GitRun =>
      async () => {
        throw error;
      };
    const outside = [
      failure({ code: 128, stderr: "fatal: not a git repository" }),
      failure({ code: "ENOENT" }),
    ];
    for (const error of outside)
      expect(await createGit({ run: reject(error) }).changedFiles("/w")).toEqual({
        status: "outside-git",
      });
    for (const error of [failure({ killed: true }, "timed out"), failure({ code: 1 }, "boom")])
      expect(await createGit({ run: reject(error) }).changedFiles("/w")).toMatchObject({
        status: "unknown",
      });
    const statusFails: GitRun = async (_cwd, args) => {
      if (args[0] === "rev-parse") return "/w\n";
      throw failure({ killed: true }, "status timed out");
    };
    expect(await createGit({ run: statusFails }).changedFiles("/w")).toMatchObject({
      status: "unknown",
    });
  });

  it("answers the top-level, or undefined when git cannot", async () => {
    expect(await createGit({ run: async () => "/repo\n" }).topLevel("/repo/a")).toBe("/repo");
    const none: GitRun = async () => {
      throw failure({ code: 128 });
    };
    expect(await createGit({ run: none }).topLevel("/x")).toBeUndefined();
  });
});

describe("changedFiles with a real repository", () => {
  it("reports an untracked file as changed and a plain folder as outside git", async () => {
    const root = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ae-git-")));
    created.push(root);
    const repo = NodePath.join(root, "repo");
    NodeFS.mkdirSync(repo);
    NodeChildProcess.execFileSync("git", ["init", "-q"], { cwd: repo });
    NodeFS.writeFileSync(NodePath.join(repo, "u.txt"), "x");
    const git = createGit();
    expect(await git.changedFiles(repo)).toEqual({
      status: "known",
      paths: new Set([NodePath.join(repo, "u.txt")]),
    });
    expect(await git.topLevel(repo)).toBe(repo);
    const plain = NodePath.join(root, "plain");
    NodeFS.mkdirSync(plain);
    expect(await git.changedFiles(plain)).toEqual({ status: "outside-git" });
  });
});
