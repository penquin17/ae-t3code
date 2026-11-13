// @effect-diagnostics globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 3 (R1, R3, XC-15; IP-40 to IP-42) — the handlers behind `aetheria.children.cancelTree`, `.list`, `.interrupt` and `.close`: the user's Stop of a
// root's tree and the per-child controls, over M05's DIRECT Backend API (`orchestration().direct()`), never XC-6 and never model input.
//
// Authority, in the order the checks run. (1) T3 authorizes the method's scope before a handler runs (`RpcAuthorization`: list `orchestration:read`, the other three
// `orchestration:operate`). (2) The actor is built ONLY from the connection (`connectionActor`); a payload names threads and nothing else. (3) The device session is re-read from
// T3's persistent rows on EVERY call (M06's `standingOf`, R3): a revoked, missing or expired session is `CHILDREN_DEVICE_REVOKED`, one that cannot be read is
// `CHILDREN_UNAVAILABLE`, and neither reaches M05. (4) The handler checks the granted scope again, so a handler never relies on the middleware alone. (5) The named root is
// translated through the Backend's thread index to its Pi session and must be a main thread; the host's one access rule (`interactions().canAccess`, the rule the human-control
// actions use) must let the connection reach it. A root the connection may not reach is `CHILDREN_NOT_FOUND` and reveals nothing. (6) Only then is M05 called, with the trusted user
// caller `{user:true}` that no payload can supply, EXACTLY ONCE: nothing here retries.
//
// A child is acted on only after M05's user list of the named root shows it: M05's user interrupt and close name a child but not a root, so this membership check is what stops a
// connection from reaching a child of a root it may not. Interrupt goes through M05's `interruptTurn` with the Backend-module authority (the committed interruption API; for a
// child it makes the user's `interruptChild` call and records `user-stop` first); close is `closeChild` with the user caller.
//
// What a reply says. `ok:true` carries M05's value unchanged (the tree Stop's per-child rows and its `complete` flag, so a partial failure is shown, never hidden). A refusal
// carries a code: the Backend's five, or one of M05's the operations can return, passed through with its detail. A call that throws, a reply that is not an M05 outcome and a
// code M05 may not return here are `CHILDREN_OUTCOME_UNKNOWN`: the effect may or may not have landed, so the client reads the projection and never resends (D4, A2).
import {
  CHILDREN_PASSTHROUGH_CODES,
  ClientChildrenCancelTreeResult,
  ClientChildrenCloseResult,
  ClientChildrenInterruptResult,
  ClientChildrenListResult,
  type ChildrenControlCode,
  type ClientChildrenCancelTreePayload,
  type ClientChildrenClosePayload,
  type ClientChildrenInterruptPayload,
  type ClientChildrenListPayload,
} from "@t3tools/aetheria-contracts";
import type { AetheriaBackendService, ClientActor } from "@t3tools/aetheria-server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { standingOf } from "./humanControlRpc.ts";

type Backend = Option.Option<
  Pick<AetheriaBackendService, "interactions" | "orchestration" | "index" | "identityKind">
>;
type Direct = NonNullable<
  ReturnType<NonNullable<ReturnType<AetheriaBackendService["orchestration"]>>["direct"]>
>;

const READ_SCOPE = "orchestration:read";
const OPERATE_SCOPE = "orchestration:operate";
/** The module authority M05's `interruptTurn` requires of a trusted Backend caller: a value only the Backend's own modules hold, never a payload field. */
const AUTHORITY = { kind: "backend-module", module: "aetheria-client-children" } as const;

type Failure = { readonly ok: false; readonly code: string; readonly detail?: string };
type Reply = { readonly ok: true; readonly value: unknown } | Failure;
const refuse = (code: ChildrenControlCode, detail: string): Failure => ({
  ok: false,
  code,
  detail,
});
const unavailable = (detail: string) =>
  refuse("CHILDREN_UNAVAILABLE", `${detail}; nothing was done`);
const unknownOutcome = (detail: string) =>
  refuse("CHILDREN_OUTCOME_UNKNOWN", `${detail}; the effect may or may not have landed`);

const isPassthrough = (code: unknown): code is (typeof CHILDREN_PASSTHROUGH_CODES)[number] =>
  typeof code === "string" && (CHILDREN_PASSTHROUGH_CODES as readonly string[]).includes(code);

