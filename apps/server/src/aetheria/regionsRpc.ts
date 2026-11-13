// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 23 (D17, R3, XC-7, XC-19; IP-58 to IP-60) — the handlers behind `aetheria.regions.report` and `aetheria.regions.read`, the per-connection handle, and the wrap that observes T3's `subscribeThread`.
//
// Authority, in the order a call is checked: T3's `orchestration:read` before the handler; the actor only from the connection; then the device session is re-read from T3's persistent rows on EVERY call (M06's
// `standingOf`) — a revoked, missing or expired one is `REGIONS_DEVICE_REVOKED` and the connection's client is dropped at once, one that cannot be read is `REGIONS_UNAVAILABLE` with nothing changed; the granted
// scope is checked again. Only then does the state run (regionsState.ts), which binds the client to the connection's principal and applies the bounds. There is no root gate: a report names no root, and the viewed
// threads are taken from T3's own `subscribeThread` (which T3 authorized), never from the payload.
//
// The wrap. `observeViewing` records the thread for as long as the subscription's stream runs (it ends on completion, failure and interruption, so a disconnect releases it).
import type {
  RegionsReadPayload,
  RegionsReadResult,
  RegionsReportPayload,
  RegionsReportResult,
  RegionsCode,
} from "@t3tools/aetheria-contracts";
import type { ClientActor } from "@t3tools/aetheria-server";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { standingOf } from "./humanControlRpc.ts";
import {
  getSharedRegionRegistry,
  type RegionClient,
  type RegionConnection,
  type RegionRegistry,
} from "./regionsState.ts";

const READ_SCOPE = "orchestration:read";

interface Failure {
  readonly ok: false;
  readonly code: RegionsCode;
  readonly detail: string;
}
const failure = (code: RegionsCode, detail: string): Failure => ({ ok: false, code, detail });

/**
 * The connection's handle on the region state, bound to the authenticated principal: the subject T3 authenticated and the device session the actor was built from. Its finalizer drops the connection's client when the
 * scope it runs in closes, so nothing stale answers a later query. That scope must be the connection's: inside T3's per-connection handler layer use `openRegionConnectionIn`, because that layer's own scope closes
 * as soon as the handlers are built (see below).
 */
export const openRegionConnection = (
  actor: ClientActor,
  subject: string,
  registry: RegionRegistry = getSharedRegionRegistry(),
) =>
  Effect.acquireRelease(
    Effect.sync(() => registry.openConnection({ subject, deviceSessionId: actor.clientSessionId })),
    (connection) => Effect.sync(() => connection.close()),
  );

/**
 * The same handle, released when `connectionScope` closes instead of the scope the effect runs in. ws.ts builds each connection's handlers with `Effect.provide(layer)` on an effect that returns them while the
 * RPC server is forked in the request's scope; `Effect.provide` closes the layer's scope when that effect completes, which is right after the build. The handle therefore belongs to the request's scope, the one
 * that lasts as long as the socket: a handle released with the layer's scope was closed before its first call and every report answered REGIONS_UNAVAILABLE (M10 slice-2 `regions-round-trip`). The registry is
 * taken when the connection opens, so a connection always reaches the live one and the Backend's drain closes it with the rest.
 */
export const openRegionConnectionIn = (
  connectionScope: Scope.Scope,
  actor: ClientActor,
  subject: string,
  registry: RegionRegistry = getSharedRegionRegistry(),
) =>
  Effect.sync(() =>
    registry.openConnection({ subject, deviceSessionId: actor.clientSessionId }),
  ).pipe(
    Effect.tap((connection) =>
      Scope.addFinalizer(
        connectionScope,
        Effect.sync(() => connection.close()),
      ),
    ),
  );

/** Every call: the device session first, then the scope, then the work. A work that throws is `unavailable`: a report replaces a set, so nothing it did can be half-applied. */
const guarded = <A>(
  connection: RegionConnection,
  actor: ClientActor,
  work: () => A | Failure,
): Effect.Effect<A | Failure> =>
  standingOf(actor).pipe(
    Effect.map((standing): A | Failure => {
      if (standing === "revoked") {
        connection.close();
        return failure(
          "REGIONS_DEVICE_REVOKED",
          "this connection's device session is revoked or expired",
        );
      }
      if (standing === "unreadable")
        return failure(
          "REGIONS_UNAVAILABLE",
          "the device session could not be checked; nothing was changed",
        );
      if (!actor.grantedScopes.includes(READ_SCOPE))
        return failure("REGIONS_NOT_AUTHORIZED", `this connection lacks ${READ_SCOPE}`);
      try {
        return work();
      } catch {
        return failure("REGIONS_UNAVAILABLE", "the region registry failed; nothing was changed");
      }
    }),
  );

const reported = (client: RegionClient) => ({
  clientId: client.clientId,
  sequence: client.sequence,
  regions: client.regions.map((r) => ({ id: r.descriptor.id, visible: r.visible })),
  viewing: [...client.viewing],
});

export const regionsReport = (
  connection: RegionConnection,
  actor: ClientActor,
  payload: RegionsReportPayload,
): Effect.Effect<RegionsReportResult> =>
  guarded(connection, actor, (): RegionsReportResult | Failure => {
    // Only the three declared members are read: a principal, session, viewing or value a caller adds is never looked at.
    const result = connection.report({
      clientId: payload.clientId,
      sequence: payload.sequence,
      regions: payload.regions.map((r) => ({ descriptor: r.descriptor, visible: r.visible })),
    });
    return result.ok ? { ok: true, value: reported(result.value) } : result;
  }) as Effect.Effect<RegionsReportResult>;

export const regionsRead = (
  connection: RegionConnection,
  actor: ClientActor,
  _payload: RegionsReadPayload,
): Effect.Effect<RegionsReadResult> =>
  guarded(connection, actor, (): RegionsReadResult | Failure => {
    const result = connection.readOwn();
    if (!result.ok) return result;
    const client = result.value;
    return {
      ok: true,
      value: {
        client:
          client === undefined
            ? null
            : {
                clientId: client.clientId,
                sequence: client.sequence,
                regions: client.regions.map((r) => ({
                  id: r.descriptor.id,
                  kind: r.descriptor.kind,
                  owner: r.descriptor.owner,
                  parent: r.descriptor.parent,
                  schemaVersion: r.descriptor.schemaVersion,
                  visible: r.visible,
                })),
                viewing: [...client.viewing],
              },
      },
    };
  }) as Effect.Effect<RegionsReadResult>;

/**
 * T3's `subscribeThread` stream, observed: the thread is recorded as viewed by this connection from the moment the stream runs until it ends, fails or is interrupted. The stream's elements are untouched. The thread id
 * is the one T3 authenticated and served; the client reports none.
 */
export const observeViewing = <A, E, R>(
  connection: RegionConnection,
  threadId: string,
  stream: Stream.Stream<A, E, R>,
): Stream.Stream<A, E, R> =>
  Stream.suspend(() => {
    const release = connection.observeViewing(threadId);
    return Stream.ensuring(stream, Effect.sync(release));
  });
