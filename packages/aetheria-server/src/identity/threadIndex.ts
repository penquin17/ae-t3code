// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// (Plain Node/JSON code at the Backend's storage boundary, like the XC-6 carrier core; the server layer wraps it where it needs Effect.)
//
// AETHERIA — the Backend's thread/provider-session -> Pi-session index (design D10; gate decision R2; M04 Plan step 13).
//
// Owner. This file owns one folder, `<stateRoot>/thread-index/`, and is its only writer. M03's identity store (`<stateRoot>/identity/`) keeps its
// single Agent-host writer and is never written, listed or changed from here; the thread id is never added to an XC-1 record. The index is the
// Backend's own statement of what T3 told it: this thread, running this provider session of this provider instance, holds this Pi session.
//
// What a binding is. T3 knows the pair at launch and resume, because it starts Pi with `--session <path>`; the Pi session id is read from that
// session file's header (Pi writes `{type:"session", id, ...}` first) and cross-checked with the id in Pi's file name. A binding is a fact
// asserted by T3's own launch path. It is never read from a tool argument, a request body or a model message, and a binding alone grants nothing:
// the resolver still demands M03's active record for the session.
//
// Storage. One file per thread, named by the SHA-256 of the thread id (T3 ids such as `mcp:<uuid>` are not path-safe), holding the real id so a
// misfiled file is detected. Folder 0700, files 0600, no links followed, replaced by a same-folder temporary file and `rename`, so a reader sees
// the old binding or the new one, never a partial one. A file that is loose, linked, truncated or not a binding is `corrupt`: reported, never
// trusted and never repaired by a read; the next bind of that thread replaces it.
//
// Retired sessions. A thread's Pi session can change (T3 starts a fresh Pi session when its first run was cancelled before it recorded a native
// session id). The replaced session is kept as a READ-ONLY alias of its thread, in the same file as the new binding (one rename, so the replace and
// the alias appear together or not at all), under the optional `retired` list. An alias grants nothing live: `bindingOfSession`, `threadsOf` and
// `sessions` never show it, so every caller that launches, steers or delivers to a session still sees only the live one. Only `aliasOfSession`
// names it, and its callers choose to read through it. A file without `retired` is a valid older file; the format version stays 1.
//
// Limits. One Backend process writes the index; the reverse view (session -> threads) is held in memory from a scan and kept current by this
// instance's own binds. The folder is not fsynced after rename, so a power loss can lose the newest bind (the next launch or resume writes it
// again) but cannot leave a partial file visible.

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const INDEX_FORMAT_VERSION = 1;
const INDEX_DIRECTORY = "thread-index";
/** The newest replaced sessions one thread keeps as aliases; the oldest beyond this fall away (they are history, not authority). */
const MAX_RETIRED = 64;

export type ThreadIndexFs = Pick<
  typeof NodeFS,
  | "mkdirSync"
  | "openSync"
  | "writeSync"
  | "fsyncSync"
  | "closeSync"
  | "readSync"
  | "renameSync"
  | "unlinkSync"
  | "readdirSync"
  | "lstatSync"
  | "fstatSync"
  | "readFileSync"
>;

export type IndexCode =
  | "INDEX_BAD_INPUT"
  | "INDEX_SESSION_UNRECOGNISED"
  | "INDEX_SESSION_CONFLICT"
  | "INDEX_SESSION_BOUND_ELSEWHERE"
  | "INDEX_UNSAFE_PATH"
  | "INDEX_IO";

/** What T3's launch or resume path knows. Every field is T3's own fact; none comes from a model. */
export interface BindInput {
  readonly threadId: string;
  readonly providerSessionId: string;
  readonly providerInstanceId: string;
  /** The Pi session file T3 passes as `--session` (or reads back as `sessionFile` from `get_state`). */
  readonly sessionFile: string;
  /** The thread's working folder. */
  readonly workingFolder: string;
  /** Whether the bearer's scope marks the thread a subagent, when T3 knows. Omitted means unknown. */
  readonly subagent?: boolean;
  /** The role T3 launched the session under, when it launched one. Omitted means not asserted. */
  readonly expectedRole?: string | null;
}

