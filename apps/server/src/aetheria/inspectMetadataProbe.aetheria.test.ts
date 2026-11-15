// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off
// AETHERIA M11 Plan step 2 (B1, C4/K6) — probe: what metadata can the Backend read, explicitly and exactly, without invoking anything?
//
// Boundary: T3's real `BUILT_IN_DRIVERS` array (eleven driver objects) and the real exhaustive `WsRpcGroup` request map with the real
// scope map. A probe reader touches only `driverKind`, `metadata` and `configSchema` of a driver, and only `_tag`, the payload/success/error
// schemas and the scope of an RPC; it never calls `create`, `defaultConfig`, `usage` or a handler. It shows what metadata is readable and
// whether each facet converts to an exact JSON Schema document or is honestly `unsupported` with a reason. It does NOT show service
// instances (never read), the Pi tool list (the native Pi probe owns that) or a measured XC-6 round trip (the native calibration owns that).
// A mutant reader that invokes a driver member or a handler must be caught by the guard before the real reader is trusted.
import { WsRpcGroup } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as RpcSchema from "effect/rpc/RpcSchema";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { BUILT_IN_DRIVERS } from "../provider/builtInDrivers.ts";
import { RPC_REQUIRED_SCOPES, requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";

type Facet =
  | { readonly state: "exact"; readonly document: unknown; readonly bytes: number }
  | { readonly state: "unsupported"; readonly reason: string };

/** Exact means: the schema converts to a draft-2020-12 document that survives a JSON round trip unchanged. Anything else is `unsupported` with its reason. */
const jsonFacet = (schema: unknown): Facet => {
  try {
    const document = Schema.toJsonSchemaDocument(schema as Schema.Top);
    const text = JSON.stringify(document);
    if (text === undefined) return { state: "unsupported", reason: "no-json-form" };
    if (JSON.stringify(JSON.parse(text)) !== text)
      return { state: "unsupported", reason: "not-round-trip-stable" };
    return { state: "exact", document, bytes: Buffer.byteLength(text, "utf8") };
  } catch (error) {
    return { state: "unsupported", reason: `conversion-threw:${(error as Error).name}` };
  }
};

const isPlainJson = (value: unknown): boolean => {
  try {
    const text = JSON.stringify(value);
    return text !== undefined && JSON.stringify(JSON.parse(text)) === text;
  } catch {
    return false;
  }
};

interface DriverTarget {
  readonly driverKind: string;
  readonly metadata: unknown;
  readonly metadataPlain: boolean;
  readonly config: Facet;
}

/** The probe reader: explicit members only. `touched` records every member name it read, so the guard can prove nothing else was reached. */
const readDriver = (driver: Record<string, unknown>, touched: Array<string>): DriverTarget => {
  const read = (key: string) => {
    touched.push(key);
    return driver[key];
  };
  const metadata = read("metadata");
  return {
    driverKind: String(read("driverKind")),
    metadata,
    metadataPlain: isPlainJson(metadata),
    config: jsonFacet(read("configSchema")),
  };
};

/** Wraps a real driver so that calling any function member is recorded; reading data members is allowed and counted. */
const spied = (driver: Record<string, unknown>, calls: Array<string>) =>
  new Proxy(driver, {
    get(target, key) {
      const value = target[key as string];
      if (typeof value === "function") {
        return (...args: Array<unknown>) => {
          calls.push(String(key));
          return (value as (...a: Array<unknown>) => unknown).apply(target, args);
        };
      }
      return value;
    },
  });

const rpcRequests = () => [...WsRpcGroup.requests.entries()].map(([tag, rpc]) => ({ tag, rpc }));

const readRpc = (
  tag: string,
  rpc: { payloadSchema: unknown; successSchema: unknown; errorSchema: unknown },
) => {
  const isStream = RpcSchema.isStreamSchema(rpc.successSchema as Schema.Constraint);
  const stream = isStream
    ? (rpc.successSchema as unknown as { success: unknown; error: unknown })
    : undefined;
  return {
    tag,
    scope: (RPC_REQUIRED_SCOPES as Record<string, string | undefined>)[tag] ?? null,
    stream: isStream,
    payload: jsonFacet(rpc.payloadSchema),
    success: jsonFacet(stream ? stream.success : rpc.successSchema),
    error: jsonFacet(stream ? stream.error : rpc.errorSchema),
  };
};

describe("B1: the driver list is readable as explicit metadata", () => {
  it("has eleven driver objects, each with a kind, plain-JSON metadata and a config facet that is exact or honestly unsupported", () => {
    expect(BUILT_IN_DRIVERS.length).toBe(11);
    const targets = BUILT_IN_DRIVERS.map((driver) => readDriver(driver as never, []));
    expect(new Set(targets.map((t) => t.driverKind)).size).toBe(11);
    for (const target of targets) {
      expect(target.driverKind).not.toBe("");
      expect(target.metadataPlain).toBe(true);
      expect(["exact", "unsupported"]).toContain(target.config.state);
      if (target.config.state === "unsupported") expect(target.config.reason).not.toBe("");
    }
  });

  it("reads only metadata, driverKind and configSchema, and calls no driver function", () => {
    const calls: Array<string> = [];
    const touched: Array<string> = [];
    for (const driver of BUILT_IN_DRIVERS) readDriver(spied(driver as never, calls), touched);
    expect(calls).toEqual([]);
    expect(new Set(touched)).toEqual(new Set(["metadata", "driverKind", "configSchema"]));
  });

  it("mutation: a reader that invokes create/defaultConfig is caught by the call guard", () => {
    const calls: Array<string> = [];
    const mutant = (driver: Record<string, unknown>) => {
      const guarded = spied(driver, calls);
      try {
        (guarded.defaultConfig as () => unknown)();
      } catch {
        // the guard records the call before the real function runs; a throwing driver still counts
      }
    };
    for (const driver of BUILT_IN_DRIVERS) mutant(driver as never);
    expect(calls.length).toBe(11);
    expect(new Set(calls)).toEqual(new Set(["defaultConfig"]));
  });

  it("a circular structure is unsupported, never a blindly serialized schema", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(isPlainJson(circular)).toBe(false);
    expect(jsonFacet(circular).state).toBe("unsupported");
  });
});

