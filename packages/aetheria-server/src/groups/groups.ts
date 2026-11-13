// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalRandom:off
// AETHERIA M10 Plan step 7 (D3, D4, XC-22) — the Backend's ONE session-group store and its module. The record is DSH's version-2 `{version, links, dismissed, names}` kept at
// `<state-root>/aetheria-ui/session-groups.json`; its rules are a port of DSH's aetheria-ui host group-store (host/group-store.ts; no DSH import at run time): five set operations (group, ungroup,
// dismiss, detach, rename), pairs stored with a < b, names replaced by overlap, an operation that changes nothing returns the same record and writes nothing.
//
// One writer. The Backend holds the state root's owner lock before any module starts, and this module's calls are serialised, each write replacing the whole file through a private temporary
// file in the same folder (`wx`, owner-only, synced) and a rename. Refusal, never repair: a file that is not valid JSON, not a version-1 or version-2 record, or holds an unsorted, duplicate or
// unknown shape is refused as GROUPS_STORE_UNUSABLE on every read and write and left byte for byte as it was. A valid version-1 file reads as version 2 with no names; the first CHANGING
// write publishes its exact original bytes as the sibling `session-groups.v1.json` (only when none exists), and only a complete backup lets version 2 replace it.
//
// A request is judged here before any file is read: the five exact shapes (GROUPS_INVALID_REQUEST) and the carried 8 KiB UTF-8 body cap (GROUPS_REQUEST_TOO_LARGE; never raised). Which sessions a
// connection may name is the RPC layer's question (apps/server groupsRpc.ts); `prepareGroupOperation` names every id a request refers to so that layer can ask once per session.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  GROUPS_MAX_BODY_BYTES,
  GROUPS_MAX_ID_LENGTH,
  GROUPS_MAX_NAME_LENGTH,
  GROUPS_MAX_RENAME_MEMBERS,
  type GroupsRecord,
} from "@t3tools/aetheria-contracts";

import type { BackendRegistration } from "../adapter.ts";
import { GROUPS_BACKEND_ENTRY } from "./groupsRow.ts";

export { GROUPS_BACKEND_ENTRY, GROUPS_BACKEND_ID, groupsBackendModuleRow } from "./groupsRow.ts";

/** The file under a state root. */
export const GROUPS_FILE_RELATIVE = NodePath.join("aetheria-ui", "session-groups.json");
/** The one-time copy of a version-1 file, beside the main file. */
export const GROUPS_BACKUP_FILE = "session-groups.v1.json";
/** A group name needs at least this many sessions. */
const MIN_NAME_MEMBERS = 2;

export type GroupsLink = GroupsRecord["links"][number];
export type GroupsDismissed = GroupsRecord["dismissed"][number];
export type GroupsName = GroupsRecord["names"][number];
export type { GroupsRecord };

export type GroupOperation =
  | { readonly op: "group" | "ungroup" | "dismiss"; readonly a: string; readonly b: string }
  | { readonly op: "detach"; readonly a: string }
  | { readonly op: "rename"; readonly members: readonly string[]; readonly name: string };

export type GroupsStoreCode =
  | "GROUPS_INVALID_REQUEST"
  | "GROUPS_REQUEST_TOO_LARGE"
  | "GROUPS_STORE_UNUSABLE"
  | "GROUPS_UNAVAILABLE";
export type GroupsOutcome =
  | { readonly ok: true; readonly value: GroupsRecord }
  | { readonly ok: false; readonly code: GroupsStoreCode; readonly detail: string };

const refused = (code: GroupsStoreCode, detail: string): GroupsOutcome => ({
  ok: false,
  code,
  detail,
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= GROUPS_MAX_ID_LENGTH;
const hasOnly = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));
const pairKey = (a: string, b: string): string => JSON.stringify([a, b]);
const normalizePair = (a: string, b: string): { a: string; b: string } =>
  a < b ? { a, b } : { a: b, b: a };
/** Sorted by JavaScript code unit (never locale-dependent) and unique. */
const normalizeMembers = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

export type PreparedOperation =
  | {
      readonly ok: true;
      readonly operation: GroupOperation;
      readonly ids: readonly string[];
      readonly bytes: number;
    }
  | {
      readonly ok: false;
      readonly code: "GROUPS_INVALID_REQUEST" | "GROUPS_REQUEST_TOO_LARGE";
      readonly detail: string;
    };

