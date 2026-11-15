/* oxlint-disable t3code/no-low-value-comments -- The header states why the hook is a build-time slot (the layer order and the dispatching fiber's context), the constraint a future edit must keep. */
// AETHERIA M07 step 19 (DV11; IP-67): the optional Tag the Orchestrator reads (`Effect.serviceOption`, once, when its layer is built) to hand a Pi thread's typed `/goal` to the Backend.
// A leaf (imports only Effect): the Orchestrator must not import the Backend, a cycle. `handled: true` fails the dispatch with `notice` as the command error and starts no turn;
// `handled: false` or no hook leaves T3's handling unchanged.
//
// Why a slot and not the Backend's own layer. The Backend requires the Orchestrator (managed work), so the Orchestrator's layer is built first and can never be provided the Backend's hook; and reading
// the Tag when a command is dispatched depends on which fiber's context the dispatch runs in, which the server graph does not guarantee. So, like the goal-round guard, the hook the Orchestrator
// holds is a stable object whose route is filled later: `layerWhenAetheria` is provided by the Orchestrator layer and by the Backend layer (layers memoize by reference, so both get ONE instance),
// the Orchestrator reads `GoalCommandHook` at build time, and the Backend `install`s its route into the `GoalCommandSlot` when it starts. An unfilled slot answers `handled: false`.
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export interface GoalCommandHookInput {
  /** The thread the message was sent to; the Backend resolves it to the Pi root session. */
  readonly threadId: string;
  /** The thread's provider driver kind. */
  readonly driver: string;
  readonly message: {
    readonly text: string;
    readonly attachments?: ReadonlyArray<unknown> | undefined;
  };
}

export interface GoalCommandHookResult {
  readonly handled: boolean;
  /** The outcome in one plain line, shown to the person who typed the command; read only when `handled`. */
  readonly notice?: string | undefined;
}

export type GoalCommandRoute = (
  input: GoalCommandHookInput,
) => Effect.Effect<GoalCommandHookResult>;

export class GoalCommandHook extends Context.Service<
  GoalCommandHook,
  { readonly route: GoalCommandRoute }
>()("t3/aetheria/goalCommandHook") {}

export interface GoalCommandSlotShape {
  /** Fills the slot with the Backend's route and returns the function that empties it again (only if it still holds this route). */
  readonly install: (route: GoalCommandRoute) => () => void;
  /** Whether a route is installed. */
  readonly installed: () => boolean;
}

export class GoalCommandSlot extends Context.Service<GoalCommandSlot, GoalCommandSlotShape>()(
  "t3/aetheria/goalCommandHook/GoalCommandSlot",
) {}

const notHandled: GoalCommandHookResult = { handled: false };

/** One slot and the hook that answers from it: unfilled, it does not handle anything. */
const makeGoalCommandSlot = (): {
  readonly hook: Context.Service.Shape<typeof GoalCommandHook>;
  readonly slot: GoalCommandSlotShape;
} => {
  let current: GoalCommandRoute | undefined;
  return {
    hook: {
      route: (input) => (current === undefined ? Effect.succeed(notHandled) : current(input)),
    },
    slot: {
      install: (route) => {
        current = route;
        return () => {
          if (current === route) current = undefined;
        };
      },
      installed: () => current !== undefined,
    },
  };
};

/** Provide the hook from a route function (a scripted hook, or a Backend that is built before the reader). */
export const layerFrom = (route: GoalCommandRoute) =>
  Layer.succeed(GoalCommandHook, GoalCommandHook.of({ route }));

const layerSlot: Layer.Layer<GoalCommandHook | GoalCommandSlot> = Layer.effectContext(
  Effect.sync(() => {
    const { hook, slot } = makeGoalCommandSlot();
    return Context.make(GoalCommandHook, GoalCommandHook.of(hook)).pipe(
      Context.add(GoalCommandSlot, GoalCommandSlot.of(slot)),
    );
  }),
);

/** The same variable `aetheriaBackend.ts` reads: the hook exists only when the Aetheria Backend does. */
const STATE_ROOT_ENV = "AETHERIA_STATE_ROOT";

/**
 * The one hook-and-slot layer of a server graph, present only when the Aetheria Backend is configured. A module-level constant on purpose: layers memoize by reference, so the Orchestrator layer
 * (which reads the hook) and the Backend layer (which fills the slot) receive the SAME instance. Bare T3 (no state root) gets none and keeps upstream behavior.
 */
export const layerWhenAetheria: Layer.Layer<GoalCommandHook | GoalCommandSlot> = Layer.unwrap(
  Config.String(STATE_ROOT_ENV).pipe(
    Config.option,
    Effect.map(Option.match({ onNone: () => Layer.empty, onSome: () => layerSlot })),
  ),
).pipe(Layer.orDie) as Layer.Layer<GoalCommandHook | GoalCommandSlot>;
