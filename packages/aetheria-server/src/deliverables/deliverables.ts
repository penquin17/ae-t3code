// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalRandom:off
// AETHERIA M10 Plan step 13 (D9, D10, XC-1/5/6/20/22) — the Backend's ONE deliverable declaration store and its module `deliverables-backend`. A declaration is a metadata-only record that a file is a
// deliverable of a session's run, kept at `<state-root>/aetheria-ui/deliverables.json` as `{formatVersion: 1, declarations: [...]}`, distinct from M09's snapshot store (`aetheria-deliverables`, the
// `deliverables/` folder of T3's attachments directory), which keeps the bytes of an as-delivered copy.
//
// The Agent host's `present` tool makes three calls in turn: `deliverables.declare` (this module checks the file and writes a pending record), the existing `attachments.store-snapshot`, then
// `deliverables.attach-snapshot` (this module opens the snapshot through the Backend's own snapshot store, in process, and settles the record's as-delivered state ONCE). The identity of every call is
// the XC-6 carrier's; the turn is the one run T3's projection shows active for that session (the `callerContext` port); nothing the model sends names a session, root, turn, kind or digest.
//
// One writer. The Backend holds the state root's owner lock before any module starts; this module's calls are serialised, and each write replaces the whole file through a private temporary file in the
// same folder (`wx`, owner-only, synced) and a rename. Refusal, never repair: a file that is not valid JSON, has no integer `formatVersion` of 1, or holds a record outside the exact shape is
// refused as DELIVERABLES_STORE_UNUSABLE on every call and left byte for byte as it was; a `formatVersion` above 1 is refused unread as DELIVERABLES_FORMAT_NEWER. An unusable file does not stop
// the Backend (a deliverable is not worth the sessions): it is reported at start and refuses each call.
//
// Idempotence. A declaration's id is a function of the verified session and the request id, so a retry after a lost reply names the record that exists and writes nothing; the same request id with
// another path or title is a conflict. A declaration's snapshot state settles once (pending → attached | unavailable); the same settling repeated is a replay, any other is a conflict.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  DELIVERABLES_ATTACH_SNAPSHOT_OPERATION,
  DELIVERABLES_DECLARE_OPERATION,
  DELIVERABLES_FORMAT_VERSION,
  DELIVERABLE_KINDS,
  DELIVERABLE_MAX_PATH_LENGTH,
  DELIVERABLE_MAX_TITLE_LENGTH,
  DELIVERABLE_SNAPSHOT_FAILURE_CODES,
  decodeAttachSnapshotArgs,
  decodeDeclareArgs,
  type AttachFailureCode,
  type AttachSnapshotArgs,
  type AttachSnapshotResult,
  type DeclareArgs,
  type DeclareFailureCode,
  type DeclareResult,
  type DeclareStoreCode,
  type DeliverableKind,
  type DeliverableSnapshotState,
  type DeliverableView,
  type Xc6Operation,
  type Xc6OperationContext,
  type Xc6Settled,
} from "@t3tools/aetheria-contracts";

import type { BackendRegistration } from "../adapter.ts";
import { XC6_IDENTITY_UNAVAILABLE } from "../identity/resolver.ts";
import type { CallerContextPort } from "../orchestrationFactory.ts";
import { DELIVERABLES_BACKEND_ENTRY } from "./deliverablesRow.ts";

export {
  DELIVERABLES_BACKEND_ENTRY,
  DELIVERABLES_BACKEND_ID,
  deliverablesBackendModuleRow,
} from "./deliverablesRow.ts";

/** The file under a state root. */
export const DELIVERABLES_FILE_RELATIVE = NodePath.join("aetheria-ui", "deliverables.json");
/** The most declarations one store keeps; a call past it is refused, never a record dropped. */
export const DELIVERABLES_MAX_RECORDS = 5000;
const READ_CHUNK = 64 * 1024;

