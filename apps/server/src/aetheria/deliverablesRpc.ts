// @effect-diagnostics globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off nodeBuiltinImport:off
// AETHERIA M10 Plan step 14 (D7, D11, D12, R3, XC-20; IP-51 to IP-53) — the handlers behind `aetheria.deliverables.list` and `aetheria.deliverables.offeredPaths`: a root's delivery cards and its
// offered edit paths, read from the Backend's ONE declaration store and the running board service. Neither reads a file or serves a byte: bytes come only from the download route
// (`deliverablesRoute.ts`), which resolves the ids these replies carry again, authorized, at every request.
//
// Authority, in the order the checks run: the same gate as the children handlers (`childrenControlRpc.ts`). (1) T3 authorizes `orchestration:read` before a handler runs. (2) The actor is built only from
// the connection. (3) The device session is re-read from T3's persistent rows on EVERY call (M06's `standingOf`): a revoked, missing or expired one is `DELIVERABLES_DEVICE_REVOKED`, one that
// cannot be read is `DELIVERABLES_UNAVAILABLE`, and neither reaches a store or the board. (4) The handler checks the granted scope again. (5) The named root is translated through the Backend's thread
// index to its Pi session and must be a main thread the identity record does not show to be a child; the host's one access rule (`interactions().canAccess`) must let the connection reach it. A root the
// connection may not reach is `DELIVERABLES_NOT_FOUND` and reveals nothing; an index, identity record or rule that cannot answer is `DELIVERABLES_UNAVAILABLE`, never absence. (6) Only then is the read made, once.
//
// What a reply says. A card carries the thread of the declaring session (through the index) and `supersededBy`, and never a session, root or snapshot id. A declaration whose session this connection may not
// reach, or that no thread holds any more (it was deleted), is not listed. The offered edits keep three answers apart: `known` (an empty list is a known empty), `unknown` (the board says nothing about this
// root) and `unavailable` (the board could not be read). Each recorded path is offered under a stable id, a function of the root session and the canonical path; the id is the only name a client has for it.
import * as NodeCrypto from "node:crypto";

import {
  ClientDeliverablesListResult,
  ClientOfferedPathsResult,
  type ClientDeliverablesListPayload,
  type ClientOfferedPathsPayload,
  type DeliverableCard,
  type DeliverablesClientCode,
} from "@t3tools/aetheria-contracts";
import type {
  AetheriaBackendService,
  ClientActor,
  DeliverableEntry,
} from "@t3tools/aetheria-server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { standingOf } from "./humanControlRpc.ts";

type Service = Pick<
  AetheriaBackendService,
  "interactions" | "index" | "identityKind" | "deliverables" | "board" | "openSnapshot"
>;
export type Backend = Option.Option<Service>;

const READ_SCOPE = "orchestration:read";

export type Failure = {
  readonly ok: false;
  readonly code: DeliverablesClientCode;
  readonly detail: string;
};
const refuse = (code: DeliverablesClientCode, detail: string): Failure => ({
  ok: false,
  code,
  detail,
});
const unavailable = (detail: string): Failure =>
  refuse("DELIVERABLES_UNAVAILABLE", `${detail}; nothing was read`);
const notFound = (): Failure =>
  refuse("DELIVERABLES_NOT_FOUND", "not available to this connection");

/** The stable id a client has for one recorded edit path: a function of the root session and the canonical path alone, so every read names a path the same way. */
export const offeredIdOf = (rootSessionId: string, canonicalPath: string): string =>
  `off_${NodeCrypto.createHash("sha256")
    .update(`${rootSessionId}\u0000${canonicalPath}`)
    .digest("hex")
    .slice(0, 32)}`;

/** The root the checks before any read settle. */
export interface RootGate {
  readonly service: Service;
  readonly rootSessionId: string;
  /** The roots the thread held before and has since replaced, oldest first: read-only aliases of the thread, so what they declared stays listed. */
  readonly retiredRootSessionIds: readonly string[];
}

/**
 * The root named by a thread id: a main thread the Backend's index binds to a Pi session, that M03's identity record does not show to be a child, and that the host's access rule lets this actor reach.
 * The one implementation of the rule for this module and for the download route. (The children handlers hold their own copy of the same rule over M05's direct API; the two must agree.)
 */
export const openRoot = async (
  backend: Backend,
  actor: ClientActor,
  rootThreadId: string,
): Promise<RootGate | Failure> => {
  if (Option.isNone(backend)) return unavailable("the Backend is not running");
  const service = backend.value;
  const interactions = service.interactions();
  if (interactions === undefined) return unavailable("the host's access rule is not running");
  const found = service.index.lookup(rootThreadId);
  if (found.status === "absent") return notFound();
  if (found.status !== "ok")
    return unavailable("the thread index cannot say which session the root holds");
  if (found.binding.subagent === true) return notFound();
  const rootSessionId = found.binding.sessionId;
  const kind = service.identityKind(rootSessionId);
  if (kind === "child") return notFound();
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
  return reachable
    ? {
        service,
        rootSessionId,
        retiredRootSessionIds: (found.binding.retired ?? []).map((r) => r.sessionId),
      }
    : notFound();
};

