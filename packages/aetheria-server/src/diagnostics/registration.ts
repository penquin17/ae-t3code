// @effect-diagnostics globalDate:off globalRandom:off - The recorder's clock and event ids use host APIs outside an Effect runtime.
/* oxlint-disable t3code/no-low-value-comments -- The header states the authority boundary of the diagnostics operations and the state this file owns. */
// AETHERIA M12 Plan step 8 — the Backend `diagnostics-backend` registration: ONE content-free diagnostics store under `<stateRoot>/aetheria-diagnostics/` (sink.ts), ONE recorder over it, and three strict XC-6
// operations: `diagnostics.append` (the Agent host's events about its own session), `diagnostics.list` and `diagnostics.read` (a session's own events). The caller is the carrier-verified session
// (`context.sessionId`, `rootSessionId`), never an argument: an event naming another session, root or this host, an argument the contract does not list, a session the caller does not own and a caller whose
// access is revoked are refused, and nothing is stored or shown.
//
// This module only OBSERVES. The accepted fallback for channel and Backend observation (no invented channel observer) is to WRAP: `observe(operations)` returns the same table with every operation
// (but its own) recorded by the Backend's recorder from the carrier context, its result returned exactly as the operation gave it; `observeBackend(backend)` records the Backend's lifecycle. A recorder or
// store fault changes none of it: it is counted, shown in `health()` and never aborts, delays or alters what it watched.
//
// Nothing is written until the Backend has started: the activation only checks the vocabulary, and the store is opened (its folder, `format.json` and writer lock created) by `open()`, which the
// service calls after a SUCCESSFUL start that holds the Backend's owner lock. A refused or failed start therefore writes nothing (M04's contract: refused before any effect); its lifecycle event is only
// counted in `health().lifecycle.unpersisted`. The `started` event, emitted before `open()` can run, is held in memory and recorded first once the store is open.
//
// One writer: the recorder and the Agent's appends share the one sink the store opened, whose queue keeps their order. XC-7: `drain` flushes and releases the writer once; the sink is reported
// `released`, or `stillLive` when its lock could not be freed. A flush that lost events is a fact of `health()` and of the `stopped` list, not a live resource: it never keeps the Backend's state
// root locked.
import type {
  Xc6Operation,
  Xc6OperationContext,
  Xc6OperationResult,
  Xc6Settled,
} from "@t3tools/aetheria-contracts";

import type { BackendRegistration } from "../adapter.ts";
import {
  buildEvent,
  createRecorder,
  parseVocabulary,
  readPackagedVocabulary,
  type DiagnosticEvent,
  type DiagnosticsSink,
  type DiagnosticsStore,
  type Health,
  type Producer,
  type Recorder,
  type ReleaseReport,
  type Vocabulary,
} from "./entry.ts";
import { DIAGNOSTICS_BACKEND_ENTRY } from "./row.ts";
import { createDiagnosticsStore } from "./sink.ts";

export const DIAGNOSTICS_APPEND_OPERATION = "diagnostics.append";
export const DIAGNOSTICS_LIST_OPERATION = "diagnostics.list";
export const DIAGNOSTICS_READ_OPERATION = "diagnostics.read";
const DIAGNOSTICS_OPERATIONS: readonly string[] = Object.freeze([
  DIAGNOSTICS_APPEND_OPERATION,
  DIAGNOSTICS_LIST_OPERATION,
  DIAGNOSTICS_READ_OPERATION,
]);

/** The session a Backend-side event with no session of its own is attributed to (the Backend's lifecycle). No Pi session has this id, so no principal owns it. */
const DIAGNOSTICS_BACKEND_SESSION = "backend";

const DIAGNOSTICS_NOT_RUNNING = "DIAGNOSTICS_NOT_RUNNING";
const DIAGNOSTICS_ARGS_INVALID = "DIAGNOSTICS_ARGS_INVALID";
const DIAGNOSTICS_EVENT_REJECTED = "DIAGNOSTICS_EVENT_REJECTED";
const DIAGNOSTICS_FORGED_IDENTITY = "DIAGNOSTICS_FORGED_IDENTITY";
const DIAGNOSTICS_NOT_OWN_SESSION = "DIAGNOSTICS_NOT_OWN_SESSION";
const DIAGNOSTICS_ACCESS_REVOKED = "DIAGNOSTICS_ACCESS_REVOKED";
const DIAGNOSTICS_ACCESS_UNAVAILABLE = "DIAGNOSTICS_ACCESS_UNAVAILABLE";
const DIAGNOSTICS_VOCABULARY_UNUSABLE = "DIAGNOSTICS_VOCABULARY_UNUSABLE";
const DIAGNOSTICS_IDENTITY_UNAVAILABLE = "DIAGNOSTICS_IDENTITY_UNAVAILABLE";

