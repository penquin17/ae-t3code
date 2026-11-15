// AETHERIA M11 Plan step 10 (C4 K6; D2, D5, D12) — the `backend-services` provider: what the Backend's drivers and RPC methods ARE (their contracts), never what they do. The package never imports
// app-server code: the app server supplies a read-only metadata port (apps/server/src/aetheria/inspectMetadata.ts) built from T3's real driver list and request map, and this provider only
// lists and describes what that port returns. A provider calls nothing on a driver or a handler, reads no service instance, option or credential, and answers a facet it cannot read as
// `unsupported` with a reason, never as a guessed exact shape.
import {
  pageOf,
  type InspectProvider,
  type InspectState,
  type ListPage,
  type QueryTarget,
} from "./inspectEntry.ts";

const BACKEND_SERVICES_PROVIDER_ID = "backend-services";

/** One readable facet of a contract: its exact JSON document, or why it cannot be read exactly. */
export type MetadataFacet =
  | { readonly state: "exact"; readonly document: unknown }
  | { readonly state: "unsupported"; readonly reason: string };

export interface DriverMetadata {
  readonly id: string;
  /** The driver's own plain metadata (kind, display fields). */
  readonly metadata: unknown;
  readonly config: MetadataFacet;
}
export interface RpcMetadata {
  readonly id: string;
  /** The scope the method requires, or null when none is declared. */
  readonly scope: string | null;
  readonly stream: boolean;
  readonly payload: MetadataFacet;
  readonly success: MetadataFacet;
  readonly error: MetadataFacet;
}

/** The read-only port the app server supplies. Both methods return data; neither takes an argument that could select an effect. */
export interface BackendServicesMetadataPort {
  readonly drivers: () => readonly DriverMetadata[];
  readonly rpcMethods: () => readonly RpcMetadata[];
}

const DRIVER_PREFIX = "driver:";
const RPC_PREFIX = "rpc:";
const facetsOf = (...facets: readonly MetadataFacet[]): InspectState =>
  facets.some((f) => f.state === "unsupported") ? "unsupported" : "active";

interface Target {
  readonly targetId: string;
  readonly kind: "driver" | "rpc-method";
  readonly state: InspectState;
  readonly summary: string;
  readonly shape: () => unknown;
}

const byId = (a: { targetId: string }, b: { targetId: string }): number =>
  a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0;

function targetsOf(port: BackendServicesMetadataPort): Target[] {
  const drivers: Target[] = port.drivers().map((driver) => ({
    targetId: `${DRIVER_PREFIX}${driver.id}`,
    kind: "driver" as const,
    state: facetsOf(driver.config),
    summary: `driver; configuration schema ${driver.config.state}`,
    shape: () => ({ id: driver.id, metadata: driver.metadata, config: driver.config }),
  }));
  const rpcs: Target[] = port.rpcMethods().map((rpc) => ({
    targetId: `${RPC_PREFIX}${rpc.id}`,
    kind: "rpc-method" as const,
    state: facetsOf(rpc.payload, rpc.success, rpc.error),
    summary: `${rpc.stream ? "stream" : "request"} method; scope ${rpc.scope ?? "none declared"}`,
    shape: () => ({
      id: rpc.id,
      scope: rpc.scope,
      stream: rpc.stream,
      payload: rpc.payload,
      success: rpc.success,
      error: rpc.error,
    }),
  }));
  return [...drivers.sort(byId), ...rpcs.sort(byId)];
}

/** The `backend-services` provider over a read-only metadata port. A port that throws makes the call unavailable (the registry reports it as a provider failure), never an empty list. */
export function createBackendServicesProvider(port: BackendServicesMetadataPort): InspectProvider {
  return {
    providerId: BACKEND_SERVICES_PROVIDER_ID,
    host: "backend",
    list(page: ListPage) {
      const all = targetsOf(port).filter((t) => page.kind === undefined || t.kind === page.kind);
      const window = pageOf(all, page.offset, page.limit);
      return {
        total: window.total,
        entries: window.entries.map(({ targetId, kind, state, summary }) => ({
          targetId,
          kind,
          state,
          summary,
        })),
      };
    },
    query(request: QueryTarget) {
      const target = targetsOf(port).find((t) => t.targetId === request.targetId);
      if (target === undefined) return { outcome: "unavailable" };
      return { outcome: "ok", state: target.state, shape: target.shape() };
    },
  };
}
