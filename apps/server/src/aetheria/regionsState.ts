// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 23 (D17, R3, XC-7, XC-19; IP-58 to IP-60) — the Backend's region state: the declared regions each connected client reports, in memory, owned here and nowhere else.
//
// Principal. A client is stored under the principal of the CONNECTION that reported it (the authenticated subject and device session, given when the connection is opened from T3's session); a payload has no
// field for one and none is read. A client id is only a name: it is bound to the first connection that reports it, another principal that names it is refused (`REGIONS_CLIENT_CONFLICT`) and learns nothing of it,
// and only the SAME device session may take it over on a new connection (a reconnect). The viewed threads are not reported at all: the connection's own T3 `subscribeThread` subscriptions are observed
// (`observeViewing`, called from the ws.ts wrap), so a client cannot say what it is viewing.
//
// What is held. The declared descriptor (the keys the contract defines, copied; any other key is dropped) and each region's visibility — never a value: a region's props and state exist only in the page and
// are read there when M11's responder queries. A report is the WHOLE set with a sequence that must rise; a stale one changes nothing. Bounds refuse before anything is stored: regions per client, body bytes,
// clients per principal and in all, viewed threads per connection, and calls per connection (a token bucket).
//
// Lifetime. A connection's client goes away when the connection closes (T3 disconnect, via the connection's finalizer) and with the next whole report that leaves a region out; `drain()` closes everything once
// (XC-7) and returns what it removed. Nothing here makes a request or runs anything a client supplied.
//
// Reader (M11). `clientsFor`, `clientOf` and `subscribe` all take the principal, so no listing across principals exists. A principal with two clients (two tabs, two devices) gets both, each with its device;
// choosing, ambiguity and waiting are M11's.
import * as NodeCrypto from "node:crypto";

import {
  REGIONS_MAX_BODY_BYTES,
  REGIONS_MAX_CLIENTS,
  REGIONS_MAX_CLIENTS_PER_PRINCIPAL,
  REGIONS_MAX_REGIONS,
  REGIONS_MAX_VIEWING,
  REGIONS_RATE_BURST,
  REGIONS_RATE_PER_SECOND,
  REGIONS_SCHEMA_VERSION,
  type RegionDescriptor,
  type RegionsCode,
} from "@t3tools/aetheria-contracts";

export interface RegionPrincipal {
  readonly subject: string;
  readonly deviceSessionId: string;
}
export interface StoredRegion {
  readonly descriptor: RegionDescriptor;
  readonly visible: boolean;
}
/** A client as the Backend holds it: plain data, a copy of the store. */
export interface RegionClient {
  readonly clientId: string;
  readonly principal: RegionPrincipal;
  readonly sequence: number;
  readonly regions: readonly StoredRegion[];
  /** Thread ids the client's connection is observed subscribed to, oldest first. */
  readonly viewing: readonly string[];
  readonly connectedAtMs: number;
  readonly updatedAtMs: number;
}
export interface RegionEvent {
  readonly type: "client-changed" | "client-removed";
  readonly clientId: string;
}
export type RegionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: RegionsCode; readonly detail: string };

export interface ReportInput {
  readonly clientId: string;
  readonly sequence: number;
  readonly regions: ReadonlyArray<StoredRegion>;
}

/** The handle one T3 connection holds. */
export interface RegionConnection {
  report(input: ReportInput): RegionResult<RegionClient>;
  /** This connection's own client, or `undefined` before its first report. */
  readOwn(): RegionResult<RegionClient | undefined>;
  /** Records that this connection is subscribed to a thread; the returned function ends that, once. */
  observeViewing(threadId: string): () => void;
  close(): void;
}

export interface RegionDisposalReport {
  readonly connections: number;
  readonly clients: number;
  readonly regions: number;
  readonly listeners: number;
}

export interface RegionRegistry {
  openConnection(principal: RegionPrincipal): RegionConnection;
  /** Every client of this principal (matched by subject), optionally only those viewing a thread. */
  clientsFor(
    principal: { readonly subject: string },
    filter?: { readonly viewingThreadId?: string },
  ): readonly RegionClient[];
  /** One client of this principal, or `undefined` — also when the id belongs to another principal. */
  clientOf(principal: { readonly subject: string }, clientId: string): RegionClient | undefined;
  /** Events for this principal's clients only. */
  subscribe(
    principal: { readonly subject: string },
    listener: (event: RegionEvent) => void,
  ): () => void;
  drain(): RegionDisposalReport;
  stats(): { readonly connections: number; readonly clients: number };
}

export interface RegionRegistryDeps {
  readonly now: () => number;
  readonly newId: () => string;
}

const refuse = (code: RegionsCode, detail: string) => ({ ok: false as const, code, detail });
const bodyBytes = (input: unknown): number =>
  new TextEncoder().encode(JSON.stringify(input)).length;