/** One stored declaration: the facts of the file at declaration, the verified owner, and the request that made it (for the idempotent retry). */
export interface DeliverableRecord {
  readonly id: string;
  readonly requestId: string;
  /** The path and title exactly as the request gave them: a retry must repeat them. */
  readonly requestedPath: string;
  readonly requestedTitle: string | null;
  readonly sessionId: string;
  readonly rootSessionId: string;
  readonly turnId: string;
  readonly canonicalPath: string;
  readonly title: string;
  readonly kind: DeliverableKind;
  readonly size: number;
  readonly digest: string;
  readonly declaredAt: number;
  readonly snapshot: DeliverableSnapshotState;
}
/** A record as a reader sees it: `supersededBy` is the latest later declaration of the same file in the same session, or null. */
export interface DeliverableEntry extends DeliverableRecord {
  readonly supersededBy: string | null;
}

/** The caller as the carrier verified it. The only identity the operations use. */
export interface DeliverablesCaller {
  readonly sessionId: string;
  readonly rootSessionId: string;
  readonly kind?: string;
}

export type SnapshotOpener = (
  sessionId: string,
  snapshotId: string,
) => Promise<
  | {
      readonly ok: true;
      readonly digest: string;
      readonly size: number;
      readonly stream: { destroy(): void };
    }
  | { readonly ok: false; readonly code: string }
>;

type StoreCode = DeclareStoreCode | typeof XC6_IDENTITY_UNAVAILABLE;
export type DeliverablesOutcome =
  | { readonly status: "done"; readonly result: DeclareResult | AttachSnapshotResult }
  | { readonly status: "unavailable"; readonly code: StoreCode };
export type DeliverablesRead<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: DeclareStoreCode };

export interface DeliverablesStoreOptions {
  /** The Aetheria state root the Backend owns (`AETHERIA_STATE_ROOT`). */
  readonly stateRoot: string;
  readonly now?: () => number;
  /** Publication step of every write: replace `to` with `from`. Replaced only by tests, to inject a failure at one publication. */
  readonly rename?: (from: string, to: string) => Promise<void>;
  /** Called with the underlying cause of an unusable store, for the Backend's own log; never reaches a caller. */
  readonly onError?: (error: unknown) => void;
  /** The caller's thread, working folder and ACTIVE run (T3's projection and M04's index). Absent: declare answers unavailable. */
  readonly callerContext?: CallerContextPort | undefined;
  /** The Backend's own snapshot store, in process. Absent: attaching a snapshot answers unavailable. */
  readonly openSnapshot?: SnapshotOpener | undefined;
  /** Test seam: the store's limit (default DELIVERABLES_MAX_RECORDS). */
  readonly maxRecords?: number;
  /** Test seam: called after the first chunk of a declared file was read. */
  readonly onFileRead?: () => void;
}

export interface DeliverablesService {
  declare(who: DeliverablesCaller, args: DeclareArgs): Promise<DeliverablesOutcome>;
  attachSnapshot(who: DeliverablesCaller, args: AttachSnapshotArgs): Promise<DeliverablesOutcome>;
  /** Every declaration of one root's sessions, oldest first. An unusable store is a refusal, never an empty list. */
  list(rootSessionId: string): Promise<DeliverablesRead<readonly DeliverableEntry[]>>;
  /** One declaration by id, or null. */
  get(id: string): Promise<DeliverablesRead<DeliverableEntry | null>>;
}
export interface DeliverablesStore extends DeliverablesService {
  /** Refuse new calls (DELIVERABLES_NOT_RUNNING) and wait for the calls in flight. */
  close(): Promise<void>;
}

