// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M12 Plan step 8 — the Backend's filesystem adapter of the diagnostics sink port: the ONE store of content-free diagnostic events, under `<state-root>/aetheria-diagnostics/`.
//
//   format.json    {"formatVersion": 1}          declared before any event; a newer version is refused unread (DIAGNOSTICS_FORMAT_NEWER), anything else outside the exact shape is DIAGNOSTICS_STORE_UNUSABLE
//   events.jsonl   one metadata-only event a line, appended, synced, then confirmed against the file's size
//   writer.lock    the one writer: created exclusively, holds the writing process's id; a lock whose process is gone is taken over, a live one is WRITER_EXISTS
//
// Refusal, never repair (the deliverables store's rule): an unreadable store, a line that is not an event of the closed field list, or an unfinished last line (a crash mid-append) makes the store
// unusable. It is left byte for byte as it was, and the caller shows it as unavailable. An append that fails is `failed`; one whose confirmation cannot be checked THROWS, so the recorder counts it as
// uncertain, never as stored. Every append asks the Backend's owner lock first (`assertHeld`), so a write after drain or without the lock fails closed. No parameter property: outer Node tests load this
// source with type stripping only.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { EVENT_FIELDS, SINK_RELEASED, WRITER_EXISTS } from "./entry.ts";
import type {
  AppendReceipt,
  DiagnosticEvent,
  DiagnosticsSink,
  DiagnosticsStore,
  OpenResult,
  ReadResult,
  SinkResult,
} from "./entry.ts";

export const DIAGNOSTICS_DIRECTORY = "aetheria-diagnostics";
const DIAGNOSTICS_FORMAT_VERSION = 1;
export const DIAGNOSTICS_FORMAT_FILE = "format.json";
export const DIAGNOSTICS_EVENTS_FILE = "events.jsonl";
export const DIAGNOSTICS_LOCK_FILE = "writer.lock";

const DIAGNOSTICS_IO = "DIAGNOSTICS_IO";
const DIAGNOSTICS_NOT_HELD = "DIAGNOSTICS_OWNER_LOCK_NOT_HELD";
const DIAGNOSTICS_FORMAT_NEWER = "DIAGNOSTICS_FORMAT_NEWER";
const DIAGNOSTICS_STORE_UNUSABLE = "DIAGNOSTICS_STORE_UNUSABLE";

export interface DiagnosticsStoreOptions {
  /** The Aetheria state root the Backend owns (`AETHERIA_STATE_ROOT`). */
  readonly stateRoot: string;
  /** Throws unless the Backend's owner lock is held; asked before every append. Absent: no owner check (a test seam). */
  readonly assertHeld?: (() => void) | undefined;
  /** Is the process that wrote a lock still alive? Default: the operating system's answer. A test seam. */
  readonly isAlive?: ((pid: number) => boolean) | undefined;
  /** This process's id, written into the lock. Default `process.pid`. A test seam. */
  readonly pid?: number | undefined;
}

const errnoOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException)?.code;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One queue per store: a read never sees half an append, and the one writer's appends keep their order. */
function createSerial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work);
    tail = run.catch(() => undefined);
    return run;
  };
}

const FIELDS: readonly string[] = EVENT_FIELDS;
const REQUIRED = ["eventId", "time", "host", "sessionId", "kind", "outcome"] as const;

/** A stored line is an event only when it is a plain object of the archive's closed field list with the required text fields: an unknown field is a corrupt store, never skipped. */
function isStoredEvent(value: unknown): value is DiagnosticEvent {
  if (!isObject(value)) return false;
  for (const key of Object.keys(value)) if (!FIELDS.includes(key)) return false;
  return REQUIRED.every((key) => typeof value[key] === "string");
}

type Format =
  | { readonly ok: true; readonly present: boolean }
  | { readonly ok: false; readonly code: string };

async function checkFormat(file: string): Promise<Format> {
  let text: string;
  try {
    text = await NodeFSP.readFile(file, "utf8");
  } catch (error) {
    return errnoOf(error) === "ENOENT"
      ? { ok: true, present: false }
      : { ok: false, code: DIAGNOSTICS_STORE_UNUSABLE };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, code: DIAGNOSTICS_STORE_UNUSABLE };
  }
  if (!isObject(data)) return { ok: false, code: DIAGNOSTICS_STORE_UNUSABLE };
  const version = data.formatVersion;
  if (
    typeof version === "number" &&
    Number.isInteger(version) &&
    version > DIAGNOSTICS_FORMAT_VERSION
  )
    return { ok: false, code: DIAGNOSTICS_FORMAT_NEWER };
  if (version !== DIAGNOSTICS_FORMAT_VERSION || Object.keys(data).length !== 1)
    return { ok: false, code: DIAGNOSTICS_STORE_UNUSABLE };
  return { ok: true, present: true };
}

async function readEvents(file: string): Promise<DiagnosticEvent[] | null> {
  let text: string;
  try {
    text = await NodeFSP.readFile(file, "utf8");
  } catch (error) {
    return errnoOf(error) === "ENOENT" ? [] : null;
  }
  if (text === "") return [];
  if (!text.endsWith("\n")) return null;
  const events: DiagnosticEvent[] = [];
  for (const line of text.slice(0, -1).split("\n")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return null;
    }
    if (!isStoredEvent(parsed)) return null;
    events.push(parsed);
  }
  return events;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errnoOf(error) !== "ESRCH";
  }
}

