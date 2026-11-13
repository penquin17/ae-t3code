// @effect-diagnostics globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 18 (R3; IP-54 to IP-56) — the one root gate the step-18 handlers (`jobsRpc.ts`, `usageRpc.ts`) share, so the rule is written once for them. It is the same rule as the
// children handlers' (`childrenControlRpc.ts`, which keeps its own copy and is not changed here) and the deliverables handlers' (`deliverablesRpc.ts`'s `openRoot`): the three must agree.
//
// The order a call is checked in: (1) the device session is re-read from T3's persistent rows on EVERY call (M06's `standingOf`): a revoked, missing or expired one is the handler's
// `revoked` code, one that cannot be read its `unavailable` code. (2) The granted scope is checked again, so a handler never relies on T3's middleware alone. (3) The named root is
// translated through the Backend's thread index to its Pi session and must be a main thread: the index's `subagent` flag is never set for an M05 child, so M03's identity record is the proof
// (a child is never a root; a record that cannot be read leaves the root unproven). (4) The host's one access rule (`interactions().canAccess`) must let the connection reach it. A root the
// connection may not reach is the `notFound` code and reveals nothing; an index, record or rule that cannot answer is `unavailable`, never absence. Only then does the handler's work run.
import type { AetheriaBackendService, ClientActor } from "@t3tools/aetheria-server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { standingOf } from "./humanControlRpc.ts";

export const READ_SCOPE = "orchestration:read";
export const OPERATE_SCOPE = "orchestration:operate";
export type GateScope = typeof READ_SCOPE | typeof OPERATE_SCOPE;

/** What the gate needs of the Backend. A handler's own service type extends it. */
export type GateService = Pick<AetheriaBackendService, "interactions" | "index" | "identityKind">;

/** The four codes a handler's own vocabulary gives the gate's refusals, and whether a failed call changed nothing or may have (only the work's own wording). */
export interface GateCodes<C extends string> {
  readonly notAuthorized: C;
  readonly deviceRevoked: C;
  readonly notFound: C;
  readonly unavailable: C;
  /** Ends every `unavailable` detail: `nothing was done` for an action, `nothing was read` for a read. */
  readonly nothing: "done" | "read";
}

export interface GateFailure<C extends string> {
  readonly ok: false;
  readonly code: C;
  /** Always present on the gate's own refusals; a work function may pass M05's refusal through without one. */
  readonly detail?: string;
}

export interface OpenRoot<S> {
  readonly service: S;
  readonly rootSessionId: string;
}

/** A refusal in the handler's code vocabulary; the detail says nothing was done or read, so a client never reads a refusal as a partial effect. */
const gateUnavailable = <C extends string>(
  codes: GateCodes<C>,
  detail: string,
): GateFailure<C> => ({
  ok: false,
  code: codes.unavailable,
  detail: `${detail}; nothing was ${codes.nothing}`,
});

/** The root named by a thread id: a main thread the index binds to a Pi session, that M03's record does not show to be a child, and that the host's rule lets this actor reach. */
const openRoot = async <S extends GateService, C extends string>(
  backend: Option.Option<S>,
  actor: ClientActor,
  rootThreadId: string,
  codes: GateCodes<C>,
): Promise<OpenRoot<S> | GateFailure<C>> => {
  const notFound = (): GateFailure<C> => ({
    ok: false,
    code: codes.notFound,
    detail: "not available to this connection",
  });
  if (Option.isNone(backend)) return gateUnavailable(codes, "the Backend is not running");
  const service = backend.value;
  const interactions = service.interactions();
  if (interactions === undefined)
    return gateUnavailable(codes, "the host's access rule is not running");
  const found = service.index.lookup(rootThreadId);
  if (found.status === "absent") return notFound();
  if (found.status !== "ok")
    return gateUnavailable(codes, "the thread index cannot say which session the root holds");
  // A subagent is never a root.
  if (found.binding.subagent === true) return notFound();
  const rootSessionId = found.binding.sessionId;
  const kind = service.identityKind(rootSessionId);
  if (kind === "child") return notFound();
  if (kind === "unavailable")
    return gateUnavailable(
      codes,
      "the root's identity record cannot be read, so it cannot be told from a child",
    );
  let reachable: boolean;
  try {
    reachable = await interactions.canAccess(actor, { sessionId: rootSessionId, rootSessionId });
  } catch {
    return gateUnavailable(codes, "the host's access rule could not be asked");
  }
  return reachable ? { service, rootSessionId } : notFound();
};

/**
 * Every call: the device session first, then the scope, then the root gate, then the work. `onThrow` is the reply when the work throws past its own handling: a read that fails changed
 * nothing, a write that throws is an unknown outcome, and the handler says which.
 */
export const guardedRoot = <S extends GateService, C extends string, A>(
  backend: Option.Option<S>,
  actor: ClientActor,
  scope: GateScope,
  rootThreadId: string,
  codes: GateCodes<C>,
  work: (gate: OpenRoot<S>) => Promise<A | GateFailure<C>>,
  onThrow: () => GateFailure<C> | A,
): Effect.Effect<A | GateFailure<C>> =>
  standingOf(actor).pipe(
    Effect.flatMap((standing): Effect.Effect<A | GateFailure<C>> => {
      if (standing === "revoked")
        return Effect.succeed({
          ok: false,
          code: codes.deviceRevoked,
          detail: "this connection's device session is revoked or expired",
        });
      if (standing === "unreadable")
        return Effect.succeed(gateUnavailable(codes, "the device session could not be checked"));
      if (!actor.grantedScopes.includes(scope))
        return Effect.succeed({
          ok: false,
          code: codes.notAuthorized,
          detail: `this connection lacks ${scope}`,
        });
      return Effect.promise(async (): Promise<A | GateFailure<C>> => {
        try {
          const gate = await openRoot(backend, actor, rootThreadId, codes);
          if ("ok" in gate && gate.ok === false) return gate as GateFailure<C>;
          return await work(gate as OpenRoot<S>);
        } catch {
          return onThrow();
        }
      });
    }),
  );