/** Stable, a function of the verified session and the request id only: the lost-reply retry names the same record. */
export function deliverableIdOf(sessionId: string, requestId: string): string {
  return `dlv_${NodeCrypto.createHash("sha256")
    .update(`${sessionId}\u0000${requestId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

const KIND_BY_EXTENSION: Readonly<Record<string, DeliverableKind>> = {
  ".txt": "text",
  ".log": "text",
  ".csv": "text",
  ".json": "text",
  ".md": "markdown",
  ".markdown": "markdown",
  ".html": "html",
  ".htm": "html",
  ".pdf": "pdf",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".svg": "image",
  ".mp3": "audio",
  ".wav": "audio",
  ".m4a": "audio",
  ".ogg": "audio",
  ".mp4": "video",
  ".mov": "video",
  ".webm": "video",
  ".docx": "office",
  ".doc": "office",
  ".xlsx": "office",
  ".xls": "office",
  ".pptx": "office",
  ".ppt": "office",
};
/** The preview kind of a file name, by its extension alone: a model cannot claim one. */
export function deliverableKindOf(name: string): DeliverableKind {
  return KIND_BY_EXTENSION[NodePath.extname(name).toLowerCase()] ?? "other";
}

type Verified =
  | {
      readonly ok: true;
      readonly canonicalPath: string;
      readonly size: number;
      readonly digest: string;
    }
  | { readonly ok: false; readonly code: DeclareFailureCode; readonly detail: string };

const refuse = (code: DeclareFailureCode, detail: string): Verified => ({
  ok: false,
  code,
  detail,
});
const errnoOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException)?.code;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Show that `rawPath` is a regular, readable file inside `workingFolder`, and read its digest. The folder part of the path is resolved (a linked folder is allowed when it leads inside); the
 * file itself is never followed: it is judged by `lstat`, opened with O_NOFOLLOW, and must be the same file (device and inode) before and after the read, with the size and time it had.
 */
async function verifyFile(
  rawPath: string,
  workingFolder: string,
  onFileRead: (() => void) | undefined,
): Promise<Verified> {
  const resolved = NodePath.resolve(rawPath);
  const base = NodePath.basename(resolved);
  const parent = NodePath.dirname(resolved);
  if (base === "" || parent === resolved)
    return refuse("DELIVERABLE_NOT_REGULAR", "The path names no file.");
  let realParent: string;
  let root: string;
  try {
    root = await NodeFSP.realpath(workingFolder);
  } catch {
    return refuse("DELIVERABLE_OUTSIDE_ROOT", "The session's working folder cannot be resolved.");
  }
  try {
    realParent = await NodeFSP.realpath(parent);
  } catch (error) {
    return errnoOf(error) === "EACCES" || errnoOf(error) === "EPERM"
      ? refuse("DELIVERABLE_UNREADABLE", "The file's folder cannot be read.")
      : refuse("DELIVERABLE_NOT_FOUND", "The file does not exist.");
  }
  const canonicalPath = NodePath.join(realParent, base);
  if (
    canonicalPath !== root &&
    !canonicalPath.startsWith(root.endsWith(NodePath.sep) ? root : root + NodePath.sep)
  )
    return refuse("DELIVERABLE_OUTSIDE_ROOT", "The file is outside the session's working folder.");

  let before: NodeFS.Stats;
  try {
    before = await NodeFSP.lstat(canonicalPath);
  } catch (error) {
    const code = errnoOf(error);
    return code === "EACCES" || code === "EPERM"
      ? refuse("DELIVERABLE_UNREADABLE", "The file cannot be examined.")
      : refuse("DELIVERABLE_NOT_FOUND", "The file does not exist.");
  }
  if (!before.isFile())
    return refuse(
      "DELIVERABLE_NOT_REGULAR",
      before.isSymbolicLink()
        ? "The path is a link; a deliverable is a regular file."
        : "The path is not a regular file.",
    );

  let handle: NodeFSP.FileHandle;
  try {
    handle = await NodeFSP.open(
      canonicalPath,
      NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW | NodeFS.constants.O_NONBLOCK,
    );
  } catch (error) {
    const code = errnoOf(error);
    if (code === "ELOOP") return refuse("DELIVERABLE_NOT_REGULAR", "The path is a link.");
    if (code === "ENOENT") return refuse("DELIVERABLE_NOT_FOUND", "The file does not exist.");
    return refuse("DELIVERABLE_UNREADABLE", "The file cannot be opened for reading.");
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile())
      return refuse("DELIVERABLE_NOT_REGULAR", "The path is not a regular file.");
    if (opened.dev !== before.dev || opened.ino !== before.ino)
      return refuse("DELIVERABLE_CHANGED", "The file was replaced while it was examined.");
    const hash = NodeCrypto.createHash("sha256");
    const chunk = Buffer.allocUnsafe(READ_CHUNK);
    let bytes = 0;
    let announced = false;
    for (;;) {
      let read: number;
      try {
        read = (await handle.read(chunk, 0, READ_CHUNK, null)).bytesRead;
      } catch {
        return refuse("DELIVERABLE_UNREADABLE", "The file cannot be read.");
      }
      if (read === 0) break;
      hash.update(chunk.subarray(0, read));
      bytes += read;
      if (!announced) {
        announced = true;
        onFileRead?.();
      }
    }
    const after = await handle.stat();
    let now: NodeFS.Stats;
    try {
      now = await NodeFSP.lstat(canonicalPath);
    } catch {
      return refuse("DELIVERABLE_CHANGED", "The file was removed while it was read.");
    }
    if (
      bytes !== opened.size ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      !now.isFile() ||
      now.dev !== opened.dev ||
      now.ino !== opened.ino
    )
      return refuse("DELIVERABLE_CHANGED", "The file changed while it was read.");
    return { ok: true, canonicalPath, size: bytes, digest: `sha256:${hash.digest("hex")}` };
  } finally {
    await handle.close().catch(() => {});
  }
}

