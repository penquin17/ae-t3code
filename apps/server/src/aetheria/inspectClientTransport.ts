// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M11 Plan steps 18–19 (C5; D8, D9, D11; N1) — the app wiring behind the Backend's client resolver: the `ClientPort` over M10's region registry and the open request streams.
//
// Who is asked. `viewers` and `viewer` are the registry's two inspector reads (`clientsViewing`, `clientViewing`), mapped to what the resolver may see: a client id, the connection it is bound to, when it last
// reported, and its regions' declared shape — never its principal, device session or the threads it views. `send` puts a request on the ONE open request stream of the named connection and nothing else; a connection with
// no open stream is not sent to. There is no second connection table: a stream is only a way to write to a connection the registry already knows, and it is removed when that stream ends.
import type {
  ClientPort,
  ClientRegionInfo,
  ClientRequest,
  ClientView,
} from "@t3tools/aetheria-server";

import type { RegionRegistry, ViewingClient } from "./regionsState.ts";

export interface InspectClientTransport {
  readonly port: ClientPort;
  /** A connection's request stream opened: requests for that connection go to `push` until the returned close runs. A second stream of the same connection replaces the first. */
  open(connectionId: string, push: (request: ClientRequest) => void): () => void;
  /** Streams open now. */
  openStreams(): number;
}

const regionInfo = (region: ViewingClient["regions"][number]): ClientRegionInfo => ({
  id: region.descriptor.id,
  kind: region.descriptor.kind,
  description: region.descriptor.description,
  schemaVersion: region.descriptor.schemaVersion,
  visible: region.visible,
  props: region.descriptor.props.map((f) => ({ name: f.name, type: f.type, report: f.report })),
  state: region.descriptor.state.map((f) => ({ name: f.name, type: f.type, report: f.report })),
  tokens: [...region.descriptor.tokens],
});

/** The resolver's view of a registry client: no principal, no device, no other thread. */
const viewOf = (client: ViewingClient): ClientView => ({
  clientId: client.clientId,
  connectionId: client.connectionId,
  lastSeenMs: client.updatedAtMs,
  regions: client.regions.map(regionInfo),
});

export function createInspectClientTransport(registry: RegionRegistry): InspectClientTransport {
  const sinks = new Map<string, (request: ClientRequest) => void>();
  return Object.freeze({
    port: Object.freeze({
      viewers: (threadId: string) => registry.clientsViewing(threadId).map(viewOf),
      viewer: (threadId: string, clientId: string) => {
        const client = registry.clientViewing(threadId, clientId);
        return client === undefined ? undefined : viewOf(client);
      },
      send: (connectionId: string, request: ClientRequest) => {
        const push = sinks.get(connectionId);
        if (push === undefined) return false;
        push({ ...request });
        return true;
      },
    }),
    open(connectionId: string, push: (request: ClientRequest) => void) {
      sinks.set(connectionId, push);
      return () => {
        if (sinks.get(connectionId) === push) sinks.delete(connectionId);
      };
    },
    openStreams: () => sinks.size,
  });
}
