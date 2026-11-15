// @effect-diagnostics globalDate:off
// AETHERIA M11 Plan step 18 (C5 P4; D8–D12) — resolve and settle ONE live client query: which page, one correlated request to it, one wait, one outcome.
//
// Who is eligible. Only the clients the Backend's region registry says are viewing the REQUESTING thread (N1) — the thread is the verified caller's, never an argument — through the `ClientPort` the app wiring
// supplies (this package never imports the app). None is `no-client`; more than one is `ambiguous` with ids and last-seen only (no principal, device, region or other thread); an explicit id that is not in that set is
// `no-client`. There is no fallback to the latest or to a principal's own client.
//
// One attempt, one wait. The request goes once to the selected connection and the call is held until a reply, the connection's end, or the Backend's deadline D. D never resets on a reconnect. The waiting table holds
// only the request id, the selected connection and client, the thread and its timer: no value is kept after settlement, and nothing is reissued. It is internal and is NOT an XC-6 pending token. A reply is accepted
// only from the connection that was asked, for a client that still views the thread through that same connection; any other reply, a duplicate and a late one is dropped (counted by code, never logged with content). A
// client that left the thread or whose connection ended settles `disconnected`.
//
// What a reply may carry. The page's answer is plain data; the Backend applies the descriptor again: a value passes only for a field its descriptor (as the page itself reported it to the registry) marks `value`, a
// field marked `shape` is omitted as `not-allowed`, and an unmounted (inactive) region carries its shape and no value.
import { decodeProviderQuery, type InspectState, type Omission } from "./inspectEntry.ts";

export interface ClientField {
  readonly name: string;
  readonly type: string;
  readonly report: "value" | "shape";
}
export interface ClientRegionInfo {
  readonly id: string;
  readonly kind: string;
  readonly description: string;
  readonly schemaVersion: number;
  readonly visible: boolean;
  readonly props: readonly ClientField[];
  readonly state: readonly ClientField[];
  readonly tokens: readonly string[];
}
/** A viewer as the port reports it: no principal, device or other thread. */
export interface ClientView {
  readonly clientId: string;
  readonly connectionId: string;
  readonly lastSeenMs: number;
  readonly regions: readonly ClientRegionInfo[];
}
export interface ClientRequest {
  readonly requestId: string;
  readonly regionId: string;
  readonly schemaVersion: number;
  readonly remainingMs: number;
}
/** What the app wiring supplies over M10's registry and its own request streams. `send` is true when the request was put on the connection's open request stream. */
export interface ClientPort {
  viewers(threadId: string): readonly ClientView[];
  viewer(threadId: string, clientId: string): ClientView | undefined;
  send(connectionId: string, request: ClientRequest): boolean;
}

export type ClientQueryAnswer =
  | {
      readonly outcome: "ok";
      readonly clientId: string;
      readonly state: InspectState;
      readonly shape: unknown;
      readonly values: Record<string, unknown>;
      readonly omitted: Omission[];
    }
  | {
      readonly outcome: "ambiguous";
      readonly clients: ReadonlyArray<{ readonly clientId: string; readonly lastSeenMs: number }>;
    }
  | {
      readonly outcome:
        | "no-client"
        | "disconnected"
        | "timeout"
        | "unavailable"
        | "region-not-found"
        | "schema-unsupported";
    };

/** Counts and codes only: no id, value or text of a page ever reaches a log. */
export interface ClientLogEvent {
  readonly event: "reply-dropped" | "reply-accepted" | "settled";
  readonly code?: string;
  readonly outcome?: string;
}

export interface ClientQueriesOptions {
  readonly port: ClientPort;
  /** The Backend's one deadline D. */
  readonly deadlineMs: number;
  readonly schedule: (ms: number, fn: () => void) => () => void;
  readonly newId: () => string;
  readonly log?: (event: ClientLogEvent) => void;
}