/** The default and the largest number of events one read returns. */
const DIAGNOSTICS_READ_LIMIT = 1000;
/** Agent appends remembered for an idempotent retry; the oldest is forgotten past this. */
const REMEMBERED_APPENDS = 4096;
const STORE_RESOURCE = "backend-diagnostics.store";
const RECORDER_RESOURCE = "backend-diagnostics.recorder";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface DiagnosticsAccess {
  /** Does the caller still hold access: its session, and its root, are still bound? A revoked caller reads nothing. Throws or absent port: unavailable, never a guess. */
  readonly canRead: (caller: {
    readonly sessionId: string;
    readonly rootSessionId: string;
  }) => boolean;
  /** May the caller read the events of this OTHER session (for example a child it owns)? Default: only its own session. Asked only for a session other than the caller's. */
  readonly owns?: (
    caller: { readonly sessionId: string; readonly rootSessionId: string },
    target: string,
  ) => boolean;
}

export interface DiagnosticsRegistrationOptions {
  /** The Backend's state root. Absent: the module runs unconfigured (digest only), keeps nothing and every operation answers unavailable. */
  readonly stateRoot?: string | undefined;
  /** The access rule of list and read. Absent: they answer unavailable (the rule is never guessed). */
  readonly access?: DiagnosticsAccess | undefined;
  /** Throws unless the Backend's owner lock is held; asked before every append. Absent: no owner check (a test seam). */
  readonly assertHeld?: (() => void) | undefined;
  /** The host id written into the Backend's own events. Default `backend`. An Agent append naming it is refused. */
  readonly host?: string | undefined;
  /** The composition digest (`sha256:<hex>`) of this Backend's lifecycle, read at each event. A value of another shape is left out of the event. */
  readonly digest?: (() => string | undefined) | undefined;
  /** The effective telemetry settings this Backend was built with, shown in health. Absent: `unknown` for T3's. Aetheria itself sends no telemetry. */
  readonly telemetry?: { readonly t3?: "disabled" | "enabled" | "unknown" | undefined } | undefined;
  /** Test seam: another store than the state root's. The module owns whichever it is given for one run. */
  readonly store?: DiagnosticsStore | undefined;
  /** Test seam: the vocabulary file's text. Default: the one the installed archive carries. */
  readonly vocabularyText?: string | undefined;
  /** Epoch milliseconds. Default `Date.now`. */
  readonly clock?: (() => number) | undefined;
  /** A unique event id. Default: a random UUID. */
  readonly newId?: (() => string) | undefined;
  /** The most events one read returns. Default 1000. */
  readonly readLimit?: number | undefined;
}

export interface DiagnosticsHealth {
  /** `ok` only when the module runs and neither the recorder nor an Agent append is known to have lost an event; never "ok because nothing arrived". */
  readonly state: "not-started" | "not-open" | "unconfigured" | "ok" | "unavailable" | "released";
  readonly reasons: readonly string[];
  /** The recorder's own health (its counts, observer-error count and last failure), or null when no recorder exists. */
  readonly recorder: Health | null;
  /** Why the store could not be used (a code), or null. */
  readonly storeCode: string | null;
  readonly format: { readonly formatVersion: 1 };
  /** Agent appends through `diagnostics.append`, counted apart from the Backend's own events. */
  readonly agentAppends: {
    readonly stored: number;
    readonly failed: number;
    readonly uncertain: number;
    readonly refused: number;
  };
  /** Operations the channel wrap saw, and operations that ran while no recorder could take their event (still not changed). */
  readonly channel: { readonly observed: number; readonly unobserved: number };
  /** Backend lifecycle events that arrived while no store was open (a refused or failed start, or after a drain): counted here, never persisted. */
  readonly lifecycle: { readonly unpersisted: number };
  readonly telemetry: {
    readonly t3: "disabled" | "enabled" | "unknown";
    readonly aetheria: "none";
  };
  readonly release: ReleaseReport | null;
}