const invalid = (reason: string): PreparedOperation => ({
  ok: false,
  code: "GROUPS_INVALID_REQUEST",
  detail: `Invalid session-group operation: ${reason}.`,
});

/**
 * Judge one request body: only the five exact shapes pass (unknown keys, equal pair ids, a detach carrying `b`, a rename with fewer than two different ids, more than 200 ids or an over-long name are
 * invalid), then the whole body must fit 8 KiB of UTF-8 JSON. A rename comes back normalised (members sorted and unique, name trimmed). `ids` are the sorted, unique sessions the request refers to.
 */
export function prepareGroupOperation(body: unknown): PreparedOperation {
  if (!isObject(body)) return invalid("the body must be an object");
  const { op } = body;
  let operation: GroupOperation;
  if (op === "detach") {
    if (!hasOnly(body, ["op", "a"])) return invalid('detach takes only "op" and "a"');
    if (!isId(body.a)) return invalid('"a" must be a non-empty session id');
    operation = { op, a: body.a };
  } else if (op === "group" || op === "ungroup" || op === "dismiss") {
    if (!hasOnly(body, ["op", "a", "b"])) return invalid(`${op} takes only "op", "a" and "b"`);
    if (!isId(body.a) || !isId(body.b)) return invalid('"a" and "b" must be non-empty session ids');
    if (body.a === body.b) return invalid('"a" and "b" must be different sessions');
    operation = { op, a: body.a, b: body.b };
  } else if (op === "rename") {
    if (!hasOnly(body, ["op", "members", "name"]))
      return invalid('rename takes only "op", "members" and "name"');
    const { members, name } = body;
    if (
      !Array.isArray(members) ||
      members.length < MIN_NAME_MEMBERS ||
      members.length > GROUPS_MAX_RENAME_MEMBERS
    )
      return invalid(
        `"members" must list ${MIN_NAME_MEMBERS} to ${GROUPS_MAX_RENAME_MEMBERS} session ids`,
      );
    if (!members.every(isId)) return invalid("every member must be a non-empty session id");
    if (typeof name !== "string") return invalid('"name" must be a string');
    const unique = normalizeMembers(members as string[]);
    if (unique.length < MIN_NAME_MEMBERS)
      return invalid(`"members" must name at least ${MIN_NAME_MEMBERS} different sessions`);
    const trimmed = name.trim();
    if (trimmed.length > GROUPS_MAX_NAME_LENGTH)
      return invalid(`"name" must be at most ${GROUPS_MAX_NAME_LENGTH} characters`);
    operation = { op, members: unique, name: trimmed };
  } else return invalid('"op" must be group, ungroup, dismiss, detach or rename');

  // The carried cap is a validity boundary: the body as it was received, in UTF-8 bytes.
  const bytes = new TextEncoder().encode(JSON.stringify(body)).length;
  if (bytes > GROUPS_MAX_BODY_BYTES)
    return {
      ok: false,
      code: "GROUPS_REQUEST_TOO_LARGE",
      detail: `The session-group request is ${bytes} bytes, over the ${GROUPS_MAX_BODY_BYTES}-byte limit for one change.`,
    };
  const ids =
    operation.op === "rename"
      ? operation.members
      : operation.op === "detach"
        ? [operation.a]
        : normalizeMembers([operation.a, operation.b]);
  return { ok: true, operation, ids, bytes };
}

export type ParsedRecord =
  | { readonly ok: true; readonly record: GroupsRecord; readonly sourceVersion: 1 | 2 }
  | { readonly ok: false; readonly reason: string };

/**
 * Check data read from the file and return it as a version-2 record. Version 1 (links and dismissed only) and version 2 are accepted; any other version, malformed entries, unnormalised pairs,
 * duplicate pairs and unsorted, short or duplicate name member lists are refused: the store never repairs a file it did not write.
 */