// No parameter property: outer Node tests load this source with type stripping only.
class StoreRefusal extends Error {
  readonly code: DeclareStoreCode;
  constructor(code: DeclareStoreCode, message: string) {
    super(message);
    this.code = code;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
};
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isNat = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const isDigest = (value: unknown): value is string =>
  typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const isSnapshotId = (value: unknown): value is string =>
  typeof value === "string" && /^snap_[0-9a-f]{64}$/.test(value);
const FAILURE_CODES: readonly string[] = DELIVERABLE_SNAPSHOT_FAILURE_CODES;

function readSnapshot(value: unknown): DeliverableSnapshotState | undefined {
  if (!isObject(value)) return undefined;
  if (value.state === "pending" && exactKeys(value, ["state"])) return { state: "pending" };
  if (
    value.state === "attached" &&
    exactKeys(value, ["state", "snapshotId", "digest", "size"]) &&
    isSnapshotId(value.snapshotId) &&
    isDigest(value.digest) &&
    isNat(value.size)
  )
    return {
      state: "attached",
      snapshotId: value.snapshotId,
      digest: value.digest,
      size: value.size,
    };
  if (
    value.state === "unavailable" &&
    exactKeys(value, ["state", "code"]) &&
    typeof value.code === "string" &&
    FAILURE_CODES.includes(value.code)
  )
    return {
      state: "unavailable",
      code: value.code as (typeof DELIVERABLE_SNAPSHOT_FAILURE_CODES)[number],
    };
  return undefined;
}

const RECORD_KEYS = [
  "id",
  "requestId",
  "requestedPath",
  "requestedTitle",
  "sessionId",
  "rootSessionId",
  "turnId",
  "canonicalPath",
  "title",
  "kind",
  "size",
  "digest",
  "declaredAt",
  "snapshot",
] as const;

function readRecord(value: unknown): DeliverableRecord | undefined {
  if (!isObject(value) || !exactKeys(value, RECORD_KEYS)) return undefined;
  const snapshot = readSnapshot(value.snapshot);
  if (
    snapshot === undefined ||
    !isText(value.id) ||
    !isText(value.requestId) ||
    !isText(value.requestedPath) ||
    !(value.requestedTitle === null || typeof value.requestedTitle === "string") ||
    !isText(value.sessionId) ||
    !isText(value.rootSessionId) ||
    !isText(value.turnId) ||
    !isText(value.canonicalPath) ||
    !isText(value.title) ||
    typeof value.kind !== "string" ||
    !(DELIVERABLE_KINDS as readonly string[]).includes(value.kind) ||
    !isNat(value.size) ||
    !isDigest(value.digest) ||
    typeof value.declaredAt !== "number" ||
    !Number.isFinite(value.declaredAt) ||
    value.id !== deliverableIdOf(value.sessionId, value.requestId)
  )
    return undefined;
  return {
    id: value.id,
    requestId: value.requestId,
    requestedPath: value.requestedPath,
    requestedTitle: value.requestedTitle,
    sessionId: value.sessionId,
    rootSessionId: value.rootSessionId,
    turnId: value.turnId,
    canonicalPath: value.canonicalPath,
    title: value.title,
    kind: value.kind as DeliverableKind,
    size: value.size,
    digest: value.digest,
    declaredAt: value.declaredAt,
    snapshot,
  };
}

/** Check data read from the file. Refusal, never repair: a version above 1 is newer (judged before anything else is read); anything else outside the exact shape is unusable. */
function parseDeliverablesFile(data: unknown):
  | { readonly ok: true; readonly records: readonly DeliverableRecord[] }
  | {
      readonly ok: false;
      readonly code: "DELIVERABLES_FORMAT_NEWER" | "DELIVERABLES_STORE_UNUSABLE";
      readonly reason: string;
    } {
  const bad = (reason: string) =>
    ({ ok: false, code: "DELIVERABLES_STORE_UNUSABLE", reason }) as const;
  if (!isObject(data)) return bad("not an object");
  const version = data.formatVersion;
  if (
    typeof version === "number" &&
    Number.isInteger(version) &&
    version > DELIVERABLES_FORMAT_VERSION
  )
    return { ok: false, code: "DELIVERABLES_FORMAT_NEWER", reason: `format ${version}` };
  if (version !== DELIVERABLES_FORMAT_VERSION) return bad("no supported formatVersion");
  if (!exactKeys(data, ["formatVersion", "declarations"])) return bad("unknown or missing field");
  if (!Array.isArray(data.declarations)) return bad("declarations must be a list");
  const records: DeliverableRecord[] = [];
  const seen = new Set<string>();
  for (const entry of data.declarations) {
    const record = readRecord(entry);
    if (record === undefined) return bad("a declaration is outside the exact shape");
    if (seen.has(record.id)) return bad("duplicate declaration id");
    seen.add(record.id);
    records.push(record);
  }
  return { ok: true, records };
}

const viewOf = (record: DeliverableRecord): DeliverableView => ({
  id: record.id,
  turnId: record.turnId,
  canonicalPath: record.canonicalPath,
  title: record.title,
  kind: record.kind,
  size: record.size,
  digest: record.digest,
  declaredAt: record.declaredAt,
  snapshot: record.snapshot,
});

const withSupersession = (records: readonly DeliverableRecord[]): DeliverableEntry[] => {
  const latest = new Map<string, string>();
  const supersededBy: Array<string | null> = Array.from({ length: records.length }, () => null);
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i] as DeliverableRecord;
    const key = JSON.stringify([record.sessionId, record.canonicalPath]);
    supersededBy[i] = latest.get(key) ?? null;
    if (!latest.has(key)) latest.set(key, record.id);
  }
  return records.map((record, i) => ({ ...record, supersededBy: supersededBy[i] ?? null }));
};

