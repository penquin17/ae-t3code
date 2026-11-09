// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// AETHERIA — the Backend's state-root owner lock (user decision F1, step 29): one owner-only file, `<stateRoot>/backend-owner.lock`, taken at start and released at dispose.
// A live, unobservable, foreign or unreadable holder refuses the start; only a holder proven dead for 10 000 ms is taken over (step 8's rule, kept here because the Backend entry may not export it).
// Published atomically (private file hard-linked into place), single attempt, no waiting; takeover is serialised by `<lock>.reclaim`. Plain Node: the server layer wraps it where it needs Effect.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export const OWNER_LOCK_FILE = "backend-owner.lock";
/** The time a proved-dead holder's lock must have existed before it is taken over. Not a deadline for anything. */
const OWNER_LOCK_STALE_AFTER_MS = 10_000;

export type ProcessState =
  | { readonly state: "gone" }
  | { readonly state: "alive"; readonly startToken: string | null }
  | { readonly state: "unknown" };

/** How the lock decides whether a holder is alive. Injected so tests can script death, pid reuse and unobservability. */
export interface ProcessProbe {
  inspect(pid: number): Promise<ProcessState>;
}

export interface OwnerIdentity {
  readonly pid: number;
  /** Differs between two processes that had the same pid at different times (the process start time); null when it cannot be read. */
  readonly startToken: string | null;
  readonly host: string;
}

export interface OwnerLockOptions {
  /** A normalised absolute path; it is created (owner-only) when absent. */
  readonly stateRoot: string;
  /** The composition digest, recorded for an operator. */
  readonly digest?: string;
  readonly now?: () => number;
  readonly staleAfterMs?: number;
  readonly probe?: ProcessProbe;
  readonly self?: OwnerIdentity;
}

export interface HeldOwnerLock {
  readonly path: string;
  readonly nonce: string;
  /** Remove the lock only if it still names this holder. Idempotent; never removes a successor's lock. */
  release(): void;
}

export type OwnerLockResult =
  | { readonly ok: true; readonly lock: HeldOwnerLock }
  | {
      readonly ok: false;
      /** `state-root-owned`: a holder that lives or cannot be shown dead. `state-root-lock-unusable`: the lock or the state root cannot be read or written. */
      readonly code: "state-root-owned" | "state-root-lock-unusable";
      readonly detail: string;
    };

interface LockMeta {
  readonly v: 1;
  readonly kind: "aetheria-backend-owner";
  readonly nonce: string;
  readonly createdAtMs: number;
  readonly owner: OwnerIdentity;
  readonly digest: string;
}

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const run = (
  file: string,
  args: readonly string[],
): Promise<{ readonly code: number | string | null; readonly stdout: string }> =>
  new Promise((resolve) => {
    NodeChildProcess.execFile(
      file,
      [...args],
      { timeout: 3000, env: { ...process.env, LC_ALL: "C" } },
      (error, stdout) => {
        resolve({
          code: error === null ? 0 : ((error as { code?: number | string }).code ?? null),
          stdout: String(stdout),
        });
      },
    );
  });

