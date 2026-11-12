// Resync: a view is rebuilt from a backend baseline, then increments apply in order. The client
// never replays a log, never re-sends an unconfirmed action, and a disconnect cancels nothing
// (D6). Plain TypeScript over versions the backend supplies.

import { known, unknown, type Known } from "./known";

export type Projection<T> =
  | { readonly phase: "awaiting-baseline" }
  | {
      readonly phase: "live";
      /** The version of the last baseline or increment applied. */
      readonly version: number;
      readonly value: T;
      /** The connection ended after this value was read; the value may be out of date. */
      readonly stale: boolean;
      /** A gap or a disconnect means increments cannot be trusted until a new baseline. */
      readonly needsBaseline: boolean;
    };

export const awaitingBaseline = <T>(): Projection<T> => ({ phase: "awaiting-baseline" });

/** A baseline at `version` replaces the value, unless the projection already holds a newer one. */
export function applyBaseline<T>(state: Projection<T>, version: number, value: T): Projection<T> {
  if (state.phase === "live" && version < state.version) return state;
  return { phase: "live", version, value, stale: false, needsBaseline: false };
}

/**
 * One increment. Applied only when it is the next version after a trusted state; an older or
 * duplicate one is dropped; a gap leaves the value unchanged and asks for a new baseline.
 */
export function applyIncrement<T>(
  state: Projection<T>,
  version: number,
  apply: (value: T) => T,
): Projection<T> {
  if (state.phase === "awaiting-baseline" || state.needsBaseline) return state;
  if (version <= state.version) return state;
  if (version !== state.version + 1) return { ...state, needsBaseline: true };

  return { ...state, version, value: apply(state.value) };
}

/** The connection ended: keep the last value, mark it stale, and ask for a new baseline. */
export function markDisconnected<T>(state: Projection<T>): Projection<T> {
  return state.phase === "live" ? { ...state, stale: true, needsBaseline: true } : state;
}

export function readProjection<T>(state: Projection<T>): Known<T> {
  return state.phase === "live"
    ? known(state.value)
    : unknown("waiting for the backend's baseline");
}