export interface ThreadBinding {
  readonly v: 1;
  readonly threadId: string;
  readonly providerInstanceId: string;
  readonly providerSessionId: string;
  /** The Pi session id (M03's XC-1 key). */
  readonly sessionId: string;
  /** Where the id came from: the session file's header, or Pi's file name when the file does not exist yet. */
  readonly evidence: "header" | "filename";
  readonly workingFolder: string;
  /** The project root of the working folder when it could be resolved; `null` is unknown, never a guess. */
  readonly projectRoot: string | null;
  readonly subagent: boolean | null;
  /** The asserted role; `null` means none asserted. */
  readonly expectedRole: string | null;
  readonly boundAt: number;
  /** Sessions this thread held before, newest last. Absent means none (and is how an older file reads). Read-only aliases; see the file's header. */
  readonly retired?: readonly RetiredSession[];
}

/** A Pi session a thread no longer holds live, kept so what it asked and left open can still be read. */
export interface RetiredSession {
  readonly sessionId: string;
  readonly providerSessionId: string;
  readonly providerInstanceId: string;
  readonly evidence: "header" | "filename";
  /** When the thread was bound to it. */
  readonly boundAt: number;
  /** When a bind replaced it (the Backend's clock at that bind). */
  readonly retiredAt: number;
  /** The Pi session that replaced it. */
  readonly replacedBy: string;
}

/** What a Pi session means to a thread: its live session, or a retired one the thread has since replaced. `binding` is always the thread's CURRENT binding. */
export type SessionAlias =
  | { readonly retired: false; readonly binding: ThreadBinding }
  | {
      readonly retired: true;
      readonly binding: ThreadBinding;
      readonly retiredSession: RetiredSession;
    };

export type BindResult =
  | {
      readonly ok: true;
      readonly binding: ThreadBinding;
      readonly change: "created" | "replaced" | "unchanged";
    }
  | { readonly ok: false; readonly code: IndexCode; readonly reason: string };

export type Lookup =
  | { readonly status: "absent" }
  | { readonly status: "corrupt"; readonly problem: string }
  | { readonly status: "ok"; readonly binding: ThreadBinding };

export interface BootReport {
  readonly loaded: number;
  readonly removedTemps: number;
  readonly corrupt: readonly { readonly file: string; readonly problem: string }[];
  readonly duplicates: readonly {
    readonly sessionId: string;
    readonly threadIds: readonly string[];
  }[];
}

export interface ThreadIndex {
  /** The folder this index owns. */
  readonly directory: string;
  /** Record what T3's launch or resume path knows. The only write this module makes. */
  bind(input: BindInput): BindResult;
  lookup(threadId: string): Lookup;
  /** The threads that hold a Pi session. Exactly one is the healthy case. */
  threadsOf(sessionId: string): readonly string[];
  /** The binding of a Pi session when exactly one thread holds it. */
  bindingOfSession(sessionId: string): ThreadBinding | undefined;
  /**
   * The thread's binding for a Pi session the thread holds live (`retired: false`) or held before and has since replaced (`retired: true`). For READS and
   * for routing to the THREAD only: a retired alias is never a session to launch, steer or write to; use `bindingOfSession` for that.
   */
  aliasOfSession(sessionId: string): SessionAlias | undefined;
  /** Every Pi session some thread holds, sorted. What the lifecycle snapshot lists (step 16). */
  sessions(): readonly string[];
  /** Scan the folder, rebuild the reverse view and remove this module's own leftover temporary files. Reads nothing of M03's folders. */
  boot(): BootReport;
}

