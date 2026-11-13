// @effect-diagnostics globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 7 (D3, D4, R3, XC-22; IP-47 to IP-49) — the handlers behind `aetheria.groups.read` and `aetheria.groups.apply`: the client's two calls on the Backend's ONE session-group
// store (`@t3tools/aetheria-server` groups/), whose five-operation union arrives in one body.
//
// Authority, in the order the checks run. (1) T3 authorizes the method's scope before a handler runs (`RpcAuthorization`: read `orchestration:read`, apply `orchestration:operate`). (2) The actor is
// built ONLY from the connection; a payload names sessions and a name and nothing else. (3) The device session is re-read from T3's persistent rows on EVERY call (M06's `standingOf`, R3): a
// revoked, missing or expired session is `GROUPS_DEVICE_REVOKED`, one that cannot be read is `GROUPS_UNAVAILABLE`, and neither reaches the store. (4) The handler checks the granted scope again.
// (5) For an apply, the request is judged BEFORE any session or file is touched: a body outside the five exact shapes is `GROUPS_INVALID_REQUEST`, one over 8 KiB of UTF-8 is
// `GROUPS_REQUEST_TOO_LARGE`. (6) Every session the request names must be one this connection may reach, else `GROUPS_SESSION_NOT_FOUND` and nothing is written; (7) only then is the store called, EXACTLY
// ONCE: nothing here retries.
//
// What a session id is. The sidebar's id for a session is the scoped key `<environmentId>:<threadId>`; a bare thread id is read too. A key is reachable when the Backend's thread index binds its thread
// (the whole key first, then the part after the first colon) to a Pi session and the host's one access rule (`interactions().canAccess`, the rule the human-control actions use) lets the connection reach
// it. A key the index cannot answer for (a corrupt entry) makes the call `GROUPS_UNAVAILABLE`: it is never read as absent.
//
// What a reply says. The record is a VIEW: the pairs, dismissals and names whose sessions are ALL reachable by this connection (the file keeps the rest), so a read never discloses a link to a session the
// connection may not see. A store that cannot be read or written is `GROUPS_STORE_UNUSABLE` (the file is left as it was); a call that throws after the store was reached, or whose view cannot be
// built, is `GROUPS_OUTCOME_UNKNOWN`: the write may have landed, so the client re-reads and never resends (D4).
import type {
  GroupsApplyPayload,
  GroupsApplyResult,
  GroupsCode,
  GroupsReadResult,
} from "@t3tools/aetheria-contracts";
import {
  filterGroupsRecord,
  prepareGroupOperation,
  type AetheriaBackendService,
  type ClientActor,
  type GroupsOutcome,
  type GroupsRecord,
} from "@t3tools/aetheria-server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { standingOf } from "./humanControlRpc.ts";

type Backend = Option.Option<Pick<AetheriaBackendService, "groups" | "interactions" | "index">>;

const READ_SCOPE = "orchestration:read";
const OPERATE_SCOPE = "orchestration:operate";

type Failure = { readonly ok: false; readonly code: GroupsCode; readonly detail?: string };
type Reply = { readonly ok: true; readonly value: GroupsRecord } | Failure;
const refuse = (code: GroupsCode, detail: string): Failure => ({ ok: false, code, detail });
const unavailable = (detail: string) => refuse("GROUPS_UNAVAILABLE", `${detail}; nothing was done`);
const unknownOutcome = (detail: string) =>
  refuse("GROUPS_OUTCOME_UNKNOWN", `${detail}; the change may or may not have landed`);

/** The thread id a group's session key names: the whole key when the index binds it, else the part after the first colon (`<environmentId>:<threadId>`). */
const candidatesOf = (key: string): ReadonlyArray<string> => {
  const colon = key.indexOf(":");
  return colon > 0 && colon < key.length - 1 ? [key, key.slice(colon + 1)] : [key];
};

/** What the checks before the store settle: the store, and a per-call memo of which keys this connection may reach. */
interface Gate {
  readonly groups: NonNullable<ReturnType<AetheriaBackendService["groups"]>>;
  readonly reachable: (key: string) => Promise<boolean>;
}

/** Thrown inside `reachable` when the index cannot say; the caller turns it into GROUPS_UNAVAILABLE, never into "absent". */
class IndexUnreadable extends Error {}

