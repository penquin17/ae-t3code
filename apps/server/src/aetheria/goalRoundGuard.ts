// @effect-diagnostics globalTimers:off
// AETHERIA M07 (DV2, N1; IP-24): the optional guard recovery consults so a goal round in flight is never continued. Its slot is filled by the Backend, never a layer edge (startup cycle).
// Absent without AETHERIA_STATE_ROOT (bare T3 unchanged); empty, failing or unanswerable is `unknown`, which recovery treats as in flight.
//
// Startup order. T3's startup fiber runs the recovery pass before the HTTP routes exist, and the Backend's layer is built with the routes, after it; with nothing else, recovery would
// run against an empty slot and suppress EVERY main thread (and race the Backend). So the guard also carries a one-way `awaitReady`: the Backend fires it when it has started and filled the
// slot, and the recovery pass waits for it before it decides anything (ProviderRuntimeRecoveryService.ts, IP-24). The slot stays filled after the Backend drains: the answer is read from
// the goal journal, which a drained service leaves intact, so shutdown preparation still answers per thread instead of falling back to `unknown` for all of them.
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

/** `none`: this thread has no goal round in flight. `in-flight`: it has (or a restart cut one and no settle has cleared it). `unknown`: the answer cannot be given. */
export type GoalRoundAnswer = "none" | "in-flight" | "unknown";
export type GoalRoundPredicate = (threadId: string) => GoalRoundAnswer;

export interface GoalRoundGuardShape {
  /** Never throws. An unfilled slot or a failing predicate answers `unknown`. */
  readonly inFlight: (threadId: string) => GoalRoundAnswer;
  /** Fills the slot, fires `awaitReady`, and returns the function that empties it again (only if it still holds this predicate). */
  readonly install: (predicate: GoalRoundPredicate) => () => void;
  /**
   * The Backend layer ended WITHOUT filling the slot (its start failed, or the layer was torn down first): release the waiting recovery pass. The slot stays as it is — empty answers `unknown`, so
   * nothing is continued in that startup — and a slot that is already filled is untouched. Idempotent.
   */
  readonly settle: () => void;
  /** Completes once a predicate has been installed or the guard was settled (never undone). The recovery pass waits for it, so it never waits forever. */
  readonly awaitReady: Effect.Effect<void>;
}

export class GoalRoundGuard extends Context.Service<GoalRoundGuard, GoalRoundGuardShape>()(
  "t3/aetheria/goalRoundGuard",
) {}

export function makeGoalRoundGuard(): GoalRoundGuardShape {
  let slot: GoalRoundPredicate | undefined;
  let fireReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    fireReady = resolve;
  });
  return {
    inFlight: (threadId) => {
      const predicate = slot;
      if (predicate === undefined) return "unknown";
      try {
        const answer = predicate(threadId);
        return answer === "none" || answer === "in-flight" ? answer : "unknown";
      } catch {
        return "unknown";
      }
    },
    install: (predicate) => {
      slot = predicate;
      fireReady();
      return () => {
        if (slot === predicate) slot = undefined;
      };
    },
    settle: () => fireReady(),
    awaitReady: Effect.promise(() => ready),
  };
}

const layer = Layer.sync(GoalRoundGuard, makeGoalRoundGuard);

/** The same variable `aetheriaBackend.ts` reads: the Aetheria Backend exists only when it is set, and only then is there a guard to wait for. */
const STATE_ROOT_ENV = "AETHERIA_STATE_ROOT";

/**
 * The one guard layer of a server graph, present only when the Aetheria Backend is configured. A module-level constant on purpose: layers memoize by reference, so the recovery service
 * and the Backend layer, which both provide it, receive the SAME instance. Bare T3 (no state root) gets no guard and keeps upstream behaviour.
 */
export const layerWhenAetheria: Layer.Layer<GoalRoundGuard> = Layer.unwrap(
  Config.String(STATE_ROOT_ENV).pipe(
    Config.option,
    Effect.map(Option.match({ onNone: () => Layer.empty, onSome: () => layer })),
  ),
).pipe(Layer.orDie) as Layer.Layer<GoalRoundGuard>;
