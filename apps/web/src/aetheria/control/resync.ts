// The interactions view of one root, from a change stream and snapshot reads (D14, C7, XC-18). Plain TypeScript over `core/resync.ts`.
//
// The stream's pushes carry only `{rootSessionId, version}`: a push NEVER changes a record, it only asks for a fresh snapshot. The client subscribes first and reads second, so a push can arrive
// before the baseline; the highest push seen is kept, and a baseline behind it asks for another read. A duplicate or older push is dropped; a version gap marks the value as needing a baseline;
// a disconnect keeps the last value, marked stale; a stream that ended (the Backend was disposed) is "unavailable", never an empty list.
import { applyBaseline, awaitingBaseline, markDisconnected, type Projection } from "../core/resync";
import type {
  InteractionRecord,
  InteractionsChange,
  InteractionsSnapshot,
  TransportResult,
} from "./types";

export interface InteractionsState {
  readonly projection: Projection<readonly InteractionRecord[]>;
  /** The highest version any push named; a baseline below it is behind. */
  readonly highestPush: number;
  /** Why the change stream ended, when it did. */
  readonly ended: string | null;
  /** Why the last read failed, until a read succeeds. */
  readonly failure: string | null;
  /** Every interaction id any accepted read has listed, so a later read can say what left it. */
  readonly seen: readonly string[];
}

export type InteractionsView =
  | { readonly status: "waiting"; readonly reason: string }
  | {
      readonly status: "live";
      readonly version: number;
      readonly interactions: readonly InteractionRecord[];
      /** Ids an earlier read held that this read no longer lists: a disappearance, never a completion. */
      readonly vanished: readonly string[];
    }
  | {
      readonly status: "stale";
      readonly version: number;
      readonly interactions: readonly InteractionRecord[];
      readonly reason: string;
    }
  | { readonly status: "unavailable"; readonly reason: string };

export const initialInteractions = (): InteractionsState => ({
  projection: awaitingBaseline(),
  highestPush: 0,
  ended: null,
  failure: null,
  seen: [],
});

export interface Step {
  readonly state: InteractionsState;
  /** Whether the caller should start a snapshot read now. */
  readonly read: boolean;
}

/** A push: it never changes a record. It asks for a read only when it names a version newer than the one held. Before the first baseline the first read is already due. */
export function pushArrived(
  state: InteractionsState,
  rootSessionId: string,
  change: InteractionsChange,
): Step {
  if (change.rootSessionId !== rootSessionId) return { state, read: false };
  const projection = state.projection;
  if (projection.phase === "awaiting-baseline") {
    return {
      state: { ...state, highestPush: Math.max(state.highestPush, change.version) },
      read: false,
    };
  }
  if (change.version <= projection.version) return { state, read: false };
  const gap = change.version !== projection.version + 1;
  return {
    state: {
      ...state,
      highestPush: Math.max(state.highestPush, change.version),
      projection: gap ? { ...projection, needsBaseline: true } : projection,
    },
    read: true,
  };
}

/** A baseline read. An older one is dropped; one still behind a push already seen asks for another read. */
export function snapshotArrived(state: InteractionsState, snapshot: InteractionsSnapshot): Step {
  const held = state.projection;
  if (held.phase === "live" && snapshot.version < held.version) return { state, read: false };
  const projection = applyBaseline(held, snapshot.version, snapshot.interactions);
  return {
    state: {
      ...state,
      projection,
      failure: null,
      seen: [...new Set([...state.seen, ...snapshot.interactions.map((r) => r.interactionId)])],
    },
    read: state.highestPush > snapshot.version,
  };
}

export const snapshotFailed = (state: InteractionsState, reason: string): InteractionsState => ({
  ...state,
  failure: reason,
});

export const disconnected = (state: InteractionsState): InteractionsState => ({
  ...state,
  projection: markDisconnected(state.projection),
});

/** The stream is back: the value cannot be trusted until a new baseline, so a read is due now. */
export function reconnected(state: InteractionsState): Step {
  return { state: { ...state, ended: null }, read: true };
}

export const streamEnded = (state: InteractionsState, reason: string): InteractionsState => ({
  ...state,
  ended: reason,
});

export function viewOf(state: InteractionsState): InteractionsView {
  if (state.ended !== null) return { status: "unavailable", reason: state.ended };
  const projection = state.projection;
  if (projection.phase === "awaiting-baseline") {
    return state.failure === null
      ? { status: "waiting", reason: "waiting for the Backend's first read" }
      : { status: "unavailable", reason: state.failure };
  }
  if (projection.stale || state.failure !== null) {
    return {
      status: "stale",
      version: projection.version,
      interactions: projection.value,
      reason: state.failure ?? "the connection ended after this was read",
    };
  }
  const present = new Set(projection.value.map((record) => record.interactionId));
  return {
    status: "live",
    version: projection.version,
    interactions: projection.value,
    vanished: state.seen.filter((id) => !present.has(id)),
  };
}

export type SnapshotRead =
  | { readonly tag: "ok"; readonly snapshot: InteractionsSnapshot }
  | { readonly tag: "failed"; readonly reason: string; readonly code?: string };

const isSnapshot = (value: unknown, rootSessionId: string): value is InteractionsSnapshot => {
  const v = value as Partial<InteractionsSnapshot> | null;
  return (
    v !== null &&
    typeof v === "object" &&
    v.rootSessionId === rootSessionId &&
    typeof v.version === "number" &&
    Array.isArray(v.interactions)
  );
};

/** A snapshot reply as a read: a failure of any kind is a failed read, never an empty list. */
export function classifySnapshot(result: TransportResult, rootSessionId: string): SnapshotRead {
  if (result.tag === "lost")
    return { tag: "failed", reason: "the reply to the read never arrived" };
  if (result.tag === "failed") return { tag: "failed", reason: result.message };
  const reply = result.reply as {
    ok?: unknown;
    value?: unknown;
    code?: unknown;
    detail?: unknown;
  } | null;
  if (reply === null || typeof reply !== "object" || typeof reply.ok !== "boolean") {
    return { tag: "failed", reason: "the Backend's reply to the read was not a reply" };
  }
  if (!reply.ok) {
    const code = typeof reply.code === "string" ? reply.code : "UNKNOWN";
    const detail = typeof reply.detail === "string" && reply.detail !== "" ? reply.detail : code;
    return { tag: "failed", reason: detail, code };
  }
  return isSnapshot(reply.value, rootSessionId)
    ? { tag: "ok", snapshot: reply.value }
    : { tag: "failed", reason: "the Backend's snapshot was not for this session or was malformed" };
}