export interface ThreadIndexOptions {
  /** The Aetheria state root the Agent host also uses (`AETHERIA_STATE_ROOT`). */
  readonly stateRoot: string;
  /** Resolve a working folder to its project root, or `null` when it cannot be resolved. */
  readonly projectRootOf?: (workingFolder: string) => string | null;
  readonly now?: () => number;
  readonly fs?: Partial<ThreadIndexFs>;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PI_FILE = /^[^_]+_([A-Za-z0-9][A-Za-z0-9-]{0,127})\.jsonl$/;
const MAX_HEADER_BYTES = 65536;
const MAX_ID = 256;
const BINDING_KEYS = [
  "v",
  "threadId",
  "providerInstanceId",
  "providerSessionId",
  "sessionId",
  "evidence",
  "workingFolder",
  "projectRoot",
  "subagent",
  "expectedRole",
  "boundAt",
];
const RETIRED_KEYS = [
  "sessionId",
  "providerSessionId",
  "providerInstanceId",
  "evidence",
  "boundAt",
  "retiredAt",
  "replacedBy",
];

const text = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const codeOf = (error: unknown): string | undefined =>
  (error as NodeJS.ErrnoException | undefined)?.code;
const idString = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.length <= MAX_ID && !v.includes("\0");
const absolute = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith("/") && !v.includes("\0");
const canonicalRoot = (v: unknown): v is string =>
  absolute(v) && !v.split("/").includes("..") && (v.length === 1 || !v.endsWith("/"));
const fileNameOf = (threadId: string): string =>
  `${NodeCrypto.createHash("sha256").update(threadId).digest("hex")}.json`;
const FILE_NAME = /^[0-9a-f]{64}\.json$/;
const fail = (code: IndexCode, reason: string): BindResult =>
  Object.freeze({ ok: false as const, code, reason });

function parseBinding(
  raw: string,
): { readonly binding: ThreadBinding } | { readonly problem: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { problem: "the file is not valid JSON" };
  }
  if (json === null || typeof json !== "object" || Array.isArray(json))
    return { problem: "the file is not a binding object" };
  const b = json as Record<string, unknown>;
  const keys = Object.keys(b);
  const hasRetired = keys.includes("retired");
  if (
    keys.length !== BINDING_KEYS.length + (hasRetired ? 1 : 0) ||
    !BINDING_KEYS.every((k) => keys.includes(k))
  )
    return { problem: "the binding has unexpected fields" };
  if (b.v !== INDEX_FORMAT_VERSION)
    return { problem: `unsupported version ${JSON.stringify(b.v)}` };
  if (!idString(b.threadId) || !idString(b.providerInstanceId) || !idString(b.providerSessionId))
    return { problem: "an id field is invalid" };
  if (typeof b.sessionId !== "string" || !NAME.test(b.sessionId))
    return { problem: "sessionId is not a safe name" };
  if (b.evidence !== "header" && b.evidence !== "filename")
    return { problem: "evidence is invalid" };
  if (!absolute(b.workingFolder)) return { problem: "workingFolder is invalid" };
  if (b.projectRoot !== null && !canonicalRoot(b.projectRoot))
    return { problem: "projectRoot is invalid" };
  if (b.subagent !== null && typeof b.subagent !== "boolean")
    return { problem: "subagent is invalid" };
  if (b.expectedRole !== null && !idString(b.expectedRole))
    return { problem: "expectedRole is invalid" };
  if (typeof b.boundAt !== "number" || !Number.isFinite(b.boundAt))
    return { problem: "boundAt is invalid" };
  if (hasRetired) {
    const retired = parseRetired(b.retired, b.sessionId);
    if (typeof retired === "string") return { problem: retired };
    return { binding: Object.freeze({ ...b, retired }) as unknown as ThreadBinding };
  }
  return { binding: Object.freeze({ ...b }) as unknown as ThreadBinding };
}