export function createDiagnosticsStore(options: DiagnosticsStoreOptions): DiagnosticsStore {
  const dir = NodePath.join(options.stateRoot, DIAGNOSTICS_DIRECTORY);
  const formatFile = NodePath.join(dir, DIAGNOSTICS_FORMAT_FILE);
  const eventsFile = NodePath.join(dir, DIAGNOSTICS_EVENTS_FILE);
  const lockFile = NodePath.join(dir, DIAGNOSTICS_LOCK_FILE);
  const isAlive = options.isAlive ?? processAlive;
  const pid = options.pid ?? process.pid;
  const serial = createSerial();

  /** Take the writer lock. A lock left by a process that is gone is removed once (the Backend's owner lock already shows no other Backend runs); a live or unreadable one is WRITER_EXISTS. */
  async function takeLock(): Promise<
    { readonly ok: true } | { readonly ok: false; readonly code: string }
  > {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await NodeFSP.open(lockFile, "wx", 0o600);
        try {
          await handle.writeFile(`${pid}\n`);
        } finally {
          await handle.close();
        }
        return { ok: true };
      } catch (error) {
        if (errnoOf(error) !== "EEXIST") return { ok: false, code: DIAGNOSTICS_IO };
      }
      let owner: number;
      try {
        owner = Number((await NodeFSP.readFile(lockFile, "utf8")).trim());
      } catch {
        return { ok: false, code: WRITER_EXISTS };
      }
      if (!Number.isInteger(owner) || owner <= 0 || owner === pid || isAlive(owner))
        return { ok: false, code: WRITER_EXISTS };
      try {
        await NodeFSP.rm(lockFile, { force: true });
      } catch {
        return { ok: false, code: DIAGNOSTICS_IO };
      }
    }
    return { ok: false, code: WRITER_EXISTS };
  }

  const openWriter = (): Promise<OpenResult> =>
    serial(async () => {
      try {
        await NodeFSP.mkdir(dir, { recursive: true, mode: 0o700 });
      } catch {
        return { ok: false, code: DIAGNOSTICS_IO } as const;
      }
      const format = await checkFormat(formatFile);
      if (!format.ok) return format;
      const existing = await readEvents(eventsFile);
      if (existing === null) return { ok: false, code: DIAGNOSTICS_STORE_UNUSABLE } as const;
      // Events with no declared format cannot be read as ours.
      if (!format.present && existing.length > 0)
        return { ok: false, code: DIAGNOSTICS_STORE_UNUSABLE } as const;
      const locked = await takeLock();
      if (!locked.ok) return locked;
      if (!format.present) {
        try {
          await NodeFSP.writeFile(
            formatFile,
            `${JSON.stringify({ formatVersion: DIAGNOSTICS_FORMAT_VERSION })}\n`,
            { flag: "wx", mode: 0o600 },
          );
        } catch (error) {
          // A format file that appeared meanwhile is judged on the next open; this writer does not go on without a declared format.
          await NodeFSP.rm(lockFile, { force: true }).catch(() => undefined);
          return {
            ok: false,
            code: errnoOf(error) === "EEXIST" ? DIAGNOSTICS_STORE_UNUSABLE : DIAGNOSTICS_IO,
          } as const;
        }
      }

      let seq = existing.length;
      let ended = false;
      const failed = (code: string): AppendReceipt => ({ status: "failed", code });
      const sink: DiagnosticsSink = {
        // Open, append one line, sync, close: nothing is held between appends, so a removed store fails the NEXT append and is never half-seen. The size the file grew by must equal the line's
        // bytes: anything else cannot be told from a store that disagrees, so the append throws and the recorder counts it as uncertain.
        append: (event) =>
          serial(async () => {
            if (ended) return failed(SINK_RELEASED);
            try {
              options.assertHeld?.();
            } catch {
              return failed(DIAGNOSTICS_NOT_HELD);
            }
            const line = `${JSON.stringify(event)}\n`;
            const bytes = Buffer.byteLength(line);
            let before = -1;
            let after = -1;
            let handle: NodeFSP.FileHandle | undefined;
            try {
              handle = await NodeFSP.open(eventsFile, "a", 0o600);
              before = (await handle.stat()).size;
              await handle.appendFile(line);
              await handle.sync();
            } catch {
              await handle?.close().catch(() => undefined);
              return failed(DIAGNOSTICS_IO);
            }
            try {
              after = (await handle?.stat())?.size ?? -1;
            } catch {
              after = -1;
            } finally {
              await handle?.close().catch(() => undefined);
            }
            if (before < 0 || after < 0 || after - before !== bytes)
              throw new Error("the stored size cannot be confirmed against the appended line");
            seq += 1;
            return { status: "stored", eventId: event.eventId, seq } satisfies AppendReceipt;
          }),
        // Appends are synced one by one, so flushing is waiting for the appends already queued.
        flush: (): Promise<SinkResult> =>
          serial(async () => (ended ? { ok: false, code: SINK_RELEASED } : { ok: true })),
        release: (): Promise<SinkResult> =>
          serial(async () => {
            if (ended) return { ok: true };
            ended = true;
            try {
              await NodeFSP.rm(lockFile, { force: true });
            } catch {
              return { ok: false, code: DIAGNOSTICS_IO };
            }
            return { ok: true };
          }),
      };
      return { ok: true, sink } as const;
    });

  const read = (): Promise<ReadResult> =>
    serial(async () => {
      const format = await checkFormat(formatFile);
      if (!format.ok) return format;
      const events = await readEvents(eventsFile);
      if (events === null || (!format.present && events.length > 0))
        return { ok: false, code: DIAGNOSTICS_STORE_UNUSABLE } as const;
      return { ok: true, events } as const;
    });

  return { openWriter, read };
}