const done = (result: DeclareResult | AttachSnapshotResult): DeliverablesOutcome => ({
  status: "done",
  result,
});
const declareRefused = (code: DeclareFailureCode, detail?: string): DeliverablesOutcome =>
  done(detail === undefined ? { ok: false, code } : { ok: false, code, detail });
const attachRefused = (code: AttachFailureCode, detail?: string): DeliverablesOutcome =>
  done(detail === undefined ? { ok: false, code } : { ok: false, code, detail });
const unavailable = (code: StoreCode): DeliverablesOutcome => ({ status: "unavailable", code });
const isTrusted = (who: DeliverablesCaller): boolean =>
  isText(who.sessionId) && isText(who.rootSessionId);

export function createDeliverablesStore(options: DeliverablesStoreOptions): DeliverablesStore {
  const path = NodePath.join(options.stateRoot, DELIVERABLES_FILE_RELATIVE);
  const now = options.now ?? Date.now;
  const rename = options.rename ?? NodeFSP.rename;
  const report = options.onError ?? (() => {});
  const maxRecords = options.maxRecords ?? DELIVERABLES_MAX_RECORDS;
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  const inflight = new Set<Promise<unknown>>();

  // A step starts only after the previous one settled, whatever its outcome.
  const serialized = <T>(step: () => Promise<T>): Promise<T> => {
    const result = tail.then(step, step);
    tail = result.catch(() => {});
    return result;
  };
  const tracked = <T>(call: () => Promise<T>): Promise<T> => {
    const promise = call();
    inflight.add(promise);
    const forget = () => void inflight.delete(promise);
    promise.then(forget, forget);
    return promise;
  };
  const unusable = (message: string, cause?: unknown): StoreRefusal => {
    report(cause ?? new Error(message));
    return new StoreRefusal("DELIVERABLES_STORE_UNUSABLE", message);
  };

  const load = async (): Promise<readonly DeliverableRecord[]> => {
    let raw: string;
    try {
      raw = await NodeFSP.readFile(path, "utf8");
    } catch (error) {
      if (errnoOf(error) === "ENOENT") return [];
      throw unusable("The deliverables file could not be read; it was left unchanged.", error);
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      throw unusable("The deliverables file is not valid JSON; it was left unchanged.", error);
    }
    const parsed = parseDeliverablesFile(data);
    if (parsed.ok) return parsed.records;
    if (parsed.code === "DELIVERABLES_FORMAT_NEWER") {
      report(new Error(`The deliverables file is of a newer format (${parsed.reason}).`));
      throw new StoreRefusal(parsed.code, "The deliverables file is of a newer format.");
    }
    throw unusable(
      `The deliverables file is not a valid record (${parsed.reason}); it was left unchanged.`,
    );
  };

  /** Write `records` whole to a private temporary file beside the store file, then publish it by rename. */
  const publish = async (records: readonly DeliverableRecord[]): Promise<void> => {
    const temporary = `${path}.${NodeCrypto.randomUUID()}.tmp`;
    try {
      await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
      const handle = await NodeFSP.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(
          `${JSON.stringify({ formatVersion: DELIVERABLES_FORMAT_VERSION, declarations: records }, null, 2)}\n`,
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
    } catch (error) {
      await NodeFSP.rm(temporary, { force: true }).catch(() => {});
      throw unusable(
        "The deliverables file could not be written; the previous file is unchanged.",
        error,
      );
    }
  };

  /** A refusal of the store is an unavailable answer; any other failure at the store is the store being unusable (the file is as it was). */
  const guarded = async <T>(
    run: () => Promise<T>,
    fail: (code: DeclareStoreCode) => T,
  ): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof StoreRefusal) return fail(error.code);
      report(error);
      return fail("DELIVERABLES_STORE_UNUSABLE");
    }
  };
  const notRunning = <T>(fail: (code: DeclareStoreCode) => T): T =>
    fail("DELIVERABLES_NOT_RUNNING");
  const outcomeOf = (code: DeclareStoreCode): DeliverablesOutcome => unavailable(code);
  const readOf =
    <T>() =>
    (code: DeclareStoreCode): DeliverablesRead<T> => ({ ok: false, code });

  const declare = async (
    who: DeliverablesCaller,
    args: DeclareArgs,
  ): Promise<DeliverablesOutcome> => {
    if (!isTrusted(who)) return unavailable(XC6_IDENTITY_UNAVAILABLE);
    if (
      !NodePath.isAbsolute(args.path) ||
      args.path.includes("\u0000") ||
      args.path.length > DELIVERABLE_MAX_PATH_LENGTH
    )
      return declareRefused("DELIVERABLE_REQUEST_INVALID", "The path must be an absolute path.");
    const title = args.title?.trim() ?? "";
    if (title.length > DELIVERABLE_MAX_TITLE_LENGTH || CONTROL.test(title))
      return declareRefused("DELIVERABLE_REQUEST_INVALID", "The title holds a control character.");
    const id = deliverableIdOf(who.sessionId, args.requestId);
    const requestedTitle = args.title ?? null;

    const known = (record: DeliverableRecord): DeliverablesOutcome =>
      record.requestedPath === args.path && record.requestedTitle === requestedTitle
        ? done({ ok: true, replayed: true, declaration: viewOf(record) })
        : declareRefused(
            "DELIVERABLE_REQUEST_CONFLICT",
            "This request id already declared a different path or title.",
          );

    return guarded(async () => {
      // A retry never reads the file again or needs a live run: the record is the answer.
      const recorded = await serialized(async () => (await load()).find((r) => r.id === id));
      if (recorded !== undefined) return known(recorded);

      const callerContext = options.callerContext;
      if (callerContext === undefined) return unavailable("DELIVERABLES_NOT_RUNNING");
      let run: Awaited<ReturnType<CallerContextPort>>;
      try {
        run = await callerContext(who.sessionId);
      } catch {
        return declareRefused(
          "DELIVERABLE_TURN_UNKNOWN",
          "The caller's active run could not be read.",
        );
      }
      if (!run.ok) return declareRefused("DELIVERABLE_TURN_UNKNOWN", run.detail);

      const verified = await verifyFile(args.path, run.workingFolder, options.onFileRead);
      if (!verified.ok) return declareRefused(verified.code, verified.detail);

      return serialized(async () => {
        const records = await load();
        const again = records.find((r) => r.id === id);
        if (again !== undefined) return known(again);
        if (records.length >= maxRecords)
          return declareRefused("DELIVERABLE_STORE_FULL", "The declaration store is full.");
        const name = NodePath.basename(verified.canonicalPath);
        const record: DeliverableRecord = {
          id,
          requestId: args.requestId,
          requestedPath: args.path,
          requestedTitle,
          sessionId: who.sessionId,
          rootSessionId: who.rootSessionId,
          turnId: run.runId,
          canonicalPath: verified.canonicalPath,
          title: title === "" ? name : title,
          kind: deliverableKindOf(name),
          size: verified.size,
          digest: verified.digest,
          declaredAt: now(),
          snapshot: { state: "pending" },
        };
        await publish([...records, record]);
        return done({ ok: true, replayed: false, declaration: viewOf(record) });
      });
    }, outcomeOf);
  };

  const sameSettling = (state: DeliverableSnapshotState, args: AttachSnapshotArgs): boolean =>
    "snapshotId" in args
      ? state.state === "attached" && state.snapshotId === args.snapshotId
      : state.state === "unavailable" && state.code === args.unavailable;

  const attachSnapshot = async (
    who: DeliverablesCaller,
    args: AttachSnapshotArgs,
  ): Promise<DeliverablesOutcome> => {
    if (!isTrusted(who)) return unavailable(XC6_IDENTITY_UNAVAILABLE);
    const mine = (records: readonly DeliverableRecord[]) =>
      records.find((r) => r.id === args.declarationId && r.sessionId === who.sessionId);

    // What a record that is no longer pending answers: the same settling again is a replay; anything else is a conflict.
    const settledAnswer = (record: DeliverableRecord): DeliverablesOutcome =>
      sameSettling(record.snapshot, args)
        ? done({ ok: true, replayed: true, declaration: viewOf(record) })
        : attachRefused(
            "DELIVERABLE_SNAPSHOT_CONFLICT",
            "This declaration's snapshot state is already settled differently.",
          );

    return guarded(async () => {
      const peeked = await serialized(async () => mine(await load()));
      if (peeked === undefined) return attachRefused("DELIVERABLE_UNKNOWN");
      if (peeked.snapshot.state !== "pending") return settledAnswer(peeked);

      let next: DeliverableSnapshotState;
      if ("unavailable" in args) next = { state: "unavailable", code: args.unavailable };
      else {
        const open = options.openSnapshot;
        if (open === undefined) return unavailable("DELIVERABLES_NOT_RUNNING");
        let opened: Awaited<ReturnType<SnapshotOpener>>;
        try {
          opened = await open(who.sessionId, args.snapshotId);
        } catch (error) {
          report(error);
          return unavailable("DELIVERABLES_NOT_RUNNING");
        }
        if (!opened.ok) {
          return opened.code === "unavailable"
            ? unavailable("DELIVERABLES_NOT_RUNNING")
            : attachRefused(
                "DELIVERABLE_SNAPSHOT_MISSING",
                "The snapshot store holds no such snapshot for this session.",
              );
        }
        // Only the metadata is wanted: the bytes are never read here, and the stream is closed at once.
        opened.stream.destroy();
        if (opened.digest !== peeked.digest || opened.size !== peeked.size)
          return attachRefused(
            "DELIVERABLE_SNAPSHOT_MISMATCH",
            "The snapshot is not a copy of the declared file.",
          );
        next = {
          state: "attached",
          snapshotId: args.snapshotId,
          digest: opened.digest,
          size: opened.size,
        };
      }

      return serialized(async () => {
        const records = await load();
        const record = mine(records);
        if (record === undefined) return attachRefused("DELIVERABLE_UNKNOWN");
        if (record.snapshot.state !== "pending") return settledAnswer(record);
        const settled: DeliverableRecord = { ...record, snapshot: next };
        await publish(records.map((r) => (r.id === record.id ? settled : r)));
        return done({ ok: true, replayed: false, declaration: viewOf(settled) });
      });
    }, outcomeOf);
  };

  return {
    declare: (who, args) =>
      closed ? Promise.resolve(notRunning(outcomeOf)) : tracked(() => declare(who, args)),
    attachSnapshot: (who, args) =>
      closed ? Promise.resolve(notRunning(outcomeOf)) : tracked(() => attachSnapshot(who, args)),
    list: (rootSessionId) =>
      closed
        ? Promise.resolve(notRunning(readOf<readonly DeliverableEntry[]>()))
        : tracked(() =>
            guarded(
              () =>
                serialized(async () => ({
                  ok: true as const,
                  value: withSupersession(await load()).filter(
                    (entry) => entry.rootSessionId === rootSessionId,
                  ),
                })),
              readOf<readonly DeliverableEntry[]>(),
            ),
          ),
    get: (id) =>
      closed
        ? Promise.resolve(notRunning(readOf<DeliverableEntry | null>()))
        : tracked(() =>
            guarded(
              () =>
                serialized(async () => ({
                  ok: true as const,
                  value: withSupersession(await load()).find((entry) => entry.id === id) ?? null,
                })),
              readOf<DeliverableEntry | null>(),
            ),
          ),
    close: async () => {
      closed = true;
      await Promise.allSettled(inflight);
      await tail;
    },
  };
}

