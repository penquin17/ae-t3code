// @effect-diagnostics globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M06 Plan step 6 (IP-20 to IP-22) — the handlers behind the XC-18 client RPCs (`aetheria.interactions.*`, `aetheria.planMode.*`,
// `aetheria.tasks.get`, `aetheria.plan.decide`, `aetheria.authorization.grant`).
//
// Authority. T3 authorizes the method's scope before a handler runs (`RpcAuthorization`: reads and the change stream `orchestration:read`, the seven
// actions `orchestration:operate`). Here the actor is built ONLY from the connection — the authenticated session's id, its granted scopes and the
// time the connection was authenticated — and handed to the interaction service, which checks scope and root/session access again itself. A payload
// has no field for an actor, and none is read.
//
// Honesty. Snapshot, answer and the change stream are served by the one interaction service. Every other method answers `INTERACTION_UNAVAILABLE`
// until its step builds it, and reaches no service. A service that is not running, or whose call fails, is unavailable: an answer whose write may
// have landed says "outcome unknown", never a definite non-execution.
import type {
  AuthorizationGrantResult,
  InteractionActionResult,
  InteractionsAnswerPayload,
  InteractionsChangeEvent,
  InteractionsChangesPayload,
  InteractionsSnapshotPayload,
  InteractionsSnapshotResult,
  PlanModeGetResult,
  PlanModeSetResult,
  TasksGetResult,
} from "@t3tools/aetheria-contracts";
import type { AetheriaBackendService, ClientActor } from "@t3tools/aetheria-server";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

type Backend = Option.Option<Pick<AetheriaBackendService, "interactions">>;

const UNAVAILABLE = "INTERACTION_UNAVAILABLE" as const;
const unavailable = (detail: string) => ({ ok: false as const, code: UNAVAILABLE, detail });

/**
 * The actor of one connection. T3's session carries no issue time, so the authentication time is the moment this connection's handler layer was
 * built, which is after the session was accepted on the upgrade.
 */
export const connectionActor = (session: {
  readonly sessionId: string;
  readonly scopes: ReadonlyArray<string>;
}): Effect.Effect<ClientActor> =>
  DateTime.now.pipe(
    Effect.map((now) => ({
      clientSessionId: session.sessionId,
      grantedScopes: [...session.scopes],
      authenticatedAt: DateTime.formatIso(now),
    })),
  );

/** Run one service call. A rejected call is unavailable, and when the call may have written, it says the outcome is unknown. */
const call = <A>(
  backend: Backend,
  run: (service: NonNullable<ReturnType<AetheriaBackendService["interactions"]>>) => Promise<A>,
  mayHaveWritten: boolean,
): Effect.Effect<A | ReturnType<typeof unavailable>> =>
  Effect.promise(async () => {
    const service = Option.isSome(backend) ? backend.value.interactions() : undefined;
    if (service === undefined) return unavailable("the interaction service is not running");
    try {
      return await run(service);
    } catch {
      return unavailable(
        mayHaveWritten
          ? "outcome unknown: the interaction service failed while the decision may have been written"
          : "the interaction service failed",
      );
    }
  });

export const interactionsSnapshot = (
  backend: Backend,
  payload: InteractionsSnapshotPayload,
): Effect.Effect<InteractionsSnapshotResult> =>
  call(backend, (service) => service.snapshot(payload.rootSessionId), false);

export const interactionsAnswer = (
  backend: Backend,
  actor: ClientActor,
  payload: InteractionsAnswerPayload,
): Effect.Effect<InteractionActionResult> =>
  call(
    backend,
    (service) =>
      service.answer(
        { actor },
        // Only the schema's three fields travel; the actor is the connection's.
        {
          interactionId: payload.interactionId,
          revision: payload.revision,
          answers: payload.answers,
        },
      ),
    true,
  );

/** The change stream: a push that only prompts a fresh snapshot. With no running service it ends at once and the snapshot then answers unavailable. */
export const interactionsChanges = (
  backend: Backend,
  payload: InteractionsChangesPayload,
): Stream.Stream<InteractionsChangeEvent> =>
  Stream.callback<InteractionsChangeEvent>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const service = Option.isSome(backend) ? backend.value.interactions() : undefined;
        if (service === undefined) {
          Queue.endUnsafe(queue);
          return () => {};
        }
        return service.onChange((change) => {
          if (change.rootSessionId === payload.rootSessionId)
            Queue.offerUnsafe(queue, {
              rootSessionId: change.rootSessionId,
              version: change.version,
            });
        });
      }),
      (unsubscribe) => Effect.sync(unsubscribe),
    ),
  );

/** The reply of a method whose step is not built. It reaches no service and invents no state. */
export const unbuiltAction = (name: string) =>
  unavailable(`${name} is not built yet; it answers unavailable until its step`);

export const unbuiltInteractionAction = (name: string): Effect.Effect<InteractionActionResult> =>
  Effect.succeed(unbuiltAction(name));
export const unbuiltPlanModeGet = (): Effect.Effect<PlanModeGetResult> =>
  Effect.succeed(unbuiltAction("planMode.get"));
export const unbuiltTasksGet = (): Effect.Effect<TasksGetResult> =>
  Effect.succeed(unbuiltAction("tasks.get"));
export const unbuiltPlanModeSet = (): Effect.Effect<PlanModeSetResult> =>
  Effect.succeed(unbuiltAction("planMode.set"));
export const unbuiltGrant = (): Effect.Effect<AuthorizationGrantResult> =>
  Effect.succeed(unbuiltAction("authorization.grant"));