function parseRetired(raw: unknown, current: string): readonly RetiredSession[] | string {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_RETIRED)
    return "retired is not a non-empty list within its bound";
  const seen = new Set<string>();
  const out: RetiredSession[] = [];
  for (const item of raw as unknown[]) {
    if (item === null || typeof item !== "object" || Array.isArray(item))
      return "a retired session is not an object";
    const r = item as Record<string, unknown>;
    const keys = Object.keys(r);
    if (keys.length !== RETIRED_KEYS.length || !RETIRED_KEYS.every((k) => keys.includes(k)))
      return "a retired session has unexpected fields";
    if (typeof r.sessionId !== "string" || !NAME.test(r.sessionId))
      return "a retired sessionId is not a safe name";
    if (typeof r.replacedBy !== "string" || !NAME.test(r.replacedBy))
      return "a retired replacedBy is not a safe name";
    if (!idString(r.providerSessionId) || !idString(r.providerInstanceId))
      return "a retired id field is invalid";
    if (r.evidence !== "header" && r.evidence !== "filename")
      return "a retired evidence is invalid";
    if (typeof r.boundAt !== "number" || !Number.isFinite(r.boundAt))
      return "a retired boundAt is invalid";
    if (typeof r.retiredAt !== "number" || !Number.isFinite(r.retiredAt))
      return "a retired retiredAt is invalid";
    if (r.sessionId === current || seen.has(r.sessionId))
      return "a retired session repeats another or is the live one";
    seen.add(r.sessionId);
    out.push(Object.freeze({ ...r }) as unknown as RetiredSession);
  }
  return Object.freeze(out);
}

type HeaderRead =
  | { readonly kind: "absent" }
  | { readonly kind: "bad"; readonly problem: string }
  | { readonly kind: "ok"; readonly id: string };

