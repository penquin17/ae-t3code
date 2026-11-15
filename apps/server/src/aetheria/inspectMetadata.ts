// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M11 Plan step 10 (C4 K6; B1) — the read-only metadata port the Backend's `backend-services` inspection provider is given: what T3's real drivers and RPC methods ARE.
//
// Sources: `BUILT_IN_DRIVERS` (the driver objects) and `WsRpcGroup.requests` with `RPC_REQUIRED_SCOPES` (the exhaustive request map and its scopes). A driver is read through exactly three
// members — `driverKind`, `metadata` and `configSchema` — and an RPC through its tag, its payload/success/error schemas and its scope. Nothing is called: no `create`, `defaultConfig`,
// `usage` or handler, no service instance, no option, no credential. A schema that does not convert to a JSON document that survives a round trip unchanged is `unsupported` with its reason,
// never a blindly serialized shape. The sources are parameters so a replacement or throwing adapter can be checked against the real one.
import { WsRpcGroup } from "@t3tools/contracts";
import type {
  BackendServicesMetadataPort,
  DriverMetadata,
  MetadataFacet,
  RpcMetadata,
} from "@t3tools/aetheria-server";
import * as Schema from "effect/Schema";
import * as RpcSchema from "effect/rpc/RpcSchema";

import { RPC_REQUIRED_SCOPES } from "../auth/RpcAuthorization.ts";
import { BUILT_IN_DRIVERS } from "../provider/builtInDrivers.ts";

export interface MetadataSources {
  readonly drivers: readonly unknown[];
  readonly requests: Iterable<readonly [string, unknown]>;
  readonly scopes: Readonly<Record<string, string | undefined>>;
}

const jsonFacet = (schema: unknown): MetadataFacet => {
  try {
    const document = Schema.toJsonSchemaDocument(schema as Schema.Top);
    const text = JSON.stringify(document);
    if (text === undefined) return { state: "unsupported", reason: "no-json-form" };
    if (JSON.stringify(JSON.parse(text)) !== text)
      return { state: "unsupported", reason: "not-round-trip-stable" };
    return { state: "exact", document: JSON.parse(text) };
  } catch (error) {
    return { state: "unsupported", reason: `conversion-threw:${(error as Error).name}` };
  }
};

const plainCopy = (value: unknown): unknown => {
  try {
    const text = JSON.stringify(value);
    if (text === undefined || JSON.stringify(JSON.parse(text)) !== text)
      return { unsupported: "not-plain-json" };
    return JSON.parse(text);
  } catch {
    return { unsupported: "not-plain-json" };
  }
};

const readDriver = (driver: unknown): DriverMetadata => {
  const source = driver as Record<string, unknown>;
  return {
    id: String(source.driverKind),
    metadata: plainCopy(source.metadata),
    config: jsonFacet(source.configSchema),
  };
};

const readRpc = (tag: string, rpc: unknown, scopes: MetadataSources["scopes"]): RpcMetadata => {
  const source = rpc as { payloadSchema: unknown; successSchema: unknown; errorSchema: unknown };
  const stream = RpcSchema.isStreamSchema(source.successSchema as Schema.Constraint)
    ? (source.successSchema as unknown as { success: unknown; error: unknown })
    : undefined;
  return {
    id: tag,
    scope: scopes[tag] ?? null,
    stream: stream !== undefined,
    payload: jsonFacet(source.payloadSchema),
    success: jsonFacet(stream === undefined ? source.successSchema : stream.success),
    error: jsonFacet(stream === undefined ? source.errorSchema : stream.error),
  };
};

const REAL_SOURCES: MetadataSources = {
  drivers: BUILT_IN_DRIVERS,
  requests: WsRpcGroup.requests.entries(),
  scopes: RPC_REQUIRED_SCOPES as Record<string, string | undefined>,
};

/** The port, read fresh at each call from its sources. A source that throws makes the call throw: the inspection registry reports that as a provider failure, never an empty list. */
export function createBackendServicesMetadata(
  sources: () => MetadataSources = () => ({
    ...REAL_SOURCES,
    requests: WsRpcGroup.requests.entries(),
  }),
): BackendServicesMetadataPort {
  return {
    drivers: () => sources().drivers.map(readDriver),
    rpcMethods: () => {
      const read = sources();
      return [...read.requests].map(([tag, rpc]) => readRpc(tag, rpc, read.scopes));
    },
  };
}