export interface BackendObservable {
  readonly observe: (listener: (event: BackendLifecycleEvent) => void | Promise<void>) => {
    readonly close: () => void;
  };
}
export type BackendLifecycleEvent =
  | { readonly kind: "started"; readonly order: readonly string[]; readonly digest: string }
  | { readonly kind: "start-failed"; readonly module: string }
  | { readonly kind: "start-refused"; readonly codes: readonly string[] }
  | { readonly kind: "disposed"; readonly ok: boolean; readonly order: readonly string[] };

export type DiagnosticsBackendRegistration = BackendRegistration & {
  /** The same operation table with each operation (but this module's own) recorded from the carrier context; results and errors pass through untouched. */
  readonly observe: (
    operations: Readonly<Record<string, Xc6Operation>>,
  ) => Readonly<Record<string, Xc6Operation>>;
  /** Record the Backend's lifecycle. Returns what stops listening. */
  readonly observeBackend: (backend: BackendObservable) => { readonly close: () => void };
  /**
   * Open the store (create its folder, `format.json` and writer lock) and the recorder. Called once by the service after a successful start that holds the owner lock; never rejects. Before it, and
   * after a drain, nothing is written. A drain that comes first wins: a store opened meanwhile is released at once.
   */
  readonly open: () => Promise<void>;
  /** Resolve once every event the recorder has accepted so far is stored (or counted lost) and the sink is flushed. A no-op before `open()` and after a drain; never rejects. */
  readonly flush: () => Promise<void>;
  readonly health: () => DiagnosticsHealth;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const refused = (code: string): Xc6Settled => ({ status: "refused", code });
const unavailable = (code: string): Xc6Settled => ({ status: "unavailable", code });
const failedSink = (code: string): DiagnosticsSink => ({
  append: async () => ({ status: "failed", code }),
  flush: async () => ({ ok: false, code }),
  release: async () => ({ ok: true }),
});

/** The keys of a strict argument object: a key outside `allowed` is not an argument of this operation. */
function strictArgs(
  args: unknown,
  allowed: readonly string[],
): Record<string, unknown> | undefined {
  if (!isObject(args)) return undefined;
  for (const key of Reflect.ownKeys(args))
    if (typeof key !== "string" || !allowed.includes(key)) return undefined;
  return args;
}

export function createDiagnosticsBackendRegistration(
  options: DiagnosticsRegistrationOptions,
): DiagnosticsBackendRegistration {
  const host = options.host ?? "backend";
  const clock = options.clock ?? Date.now;
  const readLimit = Math.max(
    1,
    Math.min(options.readLimit ?? DIAGNOSTICS_READ_LIMIT, DIAGNOSTICS_READ_LIMIT),
  );
  let mode: "not-started" | "unconfigured" | "running" | "released" = "not-started";
  let store: DiagnosticsStore | undefined;
  let sink: DiagnosticsSink | undefined;
  let recorder: Recorder | undefined;
  let vocabulary: Vocabulary | undefined;
  let storeCode: string | null = null;
  let lastRelease: ReleaseReport | null = null;
  const agent = { stored: 0, failed: 0, uncertain: 0, refused: 0 };
  let lastAgentAppend: "none" | "stored" | "failed" | "uncertain" = "none";
  const channel = { observed: 0, unobserved: 0 };
  const lifecycle = { unpersisted: 0 };
  let pendingStarted: BackendLifecycleEvent | undefined;
  let opening: Promise<void> | undefined;
  let lateWriterLive = false;
  const remembered = new Map<string, number>();

  const backendProducer = (): Producer | undefined => {
    try {
      return recorder?.producer(() => {
        const digest = options.digest?.();
        return {
          sessionId: DIAGNOSTICS_BACKEND_SESSION,
          ...(typeof digest === "string" && DIGEST.test(digest) ? { digest } : {}),
        };
      });
    } catch {
      return undefined;
    }
  };

  // ---------------------------------------------------------------- channel observation (the accepted fallback: wrap, never replace)

  const outcomeOf = (result: unknown): { kind: "operation" | "refusal"; outcome: string } => {
    const status = isObject(result) ? result.status : undefined;
    const code = isObject(result) && typeof result.code === "string" ? result.code : undefined;
    if (status === "done") return { kind: "operation", outcome: "ok" };
    if (status === "refused")
      return {
        kind: "refusal",
        outcome: code !== undefined && vocabulary?.has(code) === true ? code : "declined",
      };
    return {
      kind: "operation",
      outcome: code !== undefined && vocabulary?.has(code) === true ? code : "unavailable",
    };
  };

  /** Record one settled operation. Reads the status and code only; the result, its payload and the arguments are never kept. Never throws. */
  function noteSettled(
    name: string,
    context: Xc6OperationContext,
    started: number,
    result: unknown,
  ): void {
    try {
      const producer = recorder?.producer({
        sessionId: context.sessionId,
        rootId: context.rootSessionId,
      });
      if (producer === undefined) {
        channel.unobserved++;
        return;
      }
      channel.observed++;
      const elapsed = clock() - started;
      producer.record({
        ...outcomeOf(result),
        name,
        durationMs: Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : "unknown",
      });
    } catch {
      channel.unobserved++;
    }
  }

  function noteThrown(name: string, context: Xc6OperationContext, error: unknown): void {
    try {
      const producer = recorder?.producer({
        sessionId: context.sessionId,
        rootId: context.rootSessionId,
      });
      if (producer === undefined) {
        channel.unobserved++;
        return;
      }
      channel.observed++;
      producer.error(error, { name });
    } catch {
      channel.unobserved++;
    }
  }

  const wrap =
    (name: string, operation: Xc6Operation): Xc6Operation =>
    (context) => {
      const started = clock();
      let produced: Xc6OperationResult | Promise<Xc6OperationResult>;
      try {
        produced = operation(context);
      } catch (error) {
        noteThrown(name, context, error);
        throw error;
      }
      const watch = (result: Xc6OperationResult): void => {
        if (isObject(result) && result.status === "pending") {
          // A pending answer is returned as it is; the settled one is recorded when it arrives, on a side chain that cannot reject.
          void (result as { settle: Promise<Xc6Settled> }).settle.then(
            (settled) => noteSettled(name, context, started, settled),
            (error: unknown) => noteThrown(name, context, error),
          );
          return;
        }
        noteSettled(name, context, started, result);
      };
      if (produced instanceof Promise) {
        return produced.then(
          (result) => {
            watch(result);
            return result;
          },
          (error: unknown) => {
            noteThrown(name, context, error);
            throw error;
          },
        );
      }
      watch(produced);
      return produced;
    };

  // ---------------------------------------------------------------- the three operations

  const identityOf = (context: Xc6OperationContext) =>
    text(context.sessionId) && text(context.rootSessionId) && ID.test(context.sessionId)
      ? { sessionId: context.sessionId, rootSessionId: context.rootSessionId }
      : undefined;

  /** The caller may read: its access is held. Returns the refusal or unavailability, or undefined when it may. */
  function accessProblem(caller: {
    sessionId: string;
    rootSessionId: string;
  }): Xc6Settled | undefined {
    const access = options.access;
    if (access === undefined) return unavailable(DIAGNOSTICS_ACCESS_UNAVAILABLE);
    try {
      return access.canRead(caller) ? undefined : refused(DIAGNOSTICS_ACCESS_REVOKED);
    } catch {
      return unavailable(DIAGNOSTICS_ACCESS_UNAVAILABLE);
    }
  }

  function owns(
    caller: { sessionId: string; rootSessionId: string },
    target: string,
  ): boolean | undefined {
    if (target === caller.sessionId) return true;
    if (target === DIAGNOSTICS_BACKEND_SESSION) return false;
    try {
      return options.access?.owns?.(caller, target) === true;
    } catch {
      return undefined;
    }
  }

  function notRunning(): Xc6Settled | undefined {
    if (mode !== "running") return unavailable(DIAGNOSTICS_NOT_RUNNING);
    if (store === undefined) return unavailable(storeCode ?? DIAGNOSTICS_NOT_RUNNING);
    return undefined;
  }

  const append: Xc6Operation = async (context) => {
    const down = notRunning();
    if (down !== undefined) return down;
    const caller = identityOf(context);
    if (caller === undefined) return unavailable(DIAGNOSTICS_IDENTITY_UNAVAILABLE);
    const args = strictArgs(context.args, ["event"]);
    if (args === undefined || !Object.hasOwn(args, "event") || !isObject(args.event)) {
      agent.refused++;
      return refused(DIAGNOSTICS_ARGS_INVALID);
    }
    const proposed = args.event;
    // Identity first: an event that names another session, another root or this Backend's own host is a forged claim, whatever else is wrong with it.
    if (
      (proposed.sessionId !== undefined && proposed.sessionId !== caller.sessionId) ||
      (proposed.rootId !== undefined && proposed.rootId !== caller.rootSessionId) ||
      proposed.host === host
    ) {
      agent.refused++;
      return refused(DIAGNOSTICS_FORGED_IDENTITY);
    }
    const built = vocabulary === undefined ? undefined : buildEvent(proposed, vocabulary);
    if (built === undefined) return unavailable(DIAGNOSTICS_VOCABULARY_UNUSABLE);
    if (!built.ok) {
      agent.refused++;
      return refused(DIAGNOSTICS_EVENT_REJECTED);
    }
    const event: DiagnosticEvent = built.event;
    const again = remembered.get(event.eventId);
    if (again !== undefined)
      return { status: "done", result: { status: "stored", eventId: event.eventId, seq: again } };
    if (sink === undefined) {
      // The store never opened: the event is lost, and health says so.
      agent.failed++;
      lastAgentAppend = "failed";
      return unavailable(storeCode ?? DIAGNOSTICS_NOT_RUNNING);
    }
    let receipt: unknown;
    try {
      receipt = await sink.append(event);
    } catch {
      agent.uncertain++;
      lastAgentAppend = "uncertain";
      return unavailable("DIAGNOSTICS_APPEND_UNCERTAIN");
    }
    const r = isObject(receipt) ? receipt : {};
    if (r.status === "failed") {
      agent.failed++;
      lastAgentAppend = "failed";
      return unavailable(
        typeof r.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(r.code)
          ? r.code
          : "DIAGNOSTICS_APPEND_FAILED",
      );
    }
    // The confirmation must name this event at a position: anything else is not "stored".
    if (
      r.status === "stored" &&
      r.eventId === event.eventId &&
      typeof r.seq === "number" &&
      Number.isSafeInteger(r.seq) &&
      r.seq > 0
    ) {
      agent.stored++;
      lastAgentAppend = "stored";
      remembered.set(event.eventId, r.seq);
      if (remembered.size > REMEMBERED_APPENDS)
        remembered.delete(remembered.keys().next().value as string);
      return { status: "done", result: { status: "stored", eventId: event.eventId, seq: r.seq } };
    }
    agent.uncertain++;
    lastAgentAppend = "uncertain";
    return unavailable("DIAGNOSTICS_APPEND_UNCERTAIN");
  };

  /** The caller's readable events: the verified caller, its access held, only sessions it owns. Returns the events of those sessions in stored order. */
  async function readableEvents(
    context: Xc6OperationContext,
    allowed: readonly string[],
    target: string | undefined,
  ): Promise<
    | Xc6Settled
    | {
        readonly events: readonly DiagnosticEvent[];
        readonly caller: { sessionId: string; rootSessionId: string };
      }
  > {
    const down = notRunning();
    if (down !== undefined) return down;
    const caller = identityOf(context);
    if (caller === undefined) return unavailable(DIAGNOSTICS_IDENTITY_UNAVAILABLE);
    const args = strictArgs(context.args, allowed);
    if (args === undefined) return refused(DIAGNOSTICS_ARGS_INVALID);
    if (target !== undefined && !ID.test(target)) return refused(DIAGNOSTICS_ARGS_INVALID);
    const problem = accessProblem(caller);
    if (problem !== undefined) return problem;
    if (target !== undefined) {
      const mine = owns(caller, target);
      if (mine === undefined) return unavailable(DIAGNOSTICS_ACCESS_UNAVAILABLE);
      if (!mine) return refused(DIAGNOSTICS_NOT_OWN_SESSION);
    }
    const read = await (store as DiagnosticsStore).read();
    if (!read.ok) return unavailable(read.code);
    return { events: read.events, caller };
  }

  const isSettled = (value: unknown): value is Xc6Settled => isObject(value) && "status" in value;

  const list: Xc6Operation = async (context) => {
    const got = await readableEvents(context, [], undefined);
    if (isSettled(got)) return got;
    const sessions = new Map<string, { eventCount: number; lastTime: string }>();
    for (const event of got.events) {
      const mine = owns(got.caller, event.sessionId);
      if (mine === undefined) return unavailable(DIAGNOSTICS_ACCESS_UNAVAILABLE);
      if (!mine) continue;
      const known = sessions.get(event.sessionId);
      sessions.set(event.sessionId, {
        eventCount: (known?.eventCount ?? 0) + 1,
        lastTime: event.time,
      });
    }
    return {
      status: "done",
      result: {
        sessions: [...sessions].map(([sessionId, facts]) => ({ sessionId, ...facts })),
        recorder: health().state,
      },
    };
  };

  const read: Xc6Operation = async (context) => {
    const down = notRunning();
    if (down !== undefined) return down;
    // The keys are judged first, so an unknown field is never answered as a bad value; the session defaults to the verified caller's own.
    const args = strictArgs(context.args, ["sessionId", "limit"]);
    if (args === undefined) return refused(DIAGNOSTICS_ARGS_INVALID);
    const target = args.sessionId === undefined ? context.sessionId : args.sessionId;
    const limit = args.limit === undefined ? readLimit : args.limit;
    if (
      typeof target !== "string" ||
      typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > readLimit
    )
      return refused(DIAGNOSTICS_ARGS_INVALID);
    const got = await readableEvents(context, ["sessionId", "limit"], target);
    if (isSettled(got)) return got;
    const own = got.events.filter((event) => event.sessionId === target);
    const events = own.length > limit ? own.slice(own.length - limit) : own;
    return {
      status: "done",
      result: {
        sessionId: target,
        events,
        truncated: events.length < own.length,
        recorder: health().state,
      },
    };
  };

  // ---------------------------------------------------------------- health

  function health(): DiagnosticsHealth {
    const snapshot = (() => {
      try {
        return recorder?.health() ?? null;
      } catch {
        return null;
      }
    })();
    const reasons: string[] = [];
    if (storeCode !== null) reasons.push("store-unavailable");
    if (snapshot !== null) reasons.push(...snapshot.reasons);
    if (lastAgentAppend === "failed") reasons.push("agent-append-failed");
    if (lastAgentAppend === "uncertain") reasons.push("agent-append-uncertain");
    let state: DiagnosticsHealth["state"];
    if (mode === "not-started") state = "not-started";
    else if (mode === "unconfigured") state = "unconfigured";
    else if (reasons.length > 0) state = "unavailable";
    else if (mode === "released") state = "released";
    else if (recorder === undefined) state = "not-open";
    else state = snapshot !== null && snapshot.state === "unavailable" ? "unavailable" : "ok";
    return Object.freeze({
      state,
      reasons: Object.freeze(reasons),
      recorder: snapshot,
      storeCode,
      format: Object.freeze({ formatVersion: 1 as const }),
      agentAppends: Object.freeze({ ...agent }),
      channel: Object.freeze({ ...channel }),
      lifecycle: Object.freeze({ ...lifecycle }),
      telemetry: Object.freeze({
        t3: options.telemetry?.t3 ?? "unknown",
        aetheria: "none" as const,
      }),
      release: lastRelease,
    });
  }

  // ---------------------------------------------------------------- opening the store (after a successful start only)

  async function openStore(): Promise<void> {
    if (mode !== "running" || vocabulary === undefined || recorder !== undefined) return;
    const candidate =
      options.store ??
      createDiagnosticsStore({
        stateRoot: options.stateRoot as string,
        ...(options.assertHeld === undefined ? {} : { assertHeld: options.assertHeld }),
      });
    let opened: Awaited<ReturnType<DiagnosticsStore["openWriter"]>>;
    try {
      opened = await candidate.openWriter();
    } catch {
      opened = { ok: false, code: "DIAGNOSTICS_IO" };
    }
    if (mode !== "running") {
      // A drain came while the store was opening: this writer was never served, so free it now and report it live only if that fails.
      if (opened.ok) {
        const freed = await opened.sink.release().catch(() => ({ ok: false }));
        if (!freed.ok) lateWriterLive = true;
      }
      return;
    }
    store = candidate;
    if (opened.ok) sink = opened.sink;
    else storeCode = opened.code;
    recorder = createRecorder({
      host,
      vocabulary,
      sink: sink ?? failedSink(storeCode ?? "DIAGNOSTICS_IO"),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.newId === undefined ? {} : { newId: options.newId }),
    });
    const held = pendingStarted;
    pendingStarted = undefined;
    if (held !== undefined) {
      try {
        backendProducer()?.record({
          kind: "lifecycle",
          name: `backend.${held.kind}`,
          outcome: "ok",
        });
        // `start()` returns only after the `started` event is stored, so the store holds exactly that event while the Backend is idle and nothing writes into the root after the start returned.
        await recorder.flush();
      } catch {
        /* observation never reaches the lifecycle */
      }
    }
  }

  // ---------------------------------------------------------------- the registration

  const served: Record<string, Xc6Operation> = {
    [DIAGNOSTICS_APPEND_OPERATION]: append,
    [DIAGNOSTICS_LIST_OPERATION]: list,
    [DIAGNOSTICS_READ_OPERATION]: read,
  };

  return {
    entry: DIAGNOSTICS_BACKEND_ENTRY,
    operations: Object.freeze(served),
    activation: {
      start: async () => {
        if (options.stateRoot === undefined && options.store === undefined) {
          mode = "unconfigured";
          return;
        }
        mode = "running";
        // Nothing below stops the Backend: a store, a format or a vocabulary that cannot be used is shown in health, and every event that arrives is counted as lost, never as stored.
        const parsed = (() => {
          try {
            return parseVocabulary(options.vocabularyText ?? readPackagedVocabulary());
          } catch {
            return undefined;
          }
        })();
        if (parsed === undefined || !parsed.ok) {
          storeCode = DIAGNOSTICS_VOCABULARY_UNUSABLE;
          return;
        }
        // The vocabulary is read from the installed archive, not the state root. The store is NOT opened here: a Backend whose start is refused or fails later must have written nothing (see `open`).
        vocabulary = parsed.vocabulary;
      },
      drain: async () => {
        mode = mode === "running" ? "released" : mode;
        // An open still in flight sees the released mode and frees what it took; wait for it, so the report below is about the one writer there is.
        await opening?.catch(() => undefined);
        const closing = recorder;
        if (closing === undefined)
          return {
            released: [],
            stopped: [],
            transferred: [],
            stillLive: lateWriterLive ? [STORE_RESOURCE] : [],
          };
        let report: ReleaseReport;
        try {
          report = await closing.release();
        } catch {
          report = {
            ok: false,
            flush: {
              ok: false,
              sinkFlushed: false,
              stored: 0,
              appendFailed: 0,
              appendUncertain: 0,
            },
            sinkReleased: false,
          };
        }
        lastRelease = report;
        // A sink that never opened holds no lock: there is nothing live to report for it.
        const holdsWriter = sink !== undefined;
        return {
          released: holdsWriter && report.sinkReleased ? [STORE_RESOURCE] : [],
          stopped: [
            RECORDER_RESOURCE,
            ...(report.flush.ok ? [] : [`${RECORDER_RESOURCE}-unflushed`]),
          ],
          transferred: [],
          stillLive: holdsWriter && !report.sinkReleased ? [STORE_RESOURCE] : [],
        };
      },
    },
    observe: (operations) => {
      const table: Record<string, Xc6Operation> = Object.create(null);
      for (const [name, operation] of Object.entries(operations))
        table[name] = DIAGNOSTICS_OPERATIONS.includes(name) ? operation : wrap(name, operation);
      return Object.freeze(table);
    },
    open: () => (opening ??= openStore().catch(() => undefined)),
    flush: async () => {
      try {
        await recorder?.flush();
      } catch {
        /* a flush that fails is shown in health, never thrown */
      }
    },
    observeBackend: (backend) =>
      backend.observe((event) => {
        try {
          const producer = backendProducer();
          if (producer === undefined) {
            // No store is open (the start was refused or failed, or the module is drained): nothing is persisted. The one event that precedes `open()` on a good start is held for it.
            if (event.kind === "started" && mode === "running" && opening === undefined)
              pendingStarted = event;
            else lifecycle.unpersisted++;
            return;
          }
          const name = `backend.${event.kind}`;
          const outcome =
            event.kind === "started" || (event.kind === "disposed" && event.ok)
              ? "ok"
              : event.kind === "start-refused"
                ? "declined"
                : "error";
          producer.record({ kind: "lifecycle", name, outcome });
        } catch {
          /* observation never reaches the lifecycle */
        }
      }),
    health,
  };
}