/** Linux: `/proc/<pid>/stat` field 22 (start time in ticks) is the token; state `Z` or `X` is dead. Null when `/proc` cannot answer. */
async function procState(pid: number): Promise<ProcessState | null> {
  let stat: string;
  try {
    stat = await NodeFS.promises.readFile(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    if (errorCode(error) !== "ENOENT") return null;
    // No `/proc/<pid>` means the process is gone only where `/proc` exists at all; elsewhere the answer comes from `ps`.
    const hasProc = await NodeFS.promises.readFile("/proc/self/stat", "utf8").then(
      () => true,
      () => false,
    );
    return hasProc ? { state: "gone" } : null;
  }
  const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  if (after[0] === "Z" || after[0] === "X") return { state: "gone" };
  const start = after[19];
  return {
    state: "alive",
    startToken: start === undefined || start === "" ? null : `proc:${start}`,
  };
}

/** The real probe: `kill(pid, 0)` says whether the pid exists; `/proc` or `ps` gives its start time as the incarnation token. */
export function nodeProcessProbe(): ProcessProbe {
  return {
    async inspect(pid) {
      if (!Number.isInteger(pid) || pid <= 0) return { state: "unknown" };
      try {
        process.kill(pid, 0);
      } catch (error) {
        const code = errorCode(error);
        if (code === "ESRCH") return { state: "gone" };
        if (code !== "EPERM") return { state: "unknown" };
      }
      const proc = await procState(pid);
      if (proc !== null) return proc;
      const ps = await run("ps", ["-o", "stat=", "-o", "lstart=", "-p", String(pid)]);
      const line = ps.stdout.trim();
      if (line === "")
        return ps.code === 1 ? { state: "gone" } : { state: "alive", startToken: null };
      const [status = "", ...started] = line.split(/\s+/);
      if (status.startsWith("Z")) return { state: "gone" };
      return {
        state: "alive",
        startToken: started.length === 0 ? null : `ps:${started.join(" ")}`,
      };
    },
  };
}

/** This process's identity: pid, the start token an outside observer computes for it, and the host name. */
async function selfIdentity(probe: ProcessProbe): Promise<OwnerIdentity> {
  const seen = await probe.inspect(process.pid);
  return {
    pid: process.pid,
    startToken: seen.state === "alive" ? seen.startToken : null,
    host: NodeOS.hostname(),
  };
}

type ReadResult =
  | { readonly kind: "ok"; readonly meta: LockMeta }
  | { readonly kind: "missing" }
  | { readonly kind: "unusable"; readonly why: string };

function validMeta(value: unknown): value is LockMeta {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Partial<LockMeta>;
  const o = m.owner as Partial<OwnerIdentity> | undefined;
  return (
    m.v === 1 &&
    m.kind === "aetheria-backend-owner" &&
    typeof m.nonce === "string" &&
    typeof m.createdAtMs === "number" &&
    Number.isFinite(m.createdAtMs) &&
    typeof o === "object" &&
    o !== null &&
    typeof o.pid === "number" &&
    Number.isInteger(o.pid) &&
    typeof o.host === "string" &&
    (o.startToken === null || typeof o.startToken === "string")
  );
}

/** Only a regular file is read (a symbolic link or a folder at the name is never followed); anything unparsable is `unusable`, never "dead". */
function readMeta(path: string): ReadResult {
  try {
    const stat = NodeFS.lstatSync(path);
    if (!stat.isFile()) return { kind: "unusable", why: "it is not a regular file" };
    const parsed: unknown = JSON.parse(NodeFS.readFileSync(path, "utf8"));
    return validMeta(parsed)
      ? { kind: "ok", meta: parsed }
      : { kind: "unusable", why: "its content is not a lock this Backend wrote" };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { kind: "missing" };
    return { kind: "unusable", why: `it cannot be read (${messageOf(error)})` };
  }
}

/** Write the content to a private name, then hard-link it onto `path`: the file appears whole or not at all, and an existing `path` is never replaced. */
function publish(path: string, meta: LockMeta): "created" | "exists" {
  const staging = `${path}.${meta.nonce}.new`;
  NodeFS.writeFileSync(staging, JSON.stringify(meta), { flag: "wx", mode: 0o600 });
  try {
    NodeFS.linkSync(staging, path);
    return "created";
  } catch (error) {
    if (errorCode(error) === "EEXIST") return "exists";
    throw error;
  } finally {
    try {
      NodeFS.unlinkSync(staging);
    } catch {
      /* the private name is already gone */
    }
  }
}

/** Remove `path` only if it still names `nonce`: rename it aside, read it, and put it back if it was somebody else's. */
function removeIfStill(path: string, nonce: string): void {
  const aside = `${path}.${NodeCrypto.randomBytes(6).toString("hex")}.aside`;
  try {
    NodeFS.renameSync(path, aside);
  } catch {
    return;
  }
  const seen = readMeta(aside);
  try {
    if (seen.kind === "ok" && seen.meta.nonce === nonce) {
      NodeFS.unlinkSync(aside);
      return;
    }
    NodeFS.linkSync(aside, path);
    NodeFS.unlinkSync(aside);
  } catch {
    /* a successor already took the name, or the aside is gone: nothing of ours is left to remove */
  }
}

interface Context {
  readonly probe: ProcessProbe;
  readonly now: () => number;
  readonly bound: number;
  readonly self: OwnerIdentity;
}
type Judgement =
  | { readonly reclaimable: true }
  | { readonly reclaimable: false; readonly detail: string };

/** Reclaimable only when the holder is on this host, PROVEN dead (gone, or alive with another start token) and the lock is at least `bound` old. */
async function judge(meta: LockMeta, ctx: Context): Promise<Judgement> {
  const who = `pid ${meta.owner.pid}`;
  const no = (detail: string): Judgement => ({ reclaimable: false, detail });
  if (meta.owner.host !== ctx.self.host)
    return no(
      `the lock is held by a process on another host (${meta.owner.host}); whether it is alive cannot be observed from here`,
    );
  const seen = await ctx.probe.inspect(meta.owner.pid);
  if (seen.state === "unknown")
    return no(`the lock holder (${who}) cannot be observed, so it is not treated as dead`);
  if (seen.state === "alive") {
    const recorded = meta.owner.startToken;
    if (recorded === null || seen.startToken === null)
      return no(
        `the lock is held by ${who}, which is alive or cannot be proved dead (no start token to compare)`,
      );
    if (recorded === seen.startToken) return no(`the lock is held by a live process (${who})`);
    // The pid now belongs to a different process: the recorded holder is gone.
  }
  const age = ctx.now() - meta.createdAtMs;
  if (age < ctx.bound)
    return no(
      `the lock holder (${who}) is gone, but its lock is only ${Math.max(0, age)} ms old; it is taken over after ${ctx.bound} ms`,
    );
  return { reclaimable: true };
}

/** Serialised takeover of a proved-dead holder's lock. Returns null when the lock is gone (the caller publishes its own), or why it is still held. */
async function reclaim(path: string, stale: LockMeta, ctx: Context): Promise<string | null> {
  const guardPath = `${path}.reclaim`;
  const guard: LockMeta = {
    ...stale,
    nonce: NodeCrypto.randomBytes(12).toString("hex"),
    createdAtMs: ctx.now(),
    owner: ctx.self,
  };
  let made = publish(guardPath, guard);
  if (made === "exists") {
    const other = readMeta(guardPath);
    if (other.kind === "ok" && (await judge(other.meta, ctx)).reclaimable) {
      removeIfStill(guardPath, other.meta.nonce);
      made = publish(guardPath, guard);
    }
    if (made === "exists") return "another process is taking this lock over";
  }
  try {
    const again = readMeta(path);
    if (again.kind === "missing") return null;
    if (again.kind === "unusable" || again.meta.nonce !== stale.nonce)
      return "the lock changed while it was being taken over";
    const verdict = await judge(again.meta, ctx);
    if (!verdict.reclaimable) return verdict.detail;
    NodeFS.unlinkSync(path);
    return null;
  } finally {
    const mine = readMeta(guardPath);
    if (mine.kind === "ok" && mine.meta.nonce === guard.nonce) NodeFS.unlinkSync(guardPath);
  }
}

async function attempt(options: OwnerLockOptions): Promise<OwnerLockResult> {
  const probe = options.probe ?? nodeProcessProbe();
  const ctx: Context = {
    probe,
    now: options.now ?? Date.now,
    bound: options.staleAfterMs ?? OWNER_LOCK_STALE_AFTER_MS,
    self: options.self ?? (await selfIdentity(probe)),
  };
  NodeFS.mkdirSync(options.stateRoot, { recursive: true, mode: 0o700 });
  const path = NodePath.join(options.stateRoot, OWNER_LOCK_FILE);
  const meta: LockMeta = {
    v: 1,
    kind: "aetheria-backend-owner",
    nonce: NodeCrypto.randomBytes(12).toString("hex"),
    createdAtMs: ctx.now(),
    owner: ctx.self,
    digest: options.digest ?? "",
  };
  const owned = (detail: string): OwnerLockResult => ({
    ok: false,
    code: "state-root-owned",
    detail: `${detail} (lock ${path})`,
  });

  for (let round = 0; round < 3; round += 1) {
    if (publish(path, meta) === "created")
      return {
        ok: true,
        lock: { path, nonce: meta.nonce, release: () => removeIfStill(path, meta.nonce) },
      };
    const seen = readMeta(path);
    if (seen.kind === "missing") continue; // released between our attempt and our read
    if (seen.kind === "unusable")
      return {
        ok: false,
        code: "state-root-lock-unusable",
        detail: `the lock file exists but ${seen.why}, so its holder cannot be observed; it is left for the operator (lock ${path})`,
      };
    const verdict = await judge(seen.meta, ctx);
    if (!verdict.reclaimable) return owned(verdict.detail);
    const refusal = await reclaim(path, seen.meta, ctx);
    if (refusal !== null) return owned(refusal);
  }
  return owned("the lock is contended");
}

/**
 * Try once to take the state root's owner lock. Never waits. `ok: false` is a refusal the start reports: the holder lives or cannot be shown dead
 * (`state-root-owned`), or the lock or the state root cannot be read or written (`state-root-lock-unusable`).
 */
export async function acquireOwnerLock(options: OwnerLockOptions): Promise<OwnerLockResult> {
  try {
    return await attempt(options);
  } catch (error) {
    return {
      ok: false,
      code: "state-root-lock-unusable",
      detail: `the owner lock under ${options.stateRoot} could not be taken (${messageOf(error)})`,
    };
  }
}