describe("B1: the RPC group's methods, schemas and scopes are readable without invoking a handler", () => {
  it("lists every request with one explicit scope, from the real exhaustive map", () => {
    const requests = rpcRequests();
    expect(requests.length).toBeGreaterThan(100);
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(requests.map((r) => r.tag)));
    for (const { tag } of requests) expect(requiredScopeForRpcMethod(tag as never)).toBeTruthy();
  });

  it("classifies each payload, success and error as exact or unsupported with a reason, and keeps stream methods apart", () => {
    const rows = rpcRequests().map(({ tag, rpc }) => readRpc(tag, rpc as never));
    const facets = rows.flatMap((r) => [r.payload, r.success, r.error]);
    for (const facet of facets) {
      expect(["exact", "unsupported"]).toContain(facet.state);
      if (facet.state === "unsupported") expect(facet.reason).not.toBe("");
    }
    expect(rows.some((r) => r.stream)).toBe(true);
    const aetheria = rows.filter((r) => r.tag.startsWith("aetheria."));
    expect(aetheria.length).toBeGreaterThan(0);
    for (const row of aetheria) expect(row.scope).toBeTruthy();
  });
});

describe("B1 measurement: counts and projected sizes recorded for the parameter rule (N, S)", () => {
  it("records observed counts and the largest single-target projection, writing evidence when M11_PROBE_OUT names a file", () => {
    const touched: Array<string> = [];
    const drivers = BUILT_IN_DRIVERS.map((driver) => readDriver(driver as never, touched));
    const rpcs = rpcRequests().map(({ tag, rpc }) => readRpc(tag, rpc as never));
    const projected = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
    // A projected single target carries its kind, metadata and facet state; the exact document is included only for an exact facet.
    const driverBytes = drivers.map((d) =>
      projected({
        id: d.driverKind,
        metadata: d.metadata,
        config:
          d.config.state === "exact" ? d.config : { state: "unsupported", reason: d.config.reason },
      }),
    );
    const rpcBytes = rpcs.map((r) =>
      projected({
        id: r.tag,
        scope: r.scope,
        stream: r.stream,
        payload: r.payload,
        success: r.success,
        error: r.error,
      }),
    );
    const summary = {
      probe: "b1-metadata",
      drivers: {
        count: drivers.length,
        exactConfig: drivers.filter((d) => d.config.state === "exact").length,
        unsupportedConfig: drivers.filter((d) => d.config.state === "unsupported").length,
        unsupportedReasons: [
          ...new Set(
            drivers.flatMap((d) => (d.config.state === "unsupported" ? [d.config.reason] : [])),
          ),
        ],
        maxTargetBytes: Math.max(...driverBytes),
      },
      rpc: {
        count: rpcs.length,
        streams: rpcs.filter((r) => r.stream).length,
        aetheria: rpcs.filter((r) => r.tag.startsWith("aetheria.")).length,
        exactPayload: rpcs.filter((r) => r.payload.state === "exact").length,
        unsupportedPayload: rpcs.filter((r) => r.payload.state === "unsupported").length,
        unsupportedReasons: [
          ...new Set(
            rpcs.flatMap((r) =>
              [r.payload, r.success, r.error].flatMap((f) =>
                f.state === "unsupported" ? [f.reason] : [],
              ),
            ),
          ),
        ],
        maxTargetBytes: Math.max(...rpcBytes),
        maxTargetTag: rpcs[rpcBytes.indexOf(Math.max(...rpcBytes))]?.tag,
        medianTargetBytes: [...rpcBytes].sort((a, b) => a - b)[Math.floor(rpcBytes.length / 2)],
        over65536: rpcBytes.filter((b) => b > 65_536).length,
        over16384: rpcBytes.filter((b) => b > 16_384).length,
        largestFive: rpcs
          .map((r, i) => ({ tag: r.tag, bytes: rpcBytes[i] }))
          .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))
          .slice(0, 5),
      },
    };
    expect(summary.drivers.count).toBe(11);
    expect(summary.rpc.count).toBeGreaterThan(100);
    expect(summary.drivers.maxTargetBytes).toBeGreaterThan(0);
    expect(summary.rpc.maxTargetBytes).toBeGreaterThan(0);
    const out = process.env.M11_PROBE_OUT;
    if (out) {
      const dir = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
      expect(NodePath.resolve(out).startsWith(dir + NodePath.sep)).toBe(true);
      NodeFS.mkdirSync(NodePath.dirname(out), { recursive: true, mode: 0o700 });
      NodeFS.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
    }
  });
});
