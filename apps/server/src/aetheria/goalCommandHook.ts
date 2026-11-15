// AETHERIA M07 step 19 (DV11; IP-67): the optional Tag the Orchestrator reads (`Effect.serviceOption`) to hand a Pi thread's typed `/goal` to the Backend, which provides it with `layerFrom`.
// A leaf (imports only Effect): the Orchestrator must not import the Backend, a cycle. `handled: true` fails the dispatch with `notice` as the command error and starts no turn;
// `handled: false` or no hook leaves T3's handling unchanged.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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

/** Provide the hook from a route function (the Backend builds it from `makeGoalCommandRoute`). */
export const layerFrom = (route: GoalCommandRoute) =>
  Layer.succeed(GoalCommandHook, GoalCommandHook.of({ route }));