const openGate = (backend: Backend, actor: ClientActor): Gate | Failure => {
  if (Option.isNone(backend)) return unavailable("the Backend is not running");
  const service = backend.value;
  const groups = service.groups();
  const interactions = service.interactions();
  if (groups === undefined) return unavailable("the group store is not running");
  if (interactions === undefined) return unavailable("the host's access rule is not running");
  const memo = new Map<string, boolean>();
  const reachable = async (key: string): Promise<boolean> => {
    const known = memo.get(key);
    if (known !== undefined) return known;
    let allowed = false;
    for (const thread of candidatesOf(key)) {
      const found = service.index.lookup(thread);
      if (found.status === "absent") continue;
      if (found.status !== "ok") throw new IndexUnreadable();
      const sessionId = found.binding.sessionId;
      // A subagent is no member of a group: its row is the children view's, not the sidebar's.
      if (found.binding.subagent === true) continue;
      if (await interactions.canAccess(actor, { sessionId, rootSessionId: sessionId })) {
        allowed = true;
        break;
      }
    }
    memo.set(key, allowed);
    return allowed;
  };
  return { groups, reachable };
};

const idsOf = (record: GroupsRecord): ReadonlyArray<string> => [
  ...new Set([
    ...record.links.flatMap((link) => [link.a, link.b]),
    ...record.dismissed.flatMap((pair) => [pair.a, pair.b]),
    ...record.names.flatMap((saved) => saved.members),
  ]),
];

/** The record as this connection may see it. */
const viewOf = async (gate: Gate, record: GroupsRecord): Promise<GroupsRecord> => {
  const keep = new Map<string, boolean>();
  for (const id of idsOf(record)) keep.set(id, await gate.reachable(id));
  return filterGroupsRecord(record, (id) => keep.get(id) === true);
};

const fromStore = (outcome: GroupsOutcome): Failure => {
  const failure = outcome as Extract<GroupsOutcome, { ok: false }>;
  return refuse(failure.code, failure.detail);
};

const guarded = (
  backend: Backend,
  actor: ClientActor,
  scope: typeof READ_SCOPE | typeof OPERATE_SCOPE,
  work: (gate: Gate) => Promise<Reply>,
): Effect.Effect<Reply> =>
  standingOf(actor).pipe(
    Effect.flatMap((standing): Effect.Effect<Reply> => {
      if (standing === "revoked")
        return Effect.succeed(
          refuse(
            "GROUPS_DEVICE_REVOKED",
            "this connection's device session is revoked or has expired",
          ),
        );
      if (standing === "unreadable")
        return Effect.succeed(unavailable("the device session could not be checked"));
      if (!actor.grantedScopes.includes(scope))
        return Effect.succeed(refuse("GROUPS_NOT_AUTHORIZED", `this connection lacks ${scope}`));
      return Effect.promise(async (): Promise<Reply> => {
        const gate = openGate(backend, actor);
        if ("ok" in gate) return gate;
        try {
          return await work(gate);
        } catch (error) {
          return error instanceof IndexUnreadable
            ? unavailable("the thread index cannot say which sessions the groups name")
            : unavailable("the group call failed");
        }
      });
    }),
  );

export const groupsRead = (
  backend: Backend,
  actor: ClientActor,
  _payload: unknown,
): Effect.Effect<GroupsReadResult> =>
  guarded(backend, actor, READ_SCOPE, async (gate) => {
    const outcome = await gate.groups.read();
    if (!outcome.ok) return fromStore(outcome);
    return { ok: true, value: await viewOf(gate, outcome.value) };
  }) as Effect.Effect<GroupsReadResult>;

export const groupsApply = (
  backend: Backend,
  actor: ClientActor,
  payload: GroupsApplyPayload,
): Effect.Effect<GroupsApplyResult> =>
  guarded(backend, actor, OPERATE_SCOPE, async (gate) => {
    // The request is judged before any session or file is touched.
    const prepared = prepareGroupOperation(payload);
    if (!prepared.ok) return refuse(prepared.code, prepared.detail);
    for (const id of prepared.ids)
      if (!(await gate.reachable(id)))
        return refuse(
          "GROUPS_SESSION_NOT_FOUND",
          "a named session is not available to this connection",
        );
    // From here on the store was reached: a throw is an unknown outcome, never a definite non-execution.
    let outcome: GroupsOutcome;
    try {
      outcome = await gate.groups.apply(payload);
    } catch {
      return unknownOutcome("the group store call failed");
    }
    if (!outcome.ok) return fromStore(outcome);
    try {
      return { ok: true, value: await viewOf(gate, outcome.value) };
    } catch {
      return unknownOutcome("the confirmed record could not be shown to this connection");
    }
  }) as Effect.Effect<GroupsApplyResult>;