/** Every call: the device session first, then the scope, then the gate, then the one read. */
const guarded = <A>(
  backend: Backend,
  actor: ClientActor,
  rootThreadId: string,
  work: (gate: RootGate) => Promise<A | Failure>,
): Effect.Effect<A | Failure> =>
  standingOf(actor).pipe(
    Effect.flatMap((standing): Effect.Effect<A | Failure> => {
      if (standing === "revoked")
        return Effect.succeed(
          refuse(
            "DELIVERABLES_DEVICE_REVOKED",
            "this connection's device session is revoked or expired",
          ),
        );
      if (standing === "unreadable")
        return Effect.succeed(unavailable("the device session could not be checked"));
      if (!actor.grantedScopes.includes(READ_SCOPE))
        return Effect.succeed(
          refuse("DELIVERABLES_NOT_AUTHORIZED", `this connection lacks ${READ_SCOPE}`),
        );
      return Effect.promise(async (): Promise<A | Failure> => {
        try {
          const gate = await openRoot(backend, actor, rootThreadId);
          if ("ok" in gate) return gate;
          return await work(gate);
        } catch {
          return unavailable("the deliverables call failed");
        }
      });
    }),
  );

const cardOf = (entry: DeliverableEntry, threadId: string): DeliverableCard => ({
  id: entry.id as DeliverableCard["id"],
  threadId,
  turnId: entry.turnId,
  canonicalPath: entry.canonicalPath,
  title: entry.title,
  kind: entry.kind,
  size: entry.size,
  digest: entry.digest as DeliverableCard["digest"],
  declaredAt: entry.declaredAt,
  // The store's snapshot id is not a browser fact: a download names the declaration and the Backend resolves the snapshot.
  snapshot:
    entry.snapshot.state === "attached"
      ? {
          state: "attached",
          digest: entry.snapshot.digest as DeliverableCard["digest"],
          size: entry.snapshot.size,
        }
      : entry.snapshot,
  supersededBy: entry.supersededBy as DeliverableCard["supersededBy"],
});

/** A root's delivery cards, oldest first, across every session under it. */
export const deliverablesList = (
  backend: Backend,
  actor: ClientActor,
  payload: ClientDeliverablesListPayload,
): Effect.Effect<ClientDeliverablesListResult> =>
  guarded<ClientDeliverablesListResult>(backend, actor, payload.rootThreadId, async (gate) => {
    const store = gate.service.deliverables();
    if (store === undefined) return unavailable("the deliverables store is not running");
    const interactions = gate.service.interactions();
    const reachable = new Map<string, boolean>();
    const mayReach = async (sessionId: string, rootSessionId: string): Promise<boolean> => {
      const key = `${rootSessionId}\u0000${sessionId}`;
      let allowed = reachable.get(key);
      if (allowed === undefined) {
        allowed =
          interactions !== undefined &&
          (await interactions.canAccess(actor, { sessionId, rootSessionId }));
        reachable.set(key, allowed);
      }
      return allowed;
    };
    reachable.set(`${gate.rootSessionId}\u0000${gate.rootSessionId}`, true);
    // The live root's declarations, then each replaced root's the connection may reach: all read-only, the thread's own.
    const cards: DeliverableCard[] = [];
    for (const rootSessionId of [gate.rootSessionId, ...gate.retiredRootSessionIds]) {
      if (!(await mayReach(rootSessionId, rootSessionId))) continue;
      const read = await store.list(rootSessionId);
      if (!read.ok)
        return read.code === "DELIVERABLES_STORE_UNUSABLE" ||
          read.code === "DELIVERABLES_FORMAT_NEWER"
          ? refuse(read.code, "the declaration store cannot be used; nothing is listed")
          : unavailable("the deliverables store is not running");
      for (const entry of read.value) {
        if (!(await mayReach(entry.sessionId, rootSessionId))) continue;
        // The alias is the thread the session belongs to, live or replaced; a session no thread holds is not listed.
        const alias = gate.service.index.aliasOfSession(entry.sessionId);
        if (alias === undefined) continue;
        cards.push(cardOf(entry, alias.binding.threadId));
      }
    }
    // Each root's cards are oldest first already; one list is, across roots (a stable sort keeps a root's own order for equal times).
    cards.sort((a, b) => a.declaredAt - b.declaredAt);
    return { ok: true, value: { rootThreadId: payload.rootThreadId, deliverables: cards } };
  }) as Effect.Effect<ClientDeliverablesListResult>;

/** A root's recorded edit paths, each under a stable id. The board's answer is never turned into an empty list: unknown and unavailable are their own statuses. */
export const offeredPathsRead = (
  backend: Backend,
  actor: ClientActor,
  payload: ClientOfferedPathsPayload,
): Effect.Effect<ClientOfferedPathsResult> =>
  guarded<ClientOfferedPathsResult>(backend, actor, payload.rootThreadId, async (gate) => {
    let edits: Awaited<ReturnType<Service["board"]["editsOf"]>>;
    try {
      edits = await gate.service.board.editsOf(gate.rootSessionId);
    } catch {
      edits = { status: "unavailable", detail: "the board read failed" };
    }
    return {
      ok: true,
      value: {
        rootThreadId: payload.rootThreadId,
        edits:
          edits.status === "known"
            ? {
                status: "known",
                paths: edits.paths.map((canonicalPath) => ({
                  id: offeredIdOf(gate.rootSessionId, canonicalPath) as `off_${string}`,
                  canonicalPath,
                })),
              }
            : { status: edits.status },
      },
    };
  }) as Effect.Effect<ClientOfferedPathsResult>;