export function parseGroupsRecord(data: unknown): ParsedRecord {
  const bad = (reason: string): ParsedRecord => ({ ok: false, reason });
  if (!isObject(data)) return bad("not an object");
  const version = data.version;
  if (version !== 1 && version !== 2) return bad("unsupported version");
  if (
    !hasOnly(
      data,
      version === 1
        ? ["version", "links", "dismissed"]
        : ["version", "links", "dismissed", "names"],
    )
  )
    return bad("unknown field");
  const { links, dismissed } = data;
  if (!Array.isArray(links) || !Array.isArray(dismissed))
    return bad("links and dismissed must be lists");
  if (version === 2 && !Array.isArray(data.names)) return bad("names must be a list");

  const readPair = (
    entry: unknown,
    kinds: boolean,
  ): { a: string; b: string; at: number } | string => {
    if (!isObject(entry)) return "entry is not an object";
    if (!hasOnly(entry, kinds ? ["a", "b", "kind", "at"] : ["a", "b", "at"]))
      return "unknown entry field";
    const { a, b, at } = entry;
    if (!isId(a) || !isId(b)) return "entry has an invalid session id";
    if (!(a < b)) return "entry is not stored with a < b";
    if (typeof at !== "number" || !Number.isFinite(at)) return "entry has an invalid time";
    if (kinds && entry.kind !== "grouped") return "entry has an unknown kind";
    return { a, b, at };
  };

  const readLinks: GroupsLink[] = [];
  const seenLinks = new Set<string>();
  for (const entry of links) {
    const pair = readPair(entry, true);
    if (typeof pair === "string") return bad(pair);
    if (seenLinks.has(pairKey(pair.a, pair.b))) return bad("duplicate link");
    seenLinks.add(pairKey(pair.a, pair.b));
    readLinks.push({ a: pair.a, b: pair.b, kind: "grouped", at: pair.at });
  }
  const readDismissed: GroupsDismissed[] = [];
  const seenDismissed = new Set<string>();
  for (const entry of dismissed) {
    const pair = readPair(entry, false);
    if (typeof pair === "string") return bad(pair);
    if (seenDismissed.has(pairKey(pair.a, pair.b))) return bad("duplicate dismissed pair");
    seenDismissed.add(pairKey(pair.a, pair.b));
    readDismissed.push(pair);
  }
  const readNames: GroupsName[] = [];
  if (version === 2) {
    const seenMembers = new Set<string>();
    for (const entry of data.names as unknown[]) {
      if (!isObject(entry)) return bad("name entry is not an object");
      if (!hasOnly(entry, ["members", "name", "at"])) return bad("unknown name field");
      const { members, name, at } = entry;
      if (!Array.isArray(members) || members.length < MIN_NAME_MEMBERS)
        return bad("name members must list at least two ids");
      if (!members.every(isId)) return bad("name has an invalid member id");
      for (let i = 1; i < members.length; i += 1)
        if (!((members[i - 1] as string) < (members[i] as string)))
          return bad("name members are not sorted and unique");
      if (
        typeof name !== "string" ||
        name.length === 0 ||
        name.length > GROUPS_MAX_NAME_LENGTH ||
        name !== name.trim()
      )
        return bad("name is not a trimmed 1 to 80 character string");
      if (typeof at !== "number" || !Number.isFinite(at)) return bad("name has an invalid time");
      const key = JSON.stringify(members);
      if (seenMembers.has(key)) return bad("duplicate name members");
      seenMembers.add(key);
      readNames.push({ members: members as string[], name, at });
    }
  }
  return {
    ok: true,
    record: { version: 2, links: readLinks, dismissed: readDismissed, names: readNames },
    sourceVersion: version,
  };
}

function renamed(
  record: GroupsRecord,
  operation: Extract<GroupOperation, { op: "rename" }>,
  now: number,
): GroupsRecord {
  const key = JSON.stringify(operation.members);
  const name = operation.name;
  // Exactly these members under exactly this name: nothing changes (a repeat keeps its time).
  if (
    name !== "" &&
    record.names.some((saved) => saved.name === name && JSON.stringify(saved.members) === key)
  )
    return record;
  const mine = new Set(operation.members);
  const kept = record.names.filter((saved) => !saved.members.some((id) => mine.has(id)));
  if (name === "") return kept.length === record.names.length ? record : { ...record, names: kept };
  return { ...record, names: [...kept, { members: [...operation.members], name, at: now }] };
}

/**
 * Apply one set operation. Pure: the same record object when the operation changes nothing (a repeat, an absent pair removed), otherwise a new record. `at` is introduced only when a previously
 * absent pair or name is added. Every operation but `rename` carries the saved names through unchanged.
 */
