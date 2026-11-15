// The goal view of one root, from a change stream and snapshot reads (M07 Plan step 18, D24, XC-23). Plain TypeScript over `core/resync.ts`, the same discipline as `control/resync.ts`.
//
// A push carries only `{rootSessionId, version}`: it NEVER changes the goal, it only asks for a fresh snapshot. The client subscribes first and reads second, so a push can arrive before the baseline; the
// highest push seen is kept and a baseline behind it asks for another read. A baseline older than the one held is dropped (the newest version wins), a duplicate or older push is dropped, a version gap marks
// the value as needing a baseline, a disconnect keeps the last value marked stale, and a failed read is never "no goal": unavailable and unknown keep the last value stale, a refusal shows no goal at all.
import {
  applyBaseline,
  awaitingBaseline,
  markDisconnected,
  type Projection,
} from "../../core/resync";
import type { FailureKind, GoalRead, GoalView } from "./reply";

export interface GoalChange {
  readonly rootSessionId: string;
  readonly version: number;
}

export interface GoalsFailure {
  readonly kind: FailureKind;
  readonly reason: string;
  readonly code?: string;
}

export interface GoalsState {
  readonly projection: Projection<GoalView | null>;
  /** The highest version any push named; a baseline below it is behind. */
  readonly highestPush: number;
  /** Why the change stream ended, when it did. */
  readonly ended: string | null;
  /** Why the last read failed, until a read succeeds. */
  readonly failure: GoalsFailure | null;
}

export type GoalsView =
  | { readonly status: "waiting"; readonly reason: string }
  | { readonly status: "live"; readonly version: number; readonly goal: GoalView | null }
  | {
      readonly status: "stale";
      readonly version: number;
      readonly goal: GoalView | null;
      readonly reason: string;
    }
  /** Nothing was read: the Backend could not take the request, or what happened is not known. */
  | {
      readonly status: "unavailable";
      readonly kind: "unavailable" | "unknown";
      readonly reason: string;
    }
  /** The Backend refused the read (no scope, revoked device, unknown root): no goal is shown. */
  | {
      readonly status: "refused";
      readonly code: string;
      readonly reason: string;
    };

export const initialGoals = (): GoalsState => ({
  projection: awaitingBaseline(),
  highestPush: 0,
  ended: null,
  failure: null,
});

export interface Step {
  readonly state: GoalsState;
  /** Whether the caller should start a snapshot read now. */
  readonly read: boolean;
}

/** A push: it never changes the goal. It asks for a read only when it names a version newer than the one held. Before the first baseline the first read is already due. */
export function pushArrived(state: GoalsState, rootSessionId: string, change: GoalChange): Step {
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
export function snapshotArrived(
  state: GoalsState,
  read: { readonly goal: GoalView | null; readonly version: number },
): Step {
  const held = state.projection;
  if (held.phase === "live" && read.version < held.version) return { state, read: false };
  // Another read is asked for only when this one moved the view forward: a Backend that keeps answering the same version a push has already passed would otherwise be read again forever.
  const progressed = held.phase !== "live" || read.version > held.version;
  return {
    state: {
      ...state,
      projection: applyBaseline(held, read.version, read.goal),
      failure: null,
    },
    read: progressed && state.highestPush > read.version,
  };
}

export const snapshotFailed = (
  state: GoalsState,
  failure: Extract<GoalRead, { tag: "failed" }>,
): GoalsState => ({
  ...state,
  failure: {
    kind: failure.kind,
    reason: failure.reason,
    ...(failure.code === undefined ? {} : { code: failure.code }),
  },
});

export const disconnected = (state: GoalsState): GoalsState => ({
  ...state,
  projection: markDisconnected(state.projection),
});

/** The stream is back: the value cannot be trusted until a new baseline, so a read is due now. */
export function reconnected(state: GoalsState): Step {
  return { state: { ...state, ended: null }, read: true };
}

export const streamEnded = (state: GoalsState, reason: string): GoalsState => ({
  ...state,
  ended: reason,
});

export function viewOf(state: GoalsState): GoalsView {
  const { failure, projection } = state;
  // A refusal ends what this client may show of the goal: the last value is not kept.
  if (failure !== null && failure.kind === "refused") {
    return { status: "refused", code: failure.code ?? "REFUSED", reason: failure.reason };
  }
  if (state.ended !== null) {
    return { status: "unavailable", kind: "unavailable", reason: state.ended };
  }
  if (projection.phase === "awaiting-baseline") {
    return failure === null
      ? { status: "waiting", reason: "waiting for the Backend's first read" }
      : {
          status: "unavailable",
          kind: failure.kind === "unknown" ? "unknown" : "unavailable",
          reason: failure.reason,
        };
  }
  if (projection.stale || failure !== null) {
    return {
      status: "stale",
      version: projection.version,
      goal: projection.value,
      reason: failure?.reason ?? "the connection ended after this was read",
    };
  }
  return { status: "live", version: projection.version, goal: projection.value };
}

/** The goal a Re-arm may act on: only a live view. A stale, waiting, unavailable or refused view offers none. */
export function liveGoal(view: GoalsView): GoalView | null {
  return view.status === "live" ? view.goal : null;
}