/** M05's refusal as a client reply: a code these operations can return passes through with its detail; any other is an unknown outcome. */
const fromFailure = (outcome: { readonly code?: unknown; readonly detail?: unknown }): Failure =>
  isPassthrough(outcome.code)
    ? {
        ok: false,
        code: outcome.code,
        ...(typeof outcome.detail === "string" ? { detail: outcome.detail } : {}),
      }
    : unknownOutcome("the children service answered with a code this call cannot return");

/** Decodes an M05 outcome through the contract's own reply schema, so only its fields travel; an outcome that does not fit is unknown, never a pass. */
const settle = (schema: Schema.Top, outcome: unknown): Reply => {
  if (outcome === null || typeof outcome !== "object")
    return unknownOutcome("the children service gave no outcome");
  const reply = outcome as { readonly ok?: unknown; readonly value?: unknown };
  if (reply.ok === false) return fromFailure(outcome as { code?: unknown; detail?: unknown });
  if (reply.ok !== true) return unknownOutcome("the children service gave no outcome");
  try {
    return Schema.decodeUnknownSync(schema as never)({ ok: true, value: reply.value }) as Reply;
  } catch {
    return unknownOutcome("the children service's value does not fit its contract");
  }
};

/** What the checks before M05 settle: the root's Pi session and M05's direct API, or the refusal. */
interface Gate {
  readonly direct: Direct;
  readonly index: AetheriaBackendService["index"];
  readonly rootSessionId: string;
}

/** The root named by a thread id: a main thread the Backend's index binds to a Pi session and the host's access rule lets this connection reach. */
const openGate = async (
  backend: Backend,
  actor: ClientActor,
  rootThreadId: string,
): Promise<Gate | Failure> => {
  if (Option.isNone(backend)) return unavailable("the Backend is not running");
  const service = backend.value;
  const direct = service.orchestration()?.direct();
  const interactions = service.interactions();
  if (direct === undefined || interactions === undefined)
    return unavailable("the children service is not running");
  const found = service.index.lookup(rootThreadId);
  if (found.status === "absent")
    return refuse("CHILDREN_NOT_FOUND", "not available to this connection");
  if (found.status !== "ok")
    return unavailable("the thread index cannot say which session the root holds");
  // A subagent is never a root: a Stop of the tree names the main thread.
  if (found.binding.subagent === true)
    return refuse("CHILDREN_NOT_FOUND", "not available to this connection");
  const rootSessionId = found.binding.sessionId;
  // The index's `subagent` flag is never set for an M05 child (every such binding holds null), so the flag alone let a child be Stopped as a root. M03's identity record is the proof: a child is
  // never a root; a record that cannot be read leaves the root unproven, and nothing is done.
  const kind = service.identityKind(rootSessionId);
  if (kind === "child") return refuse("CHILDREN_NOT_FOUND", "not available to this connection");
  if (kind === "unavailable")
    return unavailable(
      "the root's identity record cannot be read, so it cannot be told from a child",
    );
  let reachable: boolean;
  try {
    reachable = await interactions.canAccess(actor, { sessionId: rootSessionId, rootSessionId });
  } catch {
    return unavailable("the host's access rule could not be asked");
  }
  if (!reachable) return refuse("CHILDREN_NOT_FOUND", "not available to this connection");
  return { direct, index: service.index, rootSessionId };
};

/**
 * Every call: the device session first, then the scope, then the gate, then the work. `mayHaveWritten` only chooses the wording of a call that throws: a read that fails
 * changed nothing; a write that throws is an unknown outcome.
 */
const guarded = (
  backend: Backend,
  actor: ClientActor,
  scope: typeof READ_SCOPE | typeof OPERATE_SCOPE,
  rootThreadId: string,
  work: (gate: Gate) => Promise<Reply>,
  mayHaveWritten: boolean,
): Effect.Effect<Reply> =>
  standingOf(actor).pipe(
    Effect.flatMap((standing): Effect.Effect<Reply> => {
      if (standing === "revoked")
        return Effect.succeed(
          refuse(
            "CHILDREN_DEVICE_REVOKED",
            "this connection's device session is revoked or expired",
          ),
        );
      if (standing === "unreadable")
        return Effect.succeed(unavailable("the device session could not be checked"));
      if (!actor.grantedScopes.includes(scope))
        return Effect.succeed(refuse("CHILDREN_NOT_AUTHORIZED", `this connection lacks ${scope}`));
      return Effect.promise(async (): Promise<Reply> => {
        try {
          const gate = await openGate(backend, actor, rootThreadId);
          if ("ok" in gate) return gate;
          return await work(gate);
        } catch {
          return mayHaveWritten
            ? unknownOutcome("the children call failed")
            : unavailable("the children call failed");
        }
      });
    }),
  );