export function applyGroupOperation(
  record: GroupsRecord,
  operation: GroupOperation,
  now: number,
): GroupsRecord {
  switch (operation.op) {
    case "group": {
      const { a, b } = normalizePair(operation.a, operation.b);
      if (record.links.some((link) => link.a === a && link.b === b)) return record;
      return { ...record, links: [...record.links, { a, b, kind: "grouped", at: now }] };
    }
    case "ungroup": {
      const { a, b } = normalizePair(operation.a, operation.b);
      const links = record.links.filter((link) => !(link.a === a && link.b === b));
      return links.length === record.links.length ? record : { ...record, links };
    }
    case "dismiss": {
      const { a, b } = normalizePair(operation.a, operation.b);
      if (record.dismissed.some((pair) => pair.a === a && pair.b === b)) return record;
      return { ...record, dismissed: [...record.dismissed, { a, b, at: now }] };
    }
    case "detach": {
      const links = record.links.filter((link) => link.a !== operation.a && link.b !== operation.a);
      return links.length === record.links.length ? record : { ...record, links };
    }
    case "rename":
      return renamed(record, operation, now);
  }
}

/**
 * The record as a connection may see it: a pair is kept only when both of its sessions are, a saved name only when every member is. The file keeps the rest; this is a view, never a write.
 * `keep` is the host's per-session decision (apps/server groupsRpc.ts).
 */
export function filterGroupsRecord(
  record: GroupsRecord,
  keep: (sessionId: string) => boolean,
): GroupsRecord {
  const links = record.links.filter((link) => keep(link.a) && keep(link.b));
  const dismissed = record.dismissed.filter((pair) => keep(pair.a) && keep(pair.b));
  const names = record.names.filter((saved) => saved.members.every(keep));
  if (
    links.length === record.links.length &&
    dismissed.length === record.dismissed.length &&
    names.length === record.names.length
  )
    return record;
  return { version: 2, links, dismissed, names };
}

export interface GroupsStoreOptions {
  /** The Aetheria state root the Backend owns (`AETHERIA_STATE_ROOT`). */
  readonly stateRoot: string;
  readonly now?: () => number;
  /** Publication step of every write, the backup copy and the main file alike: replace `to` with `from`. Replaced only by tests, to inject a failure at one publication. */
  readonly rename?: (from: string, to: string) => Promise<void>;
  /** Called with the underlying cause of an unusable store, for the Backend's own log; never reaches a client. */
  readonly onError?: (error: unknown) => void;
}

export interface GroupsService {
  /** The confirmed record as version 2: the empty record when no file exists. */
  read(): Promise<GroupsOutcome>;
  /** Judge one request body, apply it and answer the confirmed record. A changed record is on disk before this resolves. Never repeated. */
  apply(body: unknown): Promise<GroupsOutcome>;
}

export interface GroupsStore extends GroupsService {
  /** Refuse new calls (GROUPS_UNAVAILABLE) and wait for the one in flight. */
  close(): Promise<void>;
}

const EMPTY: GroupsRecord = Object.freeze({
  version: 2,
  links: Object.freeze([]),
  dismissed: Object.freeze([]),
  names: Object.freeze([]),
}) as unknown as GroupsRecord;

class Unusable extends Error {}

