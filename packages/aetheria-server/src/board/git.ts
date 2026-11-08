// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA — the Backend's Git port: the workspace's git top-level and the files Git lists as changed (restart reconciliation's input).
// `known` is Git's listing, `outside-git` is no repository or no git, and anything else — a timeout included — is `unknown`, never clean.
// The Git process is spawned here because the pinned Backend entry may import only fs, path and crypto.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { parsePorcelain, type ChangedFilesPort } from "../library.ts";

const GIT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 64 * 1024 * 1024;

/** Runs `git -C <cwd> <args>` and resolves its stdout; rejects like `execFile` (a non-zero exit carries `code` and `stderr`). */
export type GitRun = (cwd: string, args: readonly string[], timeoutMs: number) => Promise<string>;

export interface GitPort extends ChangedFilesPort {
  /** The enclosing git working tree of `cwd`, or undefined when there is none or it cannot be read. */
  topLevel(cwd: string): Promise<string | undefined>;
}

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const defaultRun: GitRun = async (cwd, args, timeoutMs) => {
  const { stdout } = await execFile("git", ["-C", cwd, ...args], {
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    encoding: "utf8",
  });
  return stdout;
};

const field = (error: unknown, key: string): unknown =>
  typeof error === "object" && error !== null ? (error as Record<string, unknown>)[key] : undefined;
const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createGit(options: { run?: GitRun; timeoutMs?: number } = {}): GitPort {
  const run = options.run ?? defaultRun;
  const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;
  const top = async (cwd: string): Promise<string> =>
    (await run(cwd, ["rev-parse", "--show-toplevel"], timeoutMs)).replace(/\r?\n$/, "");
  return {
    async topLevel(cwd) {
      try {
        const found = await top(cwd);
        return found === "" ? undefined : found;
      } catch {
        return undefined;
      }
    },
    async changedFiles(workspace) {
      let root: string;
      try {
        root = await top(workspace);
      } catch (error) {
        const notRepository =
          field(error, "code") === "ENOENT" ||
          (field(error, "code") === 128 &&
            /not a git repository/i.test(String(field(error, "stderr") ?? "")));
        return notRepository
          ? { status: "outside-git" }
          : {
              status: "unknown",
              detail: `git could not be read in ${workspace}: ${describe(error)}`,
            };
      }
      try {
        const listing = await run(
          workspace,
          ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
          timeoutMs,
        );
        return {
          status: "known",
          paths: new Set(parsePorcelain(listing).map((path) => NodePath.resolve(root, path))),
        };
      } catch (error) {
        return {
          status: "unknown",
          detail: `git status failed in ${workspace}: ${describe(error)}`,
        };
      }
    },
  };
}