export interface ClientQueries {
  /** The regions the clients viewing this thread have mounted, one entry per region id (the registry's live view, no page request). */
  regions(threadId: string): readonly ClientRegionInfo[];
  query(input: {
    readonly threadId: string;
    readonly regionId: string;
    readonly clientId?: string;
    /** Settles when the holder's call ends (its deadline, a drain): the waiting entry is then removed, whatever the page still does. */
    readonly until?: Promise<unknown>;
  }): Promise<ClientQueryAnswer>;
  /** A page's reply on `connectionId`. */
  reply(input: {
    readonly connectionId: string;
    readonly requestId: string;
    readonly reply: unknown;
  }): "accepted" | "dropped";
  /** The connection's request stream ended: every query waiting on it settles `disconnected`. Returns how many. */
  connectionEnded(connectionId: string): number;
  held(): number;
  /** Stop: refuse new queries, settle every waiting one `unavailable`. */
  drain(): { readonly stopped: number };
}

interface Waiting {
  readonly connectionId: string;
  readonly clientId: string;
  readonly threadId: string;
  readonly regionId: string;
  readonly settle: (answer: ClientQueryAnswer) => void;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const hasOnly = (record: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(record).every((key) => allowed.includes(key));

/** The shape a region's descriptor declares: every field with its type and what a query may report of it. */
const shapeOf = (info: ClientRegionInfo): unknown => ({
  id: info.id,
  kind: info.kind,
  description: info.description,
  schemaVersion: info.schemaVersion,
  props: info.props.map((f) => ({ name: f.name, type: f.type, report: f.report })),
  state: info.state.map((f) => ({ name: f.name, type: f.type, report: f.report })),
  tokens: [...info.tokens],
});

/** Applies the descriptor again to what the page sent. Returns a ready answer or `undefined` when the reply is not a well-formed page reply. */
function judgeReply(
  reply: unknown,
  view: ClientView,
  regionId: string,
): ClientQueryAnswer | undefined {
  if (!isRecord(reply)) return undefined;
  if (
    reply.outcome === "region-not-found" ||
    reply.outcome === "schema-unsupported" ||
    reply.outcome === "unavailable"
  )
    return hasOnly(reply, ["outcome"]) ? { outcome: reply.outcome } : undefined;
  if (reply.outcome !== "ok" || !hasOnly(reply, ["outcome", "state", "shape", "values"]))
    return undefined;
  if (reply.state !== "active" && reply.state !== "inactive") return undefined;
  if (!isRecord(reply.values)) return undefined;
  // Plain data, by the core's own check: a function, accessor, symbol, class instance or cycle is refused.
  const plainShape = decodeProviderQuery({ outcome: "ok", state: reply.state, shape: reply.shape });
  const plainValues = decodeProviderQuery({
    outcome: "ok",
    state: reply.state,
    shape: reply.values,
  });
  if (!plainShape.ok || !plainValues.ok) return undefined;
  const info = view.regions.find((r) => r.id === regionId);
  if (info === undefined || reply.state === "inactive")
    // Declared but not mounted (the registry holds no descriptor), or reported so by the page: the shape alone.
    return {
      outcome: "ok",
      clientId: view.clientId,
      state: "inactive",
      shape: info === undefined ? reply.shape : shapeOf(info),
      values: {},
      omitted: [],
    };
  const values: Record<string, unknown> = {};
  const omitted: Omission[] = [];
  const consider = (group: "props" | "state", fields: readonly ClientField[]) => {
    for (const field of fields) {
      const key = `${group}.${field.name}`;
      if (field.report === "shape") omitted.push({ path: key, reason: "not-allowed" });
      else if (Object.hasOwn(reply.values as object, key))
        values[key] = (reply.values as Record<string, unknown>)[key];
    }
  };
  consider("props", info.props);
  consider("state", info.state);
  for (const token of info.tokens) {
    const key = `tokens.${token}`;
    if (Object.hasOwn(reply.values as object, key))
      values[key] = (reply.values as Record<string, unknown>)[key];
  }
  return {
    outcome: "ok",
    clientId: view.clientId,
    state: "active",
    shape: shapeOf(info),
    values,
    omitted,
  };
}

export function createClientQueries(options: ClientQueriesOptions): ClientQueries {
  const waiting = new Map<string, Waiting>();
  let draining = false;
  const note = (event: ClientLogEvent): void => {
    try {
      options.log?.(event);
    } catch {
      /* a failing log never changes a settlement */
    }
  };

  const queries: ClientQueries = {
    regions(threadId) {
      const byId = new Map<string, ClientRegionInfo>();
      for (const viewer of options.port.viewers(threadId))
        for (const region of viewer.regions) {
          const held = byId.get(region.id);
          // One entry per id: mounted-and-visible anywhere counts as visible; the first descriptor stands for the shape.
          if (held === undefined) byId.set(region.id, region);
          else if (!held.visible && region.visible) byId.set(region.id, { ...held, visible: true });
        }
      return [...byId.values()].toSorted((a, b) => (a.id < b.id ? -1 : 1));
    },

    query({ threadId, regionId, clientId, until }) {
      if (draining) return Promise.resolve({ outcome: "unavailable" });
      const viewers =
        clientId === undefined
          ? options.port.viewers(threadId)
          : [options.port.viewer(threadId, clientId)].filter(
              (v): v is ClientView => v !== undefined,
            );
      if (viewers.length === 0) return Promise.resolve({ outcome: "no-client" });
      if (viewers.length > 1)
        return Promise.resolve({
          outcome: "ambiguous",
          clients: viewers
            .map((v) => ({ clientId: v.clientId, lastSeenMs: v.lastSeenMs }))
            .toSorted((a, b) => (a.clientId < b.clientId ? -1 : 1)),
        });
      const selected = viewers[0]!;
      // Revalidated at the moment of sending: the membership and the connection are the ones just read.
      const current = options.port.viewer(threadId, selected.clientId);
      if (current === undefined || current.connectionId !== selected.connectionId)
        return Promise.resolve({ outcome: "no-client" });
      const requestId = options.newId();
      return new Promise<ClientQueryAnswer>((resolve) => {
        let cancel: () => void = () => undefined;
        const entry: Waiting = {
          connectionId: selected.connectionId,
          clientId: selected.clientId,
          threadId,
          regionId,
          settle: (answer) => {
            if (!waiting.delete(requestId)) return;
            cancel();
            note({ event: "settled", outcome: answer.outcome });
            resolve(answer);
          },
        };
        waiting.set(requestId, entry);
        cancel = options.schedule(options.deadlineMs, () => entry.settle({ outcome: "timeout" }));
        const ended = () => entry.settle({ outcome: "timeout" });
        until?.then(ended, ended);
        const region = selected.regions.find((r) => r.id === regionId);
        let sent = false;
        try {
          sent = options.port.send(selected.connectionId, {
            requestId,
            regionId,
            schemaVersion: region?.schemaVersion ?? 1,
            remainingMs: options.deadlineMs,
          });
        } catch {
          sent = false;
        }
        // No open request stream: nothing was sent, so no attempt was made and no page answers.
        if (!sent) entry.settle({ outcome: "no-client" });
      });
    },

    reply({ connectionId, requestId, reply }) {
      const entry = waiting.get(requestId);
      if (entry === undefined) {
        note({ event: "reply-dropped", code: "no-waiting-query" });
        return "dropped";
      }
      if (entry.connectionId !== connectionId) {
        note({ event: "reply-dropped", code: "wrong-connection" });
        return "dropped";
      }
      const view = options.port.viewer(entry.threadId, entry.clientId);
      if (view === undefined || view.connectionId !== connectionId) {
        // The page left the thread (or another connection took its id) while it answered: what it holds no longer answers for this thread.
        note({ event: "reply-dropped", code: "membership-lost" });
        entry.settle({ outcome: "disconnected" });
        return "dropped";
      }
      const answer = judgeReply(reply, view, entry.regionId);
      if (answer === undefined) {
        note({ event: "reply-dropped", code: "malformed" });
        entry.settle({ outcome: "unavailable" });
        return "dropped";
      }
      note({ event: "reply-accepted" });
      entry.settle(answer);
      return "accepted";
    },

    connectionEnded(connectionId) {
      let settled = 0;
      for (const entry of waiting.values())
        if (entry.connectionId === connectionId) {
          entry.settle({ outcome: "disconnected" });
          settled += 1;
        }
      return settled;
    },

    held: () => waiting.size,

    drain() {
      draining = true;
      const entries = [...waiting.values()];
      for (const entry of entries) entry.settle({ outcome: "unavailable" });
      return { stopped: entries.length };
    },
  };
  return Object.freeze(queries);
}