/** Without a state root the module is unconfigured (the digest-only default): it starts, serves nothing, and every operation answers unavailable. */
export interface DeliverablesRegistrationOptions extends Omit<
  DeliverablesStoreOptions,
  "stateRoot"
> {
  readonly stateRoot?: string;
}

export interface DeliverablesBackendRegistration extends BackendRegistration {
  /** The running store, shared by the client handlers and the download route; undefined before start and after drain. A caller that finds it undefined answers unavailable. */
  deliverables(): DeliverablesService | undefined;
}

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const identityOf = (context: Xc6OperationContext): DeliverablesCaller | undefined =>
  text(context.sessionId) && text(context.rootSessionId) && text(context.kind)
    ? { sessionId: context.sessionId, rootSessionId: context.rootSessionId, kind: context.kind }
    : undefined;
const settled = (outcome: DeliverablesOutcome): Xc6Settled =>
  outcome.status === "done"
    ? { status: "done", result: outcome.result }
    : { status: "unavailable", code: outcome.code };

/**
 * The module's registration: the two XC-6 operations over one store, and the store itself for in-process readers (steps 14 and 16). Arguments decode strictly before the store is touched (an extra
 * key throws and the carrier reports an error). Starting never refuses: a store file that cannot be used is reported to the Backend's log and refuses each call. Drain waits for the calls in flight.
 */
