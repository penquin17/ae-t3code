// @effect-diagnostics globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M06 Plan steps 6 and 16 (IP-20 to IP-22) — the handlers behind the XC-18 client RPCs (`aetheria.interactions.*`, `aetheria.planMode.*`,
// `aetheria.tasks.get`, `aetheria.plan.decide`, `aetheria.authorization.grant`): three reads, one change stream and seven human actions.
//
// Authority. T3 authorizes the method's scope before a handler runs (`RpcAuthorization`: reads and the change stream `orchestration:read`, the seven
// actions `orchestration:operate`). Here the actor is built ONLY from the connection — the authenticated session's id, its granted scopes and the
// time the connection was authenticated — and handed to the interaction service. A payload has no field for an actor, a scope or a root, and none
// is read. The seven actions are scope- and access-checked by the service itself (C1). A read has no actor in the archive's service, so each read
// handler checks the scope again and asks the service's `canAccess` (the one host access rule the actions use) for the root or session first.
//
// What a read answers. A connection without `orchestration:read`, or one that may not reach the root or session, gets `INTERACTION_NOT_FOUND`: it
// learns nothing about whether the root exists. A rejected check or call is `INTERACTION_UNAVAILABLE`, never an empty success; an answer whose write
// may have landed says "outcome unknown", never a definite non-execution.
//
// The stream. It emits `{rootSessionId, version}` only: no text, no draft, no record. A push only prompts a fresh snapshot. A client that wants no gap
// subscribes first and then reads the snapshot: any change after the snapshot's version arrives as a push with a higher version. The stream ends at
// once for a connection that fails the checks or when no service runs, ends when the Backend drains, and unsubscribes when the connection's fiber is
// interrupted (disconnect, or T3 closing a revoked session's connection).
//
// A revoked device (M06 Review 2, record decision "m06-revocation"). T3 ends a connection only when its OWN process removes the session; a revocation by the `t3` CLI,
// a separate process, leaves the socket open (native run 20261111T073726Z-8e678f35). So `connectionActor` also keeps, per actor, a check of the device session's CURRENT
// state, and every call below runs it first: one primary-key read of the persistent `auth_sessions` row (T3's AuthSessionRepository.getById, never the in-memory cache). A
// revoked or missing row, or an expired non-DPoP session, is refused before the service is called, so nothing is written: an action answers `INTERACTION_ORIGIN_NOT_HUMAN`, a
// read `INTERACTION_NOT_FOUND`, and a stream ends. A session state that cannot be read is `INTERACTION_UNAVAILABLE` (nothing written either), never a pass. An actor built without
// the repository in scope (a unit test's) has no check. A DPoP session's expiry is left to T3, whose renewal chain moves a live socket to its successor; revocation of the
// original is still checked, revocation of only a successor is not (T3's own awaitInvalidation reads the chain).
//
// Tasks. `tasks.get` reads the Backend's derived task view after the same checks, then checks access to the root the service derived for it.
import type {
  AuthorizationGrantPayload,
  AuthorizationGrantResult,
  InteractionActionResult,
  InteractionsAnswerPayload,
  InteractionsCancelPayload,
  InteractionsChangeEvent,
  InteractionsChangesPayload,
  InteractionsClosePayload,
  InteractionsHoldPayload,
  InteractionsSnapshotPayload,
  InteractionsSnapshotResult,
  PlanDecidePayload,
  PlanModeGetPayload,
  PlanModeGetResult,
  PlanModeSetPayload,
  PlanModeSetResult,
  TasksGetPayload,
  TasksGetResult,
} from "@t3tools/aetheria-contracts";
import type { AetheriaBackendService, ClientActor } from "@t3tools/aetheria-server";
import type { AuthSessionId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { AuthSessionRepository } from "../persistence/AuthSessions.ts";

type Backend = Option.Option<Pick<AetheriaBackendService, "interactions">>;
type WatchBackend = Option.Option<
  Pick<AetheriaBackendService, "interactions" | "watchInteractions">
>;
type Service = NonNullable<ReturnType<AetheriaBackendService["interactions"]>>;

const UNAVAILABLE = "INTERACTION_UNAVAILABLE" as const;
const NOT_FOUND = "INTERACTION_NOT_FOUND" as const;
const READ_SCOPE = "orchestration:read";
const unavailable = (detail: string) => ({ ok: false as const, code: UNAVAILABLE, detail });
const notFound = (detail: string) => ({ ok: false as const, code: NOT_FOUND, detail });

/** What the persistent session row says now: usable, revoked (or gone, or expired), or not readable. */
type Standing = "active" | "revoked" | "unreadable";

/** Per actor, the check of its device session. An actor with no entry has no check (see the header). */
const standings = new WeakMap<ClientActor, Effect.Effect<Standing>>();

/** One primary-key read of the session's row from T3's persistent store, decided by the row alone. */
const readStanding = (
  repository: AuthSessionRepository["Service"],
  sessionId: string,
): Effect.Effect<Standing> =>
  repository.getById({ sessionId: sessionId as AuthSessionId }).pipe(
    Effect.flatMap((row): Effect.Effect<Standing> =>
      Option.isNone(row) || row.value.revokedAt !== null
        ? Effect.succeed("revoked")
        : row.value.method === "dpop-access-token"
          ? Effect.succeed("active")
          : DateTime.now.pipe(
              Effect.map((now): Standing =>
                row.value.expiresAt.epochMilliseconds <= now.epochMilliseconds
                  ? "revoked"
                  : "active",
              ),
            ),
    ),
    Effect.orElseSucceed((): Standing => "unreadable"),
  );

const standingOf = (actor: ClientActor): Effect.Effect<Standing> =>
  standings.get(actor) ?? Effect.succeed("active");

/**
 * The actor of one connection. T3's session carries no issue time, so the authentication time is the moment this connection's handler layer was
 * built, which is after the session was accepted on the upgrade. When T3's session repository is in scope, the actor is also bound to the check that
 * re-reads its device session on every call.
 */
export const connectionActor = Effect.fn("AetheriaHumanControl.connectionActor")(
  function* (session: {
    readonly sessionId: string;
    readonly scopes: ReadonlyArray<string>;
  }): Effect.fn.Return<ClientActor> {
    const now = yield* DateTime.now;
    const repository = yield* Effect.serviceOption(AuthSessionRepository);
    const actor: ClientActor = {
      clientSessionId: session.sessionId,
      grantedScopes: [...session.scopes],
      authenticatedAt: DateTime.formatIso(now),
    };
    if (Option.isSome(repository))
      standings.set(actor, readStanding(repository.value, session.sessionId));
    return actor;
  },
);

const revokedAction = {
  ok: false as const,
  code: "INTERACTION_ORIGIN_NOT_HUMAN" as const,
  detail: "this connection's device session is revoked or expired",
};
const unreadable = () =>
  unavailable("the device session could not be checked; nothing was written");

/** Run one service call. A rejected call is unavailable, and when the call may have written, it says the outcome is unknown. */
const call = <A>(
  backend: Backend,
  run: (service: Service) => Promise<A>,
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

/** Whether this connection may read the target: it holds the read scope and the host's access rule lets it reach the session and root. */
const mayRead = async (
  service: Service,
  actor: ClientActor,
  target: { readonly sessionId: string; readonly rootSessionId: string },
): Promise<boolean> =>
  actor.grantedScopes.includes(READ_SCOPE) && (await service.canAccess(actor, target));

/** A read: the scope and access check first, then the service. A refused check reads as absent. */
const read = <A>(
  backend: Backend,
  actor: ClientActor,
  target: { readonly sessionId: string; readonly rootSessionId: string },
  run: (service: Service) => Promise<A>,
): Effect.Effect<A | ReturnType<typeof unavailable> | ReturnType<typeof notFound>> =>
  standingOf(actor).pipe(
    Effect.flatMap(
      (
        standing,
      ): Effect.Effect<A | ReturnType<typeof unavailable> | ReturnType<typeof notFound>> =>
        standing === "revoked"
          ? Effect.succeed(notFound("not available to this connection"))
          : standing === "unreadable"
            ? Effect.succeed(unreadable())
            : call(
                backend,
                async (service) =>
                  (await mayRead(service, actor, target))
                    ? run(service)
                    : notFound("not available to this connection"),
                false,
              ),
    ),
  );

/** A target named by a root alone, or by one session whose root the client cannot name: the same id stands for both. */
const rootOnly = (rootSessionId: string) => ({ sessionId: rootSessionId, rootSessionId });

export const interactionsSnapshot = (
  backend: Backend,
  actor: ClientActor,
  payload: InteractionsSnapshotPayload,
): Effect.Effect<InteractionsSnapshotResult> =>
  read(backend, actor, rootOnly(payload.rootSessionId), (service) =>
    service.snapshot(payload.rootSessionId),
  );

export const planModeGet = (
  backend: Backend,
  actor: ClientActor,
  payload: PlanModeGetPayload,
): Effect.Effect<PlanModeGetResult> =>
  read(backend, actor, rootOnly(payload.sessionId), (service) =>
    service.getPlanMode(payload.sessionId),
  );

/**
 * The Backend's view of one session's task list (step 21). The session is the only thing the client names; after the same scope and access check as the
 * other reads, the service answers the view with the root IT derived, and access is checked once more against that root, so a session reachable only
 * as itself cannot show a list that belongs to a root the connection may not reach. `null` is "nothing published"; a stale or unknown view says so;
 * a damaged or unreadable view is unavailable, never an empty list.
 */
export const tasksGet = (
  backend: Backend,
  actor: ClientActor,
  payload: TasksGetPayload,
): Effect.Effect<TasksGetResult> =>
  read(backend, actor, rootOnly(payload.sessionId), async (service) => {
    const reply = await service.getTasks(payload.sessionId);
    if (!reply.ok || reply.value === null) return reply;
    return (await mayRead(service, actor, {
      sessionId: payload.sessionId,
      rootSessionId: reply.value.rootSessionId,
    }))
      ? reply
      : notFound("not available to this connection");
  });

/** The change stream: a push that only prompts a fresh snapshot. */
export const interactionsChanges = (
  backend: WatchBackend,
  actor: ClientActor,
  payload: InteractionsChangesPayload,
): Stream.Stream<InteractionsChangeEvent> =>
  Stream.unwrap(
    standingOf(actor).pipe(
      Effect.map((standing) =>
        // A revoked or unreadable session subscribes nothing. A live stream delivers a push only while the session still stands; the first push after a revocation ends it.
        standing !== "active"
          ? Stream.empty
          : changeStream(backend, actor, payload).pipe(
              Stream.takeWhileEffect(() =>
                standingOf(actor).pipe(Effect.map((current) => current === "active")),
              ),
            ),
      ),
    ),
  );

const changeStream = (
  backend: WatchBackend,
  actor: ClientActor,
  payload: InteractionsChangesPayload,
): Stream.Stream<InteractionsChangeEvent> =>
  Stream.callback<InteractionsChangeEvent>((queue) =>
    Effect.acquireRelease(
      Effect.promise(async (): Promise<() => void> => {
        const end = () => {
          Queue.endUnsafe(queue);
          return () => {};
        };
        const service = Option.isSome(backend) ? backend.value.interactions() : undefined;
        if (service === undefined) return end();
        try {
          if (!(await mayRead(service, actor, rootOnly(payload.rootSessionId)))) return end();
        } catch {
          return end();
        }
        const stop = Option.isSome(backend)
          ? backend.value.watchInteractions(
              (change) => {
                if (change.rootSessionId === payload.rootSessionId)
                  Queue.offerUnsafe(queue, {
                    rootSessionId: change.rootSessionId,
                    version: change.version,
                  });
              },
              () => void Queue.endUnsafe(queue),
            )
          : undefined;
        return stop ?? end();
      }),
      (unsubscribe) => Effect.sync(unsubscribe),
    ),
  );

/** The seven actions first re-read the device session, then go to the service, which checks the connection's scope and the host's access rule itself. Only the schema's fields travel. */
const act = <A>(
  backend: Backend,
  actor: ClientActor,
  run: (service: Service) => Promise<A>,
): Effect.Effect<A | ReturnType<typeof unavailable> | typeof revokedAction> =>
  standingOf(actor).pipe(
    Effect.flatMap(
      (standing): Effect.Effect<A | ReturnType<typeof unavailable> | typeof revokedAction> =>
        standing === "revoked"
          ? Effect.succeed(revokedAction)
          : standing === "unreadable"
            ? Effect.succeed(unreadable())
            : call(backend, run, true),
    ),
  );

export const interactionsAnswer = (
  backend: Backend,
  actor: ClientActor,
  payload: InteractionsAnswerPayload,
): Effect.Effect<InteractionActionResult> =>
  act(backend, actor, (service) =>
    service.answer(
      { actor },
      {
        interactionId: payload.interactionId,
        revision: payload.revision,
        answers: payload.answers,
      },
    ),
  );

export const interactionsCancel = (
  backend: Backend,
  actor: ClientActor,
  payload: InteractionsCancelPayload,
): Effect.Effect<InteractionActionResult> =>
  act(backend, actor, (service) =>
    service.cancel(
      { actor },
      {
        interactionId: payload.interactionId,
        revision: payload.revision,
        ...(payload.feedback === undefined ? {} : { feedback: payload.feedback }),
      },
    ),
  );

export const interactionsHold = (
  backend: Backend,
  actor: ClientActor,
  payload: InteractionsHoldPayload,
): Effect.Effect<InteractionActionResult> =>
  act(backend, actor, (service) =>
    service.hold({ actor }, { interactionId: payload.interactionId, revision: payload.revision }),
  );

export const interactionsClose = (
  backend: Backend,
  actor: ClientActor,
  payload: InteractionsClosePayload,
): Effect.Effect<InteractionActionResult> =>
  act(backend, actor, (service) =>
    service.close({ actor }, { interactionId: payload.interactionId, revision: payload.revision }),
  );

export const planDecide = (
  backend: Backend,
  actor: ClientActor,
  payload: PlanDecidePayload,
): Effect.Effect<InteractionActionResult> =>
  act(backend, actor, (service) =>
    service.decidePlan(
      { actor },
      {
        interactionId: payload.interactionId,
        revision: payload.revision,
        decision: payload.decision,
        ...(payload.feedback === undefined ? {} : { feedback: payload.feedback }),
      },
    ),
  );

export const planModeSet = (
  backend: Backend,
  actor: ClientActor,
  payload: PlanModeSetPayload,
): Effect.Effect<PlanModeSetResult> =>
  act(backend, actor, (service) =>
    service.setPlanMode(
      { actor },
      {
        sessionId: payload.sessionId,
        active: payload.active,
        expectedModeRevision: payload.expectedModeRevision,
      },
    ),
  );

/** The reply carries the client-only `originId`. The root is derived by the service from the session; the payload names none. */
export const authorizationGrant = (
  backend: Backend,
  actor: ClientActor,
  payload: AuthorizationGrantPayload,
): Effect.Effect<AuthorizationGrantResult> =>
  act(backend, actor, (service) =>
    service.grant({ actor }, { subject: payload.subject, sessionId: payload.sessionId }),
  );
