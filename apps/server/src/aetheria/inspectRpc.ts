// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M11 Plan step 19 (C2 P1, C5 P4, C6 U3; D5, D6, D8–D11) — the handlers behind `aetheria.inspect.requests` and `aetheria.inspect.reply`: the carrier between the Backend's one live client query and the
// page it asked. They give the browser no inspection authority: the stream only delivers what the Backend sent to THIS connection, and the reply can only settle a request the Backend is still waiting on.
//
// Authority, in the order a call is checked: T3's `orchestration:read` before the handler; the actor only from the connection; then the device session is re-read from T3's persistent rows on the subscribe, before
// EVERY push and on every reply (M06's `standingOf`) — a revoked or expired one ends the stream (nothing more is delivered) and refuses the reply, one that cannot be read refuses it and ends the stream; the granted
// scope is checked again. The client is never named by a payload: the stream and the reply belong to the connection's own id (`RegionConnection.id`), and the resolver ties a reply to the connection it asked.
//
// Lifetime. The stream's finalizer — on completion, failure, interruption or socket close — closes the connection's request stream and settles every query waiting on that connection `disconnected` at once.
import type {
  InspectClientRequest,
  InspectReplyPayload,
  InspectReplyResult,
  InspectRequestsPayload,
} from "@t3tools/aetheria-contracts";
import type { ClientActor, ClientQueries } from "@t3tools/aetheria-server";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import type { InspectClientTransport } from "./inspectClientTransport.ts";
import { standingOf } from "./humanControlRpc.ts";
import type { RegionConnection } from "./regionsState.ts";

const READ_SCOPE = "orchestration:read";

/** Whether this connection may still be served: the device session stands and the read scope was granted. */
const mayServe = (
  actor: ClientActor,
): Effect.Effect<"active" | "revoked" | "unreadable" | "no-scope"> =>
  standingOf(actor).pipe(
    Effect.map((standing) =>
      standing !== "active"
        ? standing
        : actor.grantedScopes.includes(READ_SCOPE)
          ? ("active" as const)
          : ("no-scope" as const),
    ),
  );

/**
 * The subscription: this connection's own request stream. It opens only for a connection that stands, delivers each request the Backend sends to this connection and nothing else, re-reads the standing before every
 * push, and releases the connection's waiting queries when it ends.
 */
export const inspectRequests = (
  connection: RegionConnection,
  actor: ClientActor,
  transport: InspectClientTransport,
  queries: ClientQueries,
  _payload: InspectRequestsPayload,
): Stream.Stream<InspectClientRequest> =>
  Stream.unwrap(
    mayServe(actor).pipe(
      Effect.map((standing) =>
        standing !== "active"
          ? Stream.empty
          : live(connection, transport, queries).pipe(
              Stream.takeWhileEffect(() =>
                mayServe(actor).pipe(Effect.map((current) => current === "active")),
              ),
            ),
      ),
    ),
  );

const live = (
  connection: RegionConnection,
  transport: InspectClientTransport,
  queries: ClientQueries,
): Stream.Stream<InspectClientRequest> =>
  Stream.callback<InspectClientRequest>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        transport.open(connection.id, (request) => {
          Queue.offerUnsafe(queue, request);
        }),
      ),
      (close) =>
        Effect.sync(() => {
          close();
          // The page's request stream ended: whatever it was asked and has not answered can no longer be answered.
          queries.connectionEnded(connection.id);
        }),
    ),
  );

/** The reply: the device session and scope first, then the resolver, which accepts it only from the connection it asked, for a client that still views the thread, once. */
export const inspectReply = (
  connection: RegionConnection,
  actor: ClientActor,
  queries: ClientQueries,
  payload: InspectReplyPayload,
): Effect.Effect<InspectReplyResult> =>
  mayServe(actor).pipe(
    Effect.map((standing): InspectReplyResult => {
      if (standing === "revoked") {
        connection.close();
        return {
          ok: false,
          code: "INSPECT_CLIENT_DEVICE_REVOKED",
          detail: "this connection's device session is revoked or expired",
        };
      }
      if (standing === "unreadable")
        return {
          ok: false,
          code: "INSPECT_CLIENT_UNAVAILABLE",
          detail: "the device session could not be checked; the reply was not used",
        };
      if (standing === "no-scope")
        return {
          ok: false,
          code: "INSPECT_CLIENT_NOT_AUTHORIZED",
          detail: `this connection lacks ${READ_SCOPE}`,
        };
      const { requestId, ...reply } = payload;
      try {
        const settled = queries.reply({ connectionId: connection.id, requestId, reply });
        return { ok: true, value: { accepted: settled === "accepted" } };
      } catch {
        return {
          ok: false,
          code: "INSPECT_CLIENT_UNAVAILABLE",
          detail: "the reply could not be used",
        };
      }
    }),
  );