export function createDeliverablesBackendRegistration(
  options: DeliverablesRegistrationOptions,
): DeliverablesBackendRegistration {
  let running: DeliverablesStore | undefined;
  const notRunning = (): Xc6Settled => ({
    status: "unavailable",
    code: "DELIVERABLES_NOT_RUNNING",
  });
  const operations: Record<string, Xc6Operation> = {
    [DELIVERABLES_DECLARE_OPERATION]: (context) => {
      const args = decodeDeclareArgs(context.args);
      const store = running;
      if (store === undefined) return notRunning();
      const who = identityOf(context);
      if (who === undefined) return { status: "unavailable", code: XC6_IDENTITY_UNAVAILABLE };
      return store.declare(who, args).then(settled);
    },
    [DELIVERABLES_ATTACH_SNAPSHOT_OPERATION]: (context) => {
      const args = decodeAttachSnapshotArgs(context.args);
      const store = running;
      if (store === undefined) return notRunning();
      const who = identityOf(context);
      if (who === undefined) return { status: "unavailable", code: XC6_IDENTITY_UNAVAILABLE };
      return store.attachSnapshot(who, args).then(settled);
    },
  };
  return {
    entry: DELIVERABLES_BACKEND_ENTRY,
    activation: {
      start: async () => {
        if (options.stateRoot === undefined) return;
        running = createDeliverablesStore({ ...options, stateRoot: options.stateRoot });
        // A first read surfaces an unusable file to the log now, not at the first call; it changes nothing.
        await running.list("");
      },
      drain: async () => {
        const store = running;
        running = undefined;
        if (store === undefined)
          return { released: [], stopped: [], transferred: [], stillLive: [] };
        await store.close();
        return {
          released: ["backend-deliverables.store"],
          stopped: [],
          transferred: [],
          stillLive: [],
        };
      },
    },
    operations,
    deliverables: () => running,
  };
}