export function createGroupsStore(options: GroupsStoreOptions): GroupsStore {
  const path = NodePath.join(options.stateRoot, GROUPS_FILE_RELATIVE);
  const backupPath = NodePath.join(NodePath.dirname(path), GROUPS_BACKUP_FILE);
  const now = options.now ?? Date.now;
  const rename = options.rename ?? NodeFSP.rename;
  const report = options.onError ?? (() => {});
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;

  // A step starts only after the previous one settled, whatever its outcome.
  const serialized = <T>(step: () => Promise<T>): Promise<T> => {
    const result = tail.then(step, step);
    tail = result.catch(() => {});
    return result;
  };
  const unusable = (message: string, cause?: unknown): Unusable => {
    report(cause ?? new Error(message));
    return new Unusable(message);
  };

  const load = async (): Promise<{
    record: GroupsRecord;
    sourceVersion: 1 | 2 | null;
    raw: Buffer | null;
  }> => {
    let raw: Buffer;
    try {
      raw = await NodeFSP.readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { record: EMPTY, sourceVersion: null, raw: null };
      throw unusable("The session group file could not be read; it was left unchanged.", error);
    }
    let data: unknown;
    try {
      data = JSON.parse(raw.toString("utf8"));
    } catch (error) {
      throw unusable("The session group file is not valid JSON; it was left unchanged.", error);
    }
    const parsed = parseGroupsRecord(data);
    if (!parsed.ok)
      throw unusable(
        `The session group file is not a valid version 1 or 2 record (${parsed.reason}); it was left unchanged.`,
      );
    return {
      record: parsed.record,
      sourceVersion: parsed.sourceVersion,
      raw: parsed.sourceVersion === 1 ? raw : null,
    };
  };

  /** Write `data` whole to a private temporary file beside `target`, then publish it by rename. */
  const publish = async (target: string, data: Buffer | string): Promise<void> => {
    const temporary = `${target}.${NodeCrypto.randomUUID()}.tmp`;
    try {
      await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
      const handle = await NodeFSP.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
    } catch (error) {
      await NodeFSP.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  };

  /** Make sure the version-1 copy exists. An existing copy, whatever it holds, is never touched. */
  const ensureBackup = async (original: Buffer): Promise<void> => {
    try {
      await NodeFSP.lstat(backupPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw unusable(
          "The session group backup could not be checked; the previous record is unchanged.",
          error,
        );
    }
    try {
      await publish(backupPath, original);
    } catch (error) {
      throw unusable(
        "The session group backup could not be written; the previous record is unchanged.",
        error,
      );
    }
  };

  const failed = (error: unknown): GroupsOutcome =>
    refused(
      "GROUPS_STORE_UNUSABLE",
      error instanceof Unusable
        ? error.message
        : "The session group store failed unexpectedly; the previous record is unchanged.",
    );

  return {
    read: () => {
      if (closed)
        return Promise.resolve(
          refused("GROUPS_UNAVAILABLE", "The group store is not running; nothing was read."),
        );
      return serialized(async (): Promise<GroupsOutcome> => {
        try {
          return { ok: true, value: (await load()).record };
        } catch (error) {
          return failed(error);
        }
      });
    },
    apply: (body) => {
      if (closed)
        return Promise.resolve(
          refused("GROUPS_UNAVAILABLE", "The group store is not running; nothing was done."),
        );
      const prepared = prepareGroupOperation(body);
      if (!prepared.ok) return Promise.resolve(refused(prepared.code, prepared.detail));
      return serialized(async (): Promise<GroupsOutcome> => {
        try {
          const loaded = await load();
          const after = applyGroupOperation(loaded.record, prepared.operation, now());
          if (after === loaded.record) return { ok: true, value: after };
          // Backup first; only a complete backup lets version 2 replace version 1.
          if (loaded.sourceVersion === 1 && loaded.raw !== null) await ensureBackup(loaded.raw);
          try {
            await publish(path, `${JSON.stringify(after, null, 2)}\n`);
          } catch (error) {
            throw unusable(
              "The session group file could not be written; the previous record is unchanged.",
              error,
            );
          }
          return { ok: true, value: after };
        } catch (error) {
          return failed(error);
        }
      });
    },
    close: async () => {
      closed = true;
      await tail;
    },
  };
}

/** Without a state root the module is unconfigured (the digest-only default): it starts, serves nothing, and every caller answers unavailable. */
export interface GroupsRegistrationOptions extends Omit<GroupsStoreOptions, "stateRoot"> {
  readonly stateRoot?: string;
}

export interface GroupsBackendRegistration extends BackendRegistration {
  /** The running store, shared by the client handlers; undefined before start and after drain. A caller that finds it undefined answers unavailable. */
  groups(): GroupsService | undefined;
}

/**
 * The module's registration. It registers no XC-6 operation: the store is served to clients only, through the RPC handlers. Starting reads and creates nothing, so a store that cannot be read does
 * not stop the Backend; it refuses each call. Drain waits for the call in flight and reports what it released.
 */
export function createGroupsBackendRegistration(
  options: GroupsRegistrationOptions,
): GroupsBackendRegistration {
  let running: GroupsStore | undefined;
  return {
    entry: GROUPS_BACKEND_ENTRY,
    activation: {
      start: () => {
        if (options.stateRoot === undefined) return;
        running = createGroupsStore({ ...options, stateRoot: options.stateRoot });
      },
      drain: async () => {
        const store = running;
        running = undefined;
        if (store === undefined)
          return { released: [], stopped: [], transferred: [], stillLive: [] };
        await store.close();
        return { released: ["backend-groups.store"], stopped: [], transferred: [], stillLive: [] };
      },
    },
    groups: () => running,
  };
}