export function createThreadIndex(options: ThreadIndexOptions): ThreadIndex {
  const { stateRoot } = options;
  if (!absolute(stateRoot) || NodePath.normalize(stateRoot) !== stateRoot.replace(/(.)\/$/, "$1"))
    throw new TypeError("stateRoot must be a normalised absolute path");
  const fs: ThreadIndexFs = { ...NodeFS, ...options.fs };
  const now = options.now ?? (() => Date.now());
  const projectRootOf = options.projectRootOf ?? (() => null);
  const directory = NodePath.join(stateRoot, INDEX_DIRECTORY);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;

  const bySession = new Map<string, Set<string>>();
  /** Replaced sessions by the thread(s) that kept them as aliases. Never consulted for a live read. */
  const retiredBySession = new Map<string, Set<string>>();
  let loaded = false;

  const readPlain = (
    path: string,
  ):
    | { readonly kind: "absent" }
    | { readonly kind: "bad"; readonly problem: string }
    | { readonly kind: "ok"; readonly body: string } => {
    let fd: number | undefined;
    try {
      fd = fs.openSync(path, NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW);
      const st = fs.fstatSync(fd);
      if (!st.isFile()) return { kind: "bad", problem: "not a regular file" };
      if ((st.mode & 0o077) !== 0) return { kind: "bad", problem: "the file is not owner-only" };
      if (uid !== null && st.uid !== uid)
        return { kind: "bad", problem: "the file is not owned by this user" };
      return { kind: "ok", body: fs.readFileSync(fd, "utf8") };
    } catch (error) {
      const code = codeOf(error);
      if (code === "ENOENT") return { kind: "absent" };
      return { kind: "bad", problem: code === "ELOOP" ? "the path is a link" : text(error) };
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* nothing more can be done for a descriptor that will not close */
        }
      }
    }
  };

  const folderProblem = (dir: string): string | null => {
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) return `${dir} is not a plain folder`;
    if (uid !== null && st.uid !== uid) return `${dir} is not owned by this user`;
    if ((st.mode & 0o077) !== 0) return `${dir} is not owner-only`;
    return null;
  };

  const lookup = (threadId: string): Lookup => {
    if (!idString(threadId)) return { status: "absent" };
    const read = readPlain(NodePath.join(directory, fileNameOf(threadId)));
    if (read.kind === "absent") return { status: "absent" };
    if (read.kind === "bad") return { status: "corrupt", problem: read.problem };
    const parsed = parseBinding(read.body);
    if ("problem" in parsed) return { status: "corrupt", problem: parsed.problem };
    if (parsed.binding.threadId !== threadId)
      return { status: "corrupt", problem: "the file names another thread" };
    return { status: "ok", binding: parsed.binding };
  };

  const note = (sessionId: string, threadId: string) => {
    const set = bySession.get(sessionId) ?? new Set<string>();
    set.add(threadId);
    bySession.set(sessionId, set);
  };
  const forget = (sessionId: string, threadId: string) => {
    const set = bySession.get(sessionId);
    set?.delete(threadId);
    if (set !== undefined && set.size === 0) bySession.delete(sessionId);
  };

  const noteRetired = (binding: ThreadBinding) => {
    for (const r of binding.retired ?? []) {
      const set = retiredBySession.get(r.sessionId) ?? new Set<string>();
      set.add(binding.threadId);
      retiredBySession.set(r.sessionId, set);
    }
  };
  const forgetRetired = (binding: ThreadBinding) => {
    for (const r of binding.retired ?? []) {
      const set = retiredBySession.get(r.sessionId);
      set?.delete(binding.threadId);
      if (set !== undefined && set.size === 0) retiredBySession.delete(r.sessionId);
    }
  };

  const scan = (removeTemps: boolean): BootReport => {
    bySession.clear();
    retiredBySession.clear();
    const corrupt: { file: string; problem: string }[] = [];
    let removedTemps = 0;
    let count = 0;
    let names: string[] = [];
    try {
      const problem = folderProblem(directory);
      if (problem !== null) {
        loaded = true;
        return Object.freeze({
          loaded: 0,
          removedTemps: 0,
          corrupt: Object.freeze([{ file: ".", problem }]),
          duplicates: Object.freeze([]),
        });
      }
      names = fs.readdirSync(directory).sort();
    } catch (error) {
      if (codeOf(error) !== "ENOENT") corrupt.push({ file: ".", problem: text(error) });
    }
    for (const name of names) {
      if (name.startsWith(".tmp-")) {
        if (removeTemps) {
          try {
            fs.unlinkSync(NodePath.join(directory, name));
            removedTemps += 1;
          } catch (error) {
            corrupt.push({ file: name, problem: text(error) });
          }
        }
        continue;
      }
      if (!FILE_NAME.test(name)) continue;
      const read = readPlain(NodePath.join(directory, name));
      if (read.kind === "absent") continue;
      if (read.kind === "bad") {
        corrupt.push({ file: name, problem: read.problem });
        continue;
      }
      const parsed = parseBinding(read.body);
      if ("problem" in parsed) {
        corrupt.push({ file: name, problem: parsed.problem });
        continue;
      }
      if (fileNameOf(parsed.binding.threadId) !== name) {
        corrupt.push({ file: name, problem: "the file names another thread" });
        continue;
      }
      note(parsed.binding.sessionId, parsed.binding.threadId);
      noteRetired(parsed.binding);
      count += 1;
    }
    loaded = true;
    const duplicates = [...bySession.entries()]
      .filter(([, threads]) => threads.size > 1)
      .map(([sessionId, threads]) =>
        Object.freeze({ sessionId, threadIds: Object.freeze([...threads].sort()) }),
      )
      .sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1));
    return Object.freeze({
      loaded: count,
      removedTemps,
      corrupt: Object.freeze(corrupt),
      duplicates: Object.freeze(duplicates),
    });
  };
  const ensureLoaded = () => {
    if (!loaded) scan(false);
  };

  const readHeader = (path: string): HeaderRead => {
    let fd: number | undefined;
    try {
      fd = fs.openSync(path, NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW);
      if (!fs.fstatSync(fd).isFile())
        return { kind: "bad", problem: "the session file is not a regular file" };
      const buffer = Buffer.alloc(MAX_HEADER_BYTES);
      const length = fs.readSync(fd, buffer, 0, MAX_HEADER_BYTES, 0);
      const end = buffer.subarray(0, length).indexOf(0x0a);
      if (end < 0 && length === MAX_HEADER_BYTES)
        return { kind: "bad", problem: "the session header is too long" };
      const first = buffer.subarray(0, end < 0 ? length : end).toString("utf8");
      let json: unknown;
      try {
        json = JSON.parse(first);
      } catch {
        return { kind: "bad", problem: "the first line of the session file is not JSON" };
      }
      const h = json as { type?: unknown; id?: unknown } | null;
      if (h === null || typeof h !== "object" || h.type !== "session" || typeof h.id !== "string")
        return { kind: "bad", problem: "the first line is not a session header" };
      return { kind: "ok", id: h.id };
    } catch (error) {
      const code = codeOf(error);
      if (code === "ENOENT") return { kind: "absent" };
      return {
        kind: "bad",
        problem: code === "ELOOP" ? "the session file is a link" : text(error),
      };
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* see readPlain */
        }
      }
    }
  };

  const sessionOf = (
    sessionFile: string,
  ):
    | { readonly id: string; readonly evidence: "header" | "filename" }
    | { readonly code: IndexCode; readonly reason: string } => {
    const fromName = PI_FILE.exec(NodePath.basename(sessionFile))?.[1] ?? null;
    const header = readHeader(sessionFile);
    if (header.kind === "bad") return { code: "INDEX_SESSION_CONFLICT", reason: header.problem };
    if (header.kind === "absent") {
      if (fromName === null)
        return {
          code: "INDEX_SESSION_UNRECOGNISED",
          reason: "the session file does not exist yet and its name carries no session id",
        };
      return NAME.test(fromName)
        ? { id: fromName, evidence: "filename" }
        : {
            code: "INDEX_SESSION_UNRECOGNISED",
            reason: "the session id in the file name is not a safe name",
          };
    }
    if (fromName !== null && fromName !== header.id)
      return {
        code: "INDEX_SESSION_CONFLICT",
        reason: "the session header and the file name name different sessions",
      };
    return NAME.test(header.id)
      ? { id: header.id, evidence: "header" }
      : {
          code: "INDEX_SESSION_UNRECOGNISED",
          reason: "the session id in the header is not a safe name",
        };
  };

  const same = (a: ThreadBinding, b: ThreadBinding): boolean =>
    a.providerInstanceId === b.providerInstanceId &&
    a.providerSessionId === b.providerSessionId &&
    a.sessionId === b.sessionId &&
    a.evidence === b.evidence &&
    a.workingFolder === b.workingFolder &&
    a.projectRoot === b.projectRoot &&
    a.subagent === b.subagent &&
    a.expectedRole === b.expectedRole;

  const bind = (input: BindInput): BindResult => {
    if (input === null || typeof input !== "object")
      return fail("INDEX_BAD_INPUT", "the input is not an object");
    if (
      !idString(input.threadId) ||
      !idString(input.providerSessionId) ||
      !idString(input.providerInstanceId)
    )
      return fail(
        "INDEX_BAD_INPUT",
        "threadId, providerSessionId and providerInstanceId must be non-empty strings of at most 256 characters",
      );
    if (!absolute(input.workingFolder) || !absolute(input.sessionFile))
      return fail("INDEX_BAD_INPUT", "workingFolder and sessionFile must be absolute paths");
    if (input.subagent !== undefined && typeof input.subagent !== "boolean")
      return fail("INDEX_BAD_INPUT", "subagent must be a boolean when given");
    if (
      input.expectedRole !== undefined &&
      input.expectedRole !== null &&
      !idString(input.expectedRole)
    )
      return fail("INDEX_BAD_INPUT", "expectedRole must be a name or null when given");

    const session = sessionOf(input.sessionFile);
    if ("code" in session) return fail(session.code, session.reason);

    let projectRoot: string | null = null;
    try {
      const resolved = projectRootOf(input.workingFolder);
      projectRoot = canonicalRoot(resolved) ? resolved : null;
    } catch {
      projectRoot = null;
    }

    try {
      mkdirChecked();
    } catch (error) {
      return error instanceof Unsafe
        ? fail("INDEX_UNSAFE_PATH", error.message)
        : fail("INDEX_IO", text(error));
    }

    ensureLoaded();
    const others = [
      ...(bySession.get(session.id) ?? []),
      ...(retiredBySession.get(session.id) ?? []),
    ].filter((t) => t !== input.threadId);
    if (others.length > 0)
      return fail(
        "INDEX_SESSION_BOUND_ELSEWHERE",
        "another thread already holds this Pi session, live or as a replaced one",
      );

    const existing = lookup(input.threadId);
    // A replaced session stays an alias of this thread; one that came back is live again and so no longer an alias.
    const at = now();
    const replaced: readonly RetiredSession[] =
      existing.status === "ok" && existing.binding.sessionId !== session.id
        ? [
            ...(existing.binding.retired ?? []),
            Object.freeze({
              sessionId: existing.binding.sessionId,
              providerSessionId: existing.binding.providerSessionId,
              providerInstanceId: existing.binding.providerInstanceId,
              evidence: existing.binding.evidence,
              boundAt: existing.binding.boundAt,
              retiredAt: at,
              replacedBy: session.id,
            }),
          ]
        : existing.status === "ok"
          ? (existing.binding.retired ?? [])
          : [];
    const retired = replaced.filter((r) => r.sessionId !== session.id).slice(-MAX_RETIRED);

    const binding: ThreadBinding = Object.freeze({
      v: INDEX_FORMAT_VERSION,
      threadId: input.threadId,
      providerInstanceId: input.providerInstanceId,
      providerSessionId: input.providerSessionId,
      sessionId: session.id,
      evidence: session.evidence,
      workingFolder: input.workingFolder,
      projectRoot,
      subagent: input.subagent ?? null,
      expectedRole: input.expectedRole ?? null,
      boundAt: at,
      ...(retired.length === 0 ? {} : { retired: Object.freeze(retired) }),
    });
    if (existing.status === "ok" && same(existing.binding, binding))
      return Object.freeze({
        ok: true as const,
        binding: existing.binding,
        change: "unchanged" as const,
      });

    const target = NodePath.join(directory, fileNameOf(input.threadId));
    const temp = NodePath.join(directory, `.tmp-${NodeCrypto.randomUUID()}`);
    let fd: number | undefined;
    try {
      fd = fs.openSync(temp, "wx", 0o600);
      fs.writeSync(fd, `${JSON.stringify(binding)}\n`);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temp, target);
    } catch (error) {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* the failure being reported is the earlier one */
        }
      }
      try {
        fs.unlinkSync(temp);
      } catch {
        /* a temporary file that was never created needs no removal */
      }
      return fail("INDEX_IO", text(error));
    }
    if (existing.status === "ok") {
      forget(existing.binding.sessionId, input.threadId);
      forgetRetired(existing.binding);
    }
    note(binding.sessionId, input.threadId);
    noteRetired(binding);
    return Object.freeze({
      ok: true as const,
      binding,
      change: existing.status === "absent" ? ("created" as const) : ("replaced" as const),
    });
  };

  const bindingOfSession = (sessionId: string): ThreadBinding | undefined => {
    ensureLoaded();
    const threads = bySession.get(sessionId);
    if (threads === undefined || threads.size !== 1) return undefined;
    const found = lookup([...threads][0] as string);
    return found.status === "ok" && found.binding.sessionId === sessionId
      ? found.binding
      : undefined;
  };

  class Unsafe extends Error {}
  function mkdirChecked(): void {
    for (const dir of [stateRoot, directory]) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const problem = folderProblem(dir);
      if (problem !== null) throw new Unsafe(problem);
    }
  }

  return Object.freeze({
    directory,
    bind,
    lookup,
    threadsOf(sessionId: string): readonly string[] {
      ensureLoaded();
      return Object.freeze([...(bySession.get(sessionId) ?? [])].sort());
    },
    sessions(): readonly string[] {
      ensureLoaded();
      return Object.freeze([...bySession.keys()].sort());
    },
    bindingOfSession,
    aliasOfSession(sessionId: string): SessionAlias | undefined {
      ensureLoaded();
      const live = bindingOfSession(sessionId);
      if (live !== undefined) return Object.freeze({ retired: false as const, binding: live });
      // A session some thread holds live, but ambiguously, is never settled by an alias.
      if (bySession.has(sessionId)) return undefined;
      const threads = retiredBySession.get(sessionId);
      if (threads === undefined || threads.size !== 1) return undefined;
      const found = lookup([...threads][0] as string);
      const retiredSession =
        found.status === "ok"
          ? found.binding.retired?.find((r) => r.sessionId === sessionId)
          : undefined;
      return found.status === "ok" && retiredSession !== undefined
        ? Object.freeze({ retired: true as const, binding: found.binding, retiredSession })
        : undefined;
    },
    boot: () => scan(true),
  });
}