/** The contract's own keys, copied: a smuggled key or value is dropped here and never held. */
const declared = (region: StoredRegion): StoredRegion => {
  const d = region.descriptor;
  const field = (f: { name: string; type: never; report: never }) => ({
    name: f.name,
    type: f.type,
    report: f.report,
  });
  return {
    descriptor: {
      id: d.id,
      kind: d.kind,
      owner: d.owner,
      parent: d.parent,
      description: d.description,
      schemaVersion: d.schemaVersion,
      props: d.props.map((f) => field(f as never)) as never,
      state: d.state.map((f) => field(f as never)) as never,
      tokens: [...d.tokens],
    },
    visible: region.visible === true,
  };
};

export function createRegionRegistry(deps: RegionRegistryDeps): RegionRegistry {
  interface ConnectionState {
    readonly id: string;
    readonly principal: RegionPrincipal;
    closed: boolean;
    clientId: string | undefined;
    readonly viewing: Map<string, number>;
    tokens: number;
    refilledAtMs: number;
  }
  interface ClientState {
    readonly clientId: string;
    connection: ConnectionState;
    sequence: number;
    regions: readonly StoredRegion[];
    readonly connectedAtMs: number;
    updatedAtMs: number;
  }
  const connections = new Map<string, ConnectionState>();
  const clients = new Map<string, ClientState>();
  const listeners = new Set<{
    readonly subject: string;
    readonly fn: (event: RegionEvent) => void;
  }>();
  let closed = false;

  const view = (client: ClientState): RegionClient => ({
    clientId: client.clientId,
    principal: { ...client.connection.principal },
    sequence: client.sequence,
    regions: client.regions.map((r) => structuredClone(r)),
    viewing: [...client.connection.viewing.keys()],
    connectedAtMs: client.connectedAtMs,
    updatedAtMs: client.updatedAtMs,
  });

  const emit = (type: RegionEvent["type"], subject: string, clientId: string) => {
    for (const listener of listeners) {
      if (listener.subject !== subject) continue;
      try {
        listener.fn({ type, clientId });
      } catch {
        // A subscriber's failure is its own: it never reaches a client or another subscriber.
      }
    }
  };

  const admit = (connection: ConnectionState): boolean => {
    const now = deps.now();
    const earned = Math.max(0, now - connection.refilledAtMs) / 1000;
    connection.tokens = Math.min(
      REGIONS_RATE_BURST,
      connection.tokens + earned * REGIONS_RATE_PER_SECOND,
    );
    connection.refilledAtMs = now;
    if (connection.tokens < 1) return false;
    connection.tokens -= 1;
    return true;
  };

  const touch = (connection: ConnectionState) => {
    const client = connection.clientId === undefined ? undefined : clients.get(connection.clientId);
    if (client !== undefined && client.connection === connection)
      emit("client-changed", connection.principal.subject, client.clientId);
  };

  const closeConnection = (connection: ConnectionState) => {
    if (connection.closed) return;
    connection.closed = true;
    connections.delete(connection.id);
    const client = connection.clientId === undefined ? undefined : clients.get(connection.clientId);
    connection.viewing.clear();
    if (client !== undefined && client.connection === connection) {
      clients.delete(client.clientId);
      emit("client-removed", connection.principal.subject, client.clientId);
    }
    connection.clientId = undefined;
  };

  const connectionOf = (connection: ConnectionState): RegionConnection => ({
    report(input) {
      if (closed || connection.closed)
        return refuse("REGIONS_UNAVAILABLE", "the region registry is not running");
      if (!admit(connection))
        return refuse("REGIONS_RATE_LIMITED", "too many region calls; try again shortly");
      if (bodyBytes(input) > REGIONS_MAX_BODY_BYTES)
        return refuse("REGIONS_TOO_LARGE", "the report is larger than the body cap");
      if (input.regions.length > REGIONS_MAX_REGIONS)
        return refuse("REGIONS_TOO_LARGE", "the report holds more regions than the cap");
      const ids = new Set(input.regions.map((r) => r.descriptor.id));
      if (ids.size !== input.regions.length)
        return refuse("REGIONS_INVALID_REPORT", "a region id repeats in the report");
      if (input.regions.some((r) => r.descriptor.schemaVersion !== REGIONS_SCHEMA_VERSION))
        return refuse(
          "REGIONS_SCHEMA_UNSUPPORTED",
          `this Backend speaks region schema version ${REGIONS_SCHEMA_VERSION}`,
        );
      if (connection.clientId !== undefined && connection.clientId !== input.clientId)
        return refuse(
          "REGIONS_CLIENT_CONFLICT",
          "this connection already reports a different client",
        );
      const existing = clients.get(input.clientId);
      if (
        existing !== undefined &&
        existing.connection !== connection &&
        !(
          existing.connection.principal.subject === connection.principal.subject &&
          existing.connection.principal.deviceSessionId === connection.principal.deviceSessionId
        )
      )
        return refuse(
          "REGIONS_CLIENT_CONFLICT",
          "this client id cannot be used by this connection",
        );
      if (existing !== undefined && input.sequence <= existing.sequence)
        return refuse("REGIONS_STALE", "the sequence does not rise; nothing was changed");
      if (existing === undefined) {
        const own = [...clients.values()].filter(
          (c) => c.connection.principal.subject === connection.principal.subject,
        ).length;
        if (own >= REGIONS_MAX_CLIENTS_PER_PRINCIPAL)
          return refuse(
            "REGIONS_TOO_LARGE",
            "this principal already holds the most clients allowed",
          );
        if (clients.size >= REGIONS_MAX_CLIENTS)
          return refuse("REGIONS_TOO_LARGE", "the Backend already holds the most clients allowed");
      }
      const now = deps.now();
      if (existing !== undefined && existing.connection !== connection) {
        // A reconnect of the same device session: the earlier connection no longer owns the client.
        existing.connection.clientId = undefined;
        existing.connection = connection;
      }
      const client: ClientState = existing ?? {
        clientId: input.clientId,
        connection,
        sequence: 0,
        regions: [],
        connectedAtMs: now,
        updatedAtMs: now,
      };
      client.sequence = input.sequence;
      client.regions = input.regions.map(declared);
      client.updatedAtMs = now;
      clients.set(client.clientId, client);
      connection.clientId = client.clientId;
      emit("client-changed", connection.principal.subject, client.clientId);
      return { ok: true, value: view(client) };
    },
    readOwn() {
      if (closed || connection.closed)
        return refuse("REGIONS_UNAVAILABLE", "the region registry is not running");
      if (!admit(connection))
        return refuse("REGIONS_RATE_LIMITED", "too many region calls; try again shortly");
      const client =
        connection.clientId === undefined ? undefined : clients.get(connection.clientId);
      return {
        ok: true,
        value: client !== undefined && client.connection === connection ? view(client) : undefined,
      };
    },
    observeViewing(threadId) {
      if (closed || connection.closed) return () => {};
      const held = connection.viewing.get(threadId);
      if (held === undefined && connection.viewing.size >= REGIONS_MAX_VIEWING) return () => {};
      connection.viewing.set(threadId, (held ?? 0) + 1);
      if (held === undefined) touch(connection);
      let ended = false;
      return () => {
        if (ended || connection.closed) return;
        ended = true;
        const count = connection.viewing.get(threadId);
        if (count === undefined) return;
        if (count > 1) connection.viewing.set(threadId, count - 1);
        else {
          connection.viewing.delete(threadId);
          touch(connection);
        }
      };
    },
    close: () => closeConnection(connection),
  });

  return {
    openConnection(principal) {
      const connection: ConnectionState = {
        id: deps.newId(),
        principal: { subject: principal.subject, deviceSessionId: principal.deviceSessionId },
        closed: closed,
        clientId: undefined,
        viewing: new Map(),
        tokens: REGIONS_RATE_BURST,
        refilledAtMs: deps.now(),
      };
      if (!closed) connections.set(connection.id, connection);
      return connectionOf(connection);
    },
    clientsFor(principal, filter) {
      return [...clients.values()]
        .filter((c) => c.connection.principal.subject === principal.subject)
        .filter(
          (c) =>
            filter?.viewingThreadId === undefined ||
            c.connection.viewing.has(filter.viewingThreadId),
        )
        .map(view);
    },
    clientOf(principal, clientId) {
      const client = clients.get(clientId);
      return client !== undefined && client.connection.principal.subject === principal.subject
        ? view(client)
        : undefined;
    },
    subscribe(principal, fn) {
      if (closed) return () => {};
      const entry = { subject: principal.subject, fn };
      listeners.add(entry);
      return () => void listeners.delete(entry);
    },
    drain() {
      const report: RegionDisposalReport = {
        connections: connections.size,
        clients: clients.size,
        regions: [...clients.values()].reduce((sum, c) => sum + c.regions.length, 0),
        listeners: listeners.size,
      };
      for (const connection of connections.values()) closeConnection(connection);
      clients.clear();
      listeners.clear();
      closed = true;
      return report;
    },
    stats: () => ({ connections: connections.size, clients: clients.size }),
  };
}

let shared: RegionRegistry | undefined;
/** The server's one registry: the ws.ts connections write to it and M11's reader reads from it. */
export const getSharedRegionRegistry = (): RegionRegistry =>
  (shared ??= createRegionRegistry({
    now: () => Date.now(),
    newId: () => NodeCrypto.randomUUID(),
  }));

/** XC-7: drains the shared registry with the Backend (once) and lets the next Backend in this process start a fresh one. Reports what it removed; nothing if none was ever used. */
export const drainSharedRegionRegistry = (): RegionDisposalReport => {
  const registry = shared;
  shared = undefined;
  return registry?.drain() ?? { connections: 0, clients: 0, regions: 0, listeners: 0 };
};