/** M05's user list of the named root; the child must be one of its rows. */
const listedChild = async (
  gate: Gate,
  rootThreadId: string,
  childThreadId: string,
): Promise<Failure | "member"> => {
  let outcome: Awaited<ReturnType<Direct["listChildren"]>>;
  try {
    outcome = await gate.direct.listChildren({
      caller: { user: true },
      args: { scope: "descendants", rootThreadId },
    });
  } catch {
    return unavailable("the root's children could not be listed");
  }
  if (!outcome.ok) return unavailable("the root's children could not be listed");
  return outcome.value.rows.some((row) => row.childId === childThreadId)
    ? "member"
    : refuse("CHILDREN_NOT_FOUND", "not available to this connection");
};

export const childrenCancelTree = (
  backend: Backend,
  actor: ClientActor,
  payload: ClientChildrenCancelTreePayload,
): Effect.Effect<ClientChildrenCancelTreeResult> =>
  guarded(
    backend,
    actor,
    OPERATE_SCOPE,
    payload.rootThreadId,
    async (gate) =>
      settle(
        ClientChildrenCancelTreeResult,
        await gate.direct.cancelTree({
          caller: { user: true },
          args: { rootThreadId: payload.rootThreadId },
        }),
      ),
    true,
  ) as Effect.Effect<ClientChildrenCancelTreeResult>;

export const childrenList = (
  backend: Backend,
  actor: ClientActor,
  payload: ClientChildrenListPayload,
): Effect.Effect<ClientChildrenListResult> =>
  guarded(
    backend,
    actor,
    READ_SCOPE,
    payload.rootThreadId,
    async (gate) =>
      settle(
        ClientChildrenListResult,
        await gate.direct.listChildren({
          caller: { user: true },
          args: { scope: "descendants", rootThreadId: payload.rootThreadId },
        }),
      ),
    false,
  ) as Effect.Effect<ClientChildrenListResult>;

/** Interrupt a continuable child: its turn ends, the child stays open. A one-shot child is closed instead (`childrenClose`), the client choosing by the listed mode. */
export const childrenInterrupt = (
  backend: Backend,
  actor: ClientActor,
  payload: ClientChildrenInterruptPayload,
): Effect.Effect<ClientChildrenInterruptResult> =>
  guarded(
    backend,
    actor,
    OPERATE_SCOPE,
    payload.rootThreadId,
    async (gate) => {
      const member = await listedChild(gate, payload.rootThreadId, payload.childThreadId);
      if (member !== "member") return member;
      const bound = gate.index.lookup(payload.childThreadId);
      if (bound.status !== "ok")
        return unavailable("the index cannot say which session the child holds");
      const answer = await gate.direct.interruptTurn({
        authority: AUTHORITY,
        sessionId: bound.binding.sessionId,
      });
      if (answer.status === "accepted") return { ok: true, value: { accepted: true } };
      if (answer.status === "refused")
        return { ok: false, code: "NOT_AUTHORIZED", detail: "the interrupt was refused" };
      // M05 could not confirm the interrupt: it may or may not have reached T3, so it is read as unknown by the client.
      return {
        ok: false,
        code: "ORCHESTRATION_UNAVAILABLE",
        detail:
          typeof answer.detail === "string" ? answer.detail : "the interrupt was not confirmed",
      };
    },
    true,
  ) as Effect.Effect<ClientChildrenInterruptResult>;

/** Close a child: its run is stopped for good, its adopted jobs are killed, a record-only child's report is stored. The client uses this for a one-shot child. */
export const childrenClose = (
  backend: Backend,
  actor: ClientActor,
  payload: ClientChildrenClosePayload,
): Effect.Effect<ClientChildrenCloseResult> =>
  guarded(
    backend,
    actor,
    OPERATE_SCOPE,
    payload.rootThreadId,
    async (gate) => {
      const member = await listedChild(gate, payload.rootThreadId, payload.childThreadId);
      if (member !== "member") return member;
      return settle(
        ClientChildrenCloseResult,
        await gate.direct.closeChild({
          caller: { user: true },
          args: { target: payload.childThreadId },
        }),
      );
    },
    true,
  ) as Effect.Effect<ClientChildrenCloseResult>;
