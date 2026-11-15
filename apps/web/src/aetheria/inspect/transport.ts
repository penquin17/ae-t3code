// M11 steps 19, 21 (B3): this connection's request STREAM and the correlated REPLY command, as T3 RPC. No query or list command: the page only answers.
// T3 GAP (no T3 edit made): `EnvironmentSubscriptionRpcTag` (client-runtime rpc/client.ts:51) is a hand-kept list that omits `aetheria.inspect.requests`, so its tag is cast
// as `control/transport.ts` does for `aetheria.interactions.changes`; adding the method to that list removes the cast.
import type { InspectClientRequest } from "@t3tools/aetheria-contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, type WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { connectionAtomRuntime } from "../../connection/runtime";

const REQUESTS_TAG =
  "aetheria.inspect.requests" as unknown as typeof WS_METHODS.subscribeServerConfig;

export const aetheriaInspect = {
  reply: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:inspect:reply",
    tag: "aetheria.inspect.reply",
  }),
} as const;

/**
 * Where the mounted responder receives requests. The stream below hands EACH element to the sink as it arrives (an atom keeps only its latest value, which would lose a request that follows another within
 * a render), so the sink is the only consumer and the atom's own value is only a count that keeps the subscription mounted.
 */
let sink: ((request: InspectClientRequest) => void) | undefined;
export function setRequestSink(next: (request: InspectClientRequest) => void): () => void {
  sink = next;
  return () => {
    if (sink === next) sink = undefined;
  };
}

const requestsFamily = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  label: "aetheria:inspect:requests",
  tag: REQUESTS_TAG,
  transform: (stream) =>
    (stream as unknown as Stream.Stream<InspectClientRequest>).pipe(
      Stream.tap((request) => Effect.sync(() => sink?.(request))),
      Stream.zipWithIndex,
      Stream.map(([, n]) => n),
      Stream.catchCause(() => Stream.empty),
    ),
});

/** This connection's request stream for the primary environment; mounting it subscribes, unmounting ends the subscription (the Backend then settles anything it waited on `disconnected`). */
export const inspectRequests = (environmentId: string) =>
  requestsFamily({ environmentId: EnvironmentId.make(environmentId), input: {} as never });
