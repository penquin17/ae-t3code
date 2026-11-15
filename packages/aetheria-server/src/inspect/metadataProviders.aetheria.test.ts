// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M11 Plan step 10 (C4 K6; D2, D5, D12) — the `backend-services` provider over a read-only metadata port.
//
// Boundary: the real provider, registry, service and projector from the installed `@aetheria/inspect` archive, over scripted ports (an exact one, one with unreadable facets, a throwing one and a
// replacement) and a scripted caller check. It shows: drivers and RPC methods are listed in a stable order with their stream nature and scopes, a query returns the exact document of a readable
// facet and `unsupported` with its reason for an unreadable one (never a guessed shape), a facet's state is carried up to the target's state, an unknown id and a replaced port are followed honestly, a
// throwing port is unavailable and never an empty list, the provider calls only the port's two read methods, and no canary placed in port-supplied text, errors or configuration reaches a result
// or a log. It does NOT show T3's real drivers or request map (apps/server inspectMetadata.aetheria.test.ts), the XC-6 wire, or any business call: there is none to make.
import { describe, expect, it } from "vite-plus/test";

import type { InspectLogEvent, InspectSettled } from "./service.ts";
import { createInspectBackendRegistration } from "./inspectRegistration.ts";
import type { BackendServicesMetadataPort, MetadataFacet } from "./metadataProviders.ts";

const exact = (document: unknown): MetadataFacet => ({ state: "exact", document });
const unsupported = (reason: string): MetadataFacet => ({ state: "unsupported", reason });

const port = (
  over: Partial<BackendServicesMetadataPort> = {},
): BackendServicesMetadataPort & { reads: string[] } => {
  const reads: string[] = [];
  return {
    reads,
    drivers: () => (
      reads.push("drivers"),
      [
        {
          id: "zeta",
          metadata: { displayName: "Zeta" },
          config: exact({ type: "object", properties: { host: { type: "string" } } }),
        },
        {
          id: "alpha",
          metadata: { displayName: "Alpha" },
          config: unsupported("not-round-trip-stable"),
        },
      ]
    ),
    rpcMethods: () => (
      reads.push("rpc"),
      [
        {
          id: "orchestration.launchThread",
          scope: "write",
          stream: false,
          payload: exact({ type: "object" }),
          success: exact({ type: "string" }),
          error: exact({ type: "null" }),
        },
        {
          id: "aetheria.regions",
          scope: null,
          stream: true,
          payload: exact({ type: "object" }),
          success: unsupported("conversion-threw:Error"),
          error: exact({ type: "null" }),
        },
      ]
    ),
    ...over,
  };
};

const ctx = (args: Record<string, unknown>) => ({
  caller: { threadId: "t", providerSessionId: "p", providerInstanceId: "pi" },
  sessionId: "s",
  kind: "main",
  rootSessionId: "s",
  args,
});
const result = (settled: InspectSettled) => (settled as { result: Record<string, any> }).result;
const serviceOf = (metadata: BackendServicesMetadataPort, log?: (e: InspectLogEvent) => void) =>
  createInspectBackendRegistration({
    access: { check: async () => ({ ok: true }) },
    enablement: { enabled: true },
    metadata,
    ...(log === undefined ? {} : { log }),
  }).service;

describe("the backend-services provider", () => {
  it("lists drivers then RPC methods in a stable order, each with its kind, state and a summary of what it is", async () => {
    const service = serviceOf(port());
    const listed = result(
      await service.serve("inspect.list", ctx({ providerId: "backend-services" })),
    );
    expect(listed.entries.map((e: any) => `${e.targetId}:${e.kind}:${e.state}`)).toEqual([
      "driver:alpha:driver:unsupported",
      "driver:zeta:driver:active",
      "rpc:aetheria.regions:rpc-method:unsupported",
      "rpc:orchestration.launchThread:rpc-method:active",
    ]);
    expect(listed.entries[2].summary).toContain("stream");
    expect(listed.entries[2].summary).toContain("none declared");
    expect(listed.entries[3].summary).toContain("write");
    expect(
      result(
        await service.serve(
          "inspect.list",
          ctx({ providerId: "backend-services", kind: "driver" }),
        ),
      ).total,
    ).toBe(2);
    const paged = result(
      await service.serve(
        "inspect.list",
        ctx({ providerId: "backend-services", offset: 1, limit: 2 }),
      ),
    );
    expect(paged.entries.map((e: any) => e.targetId)).toEqual([
      "driver:zeta",
      "rpc:aetheria.regions",
    ]);
    expect(paged).toMatchObject({ total: 4, nextOffset: 3 });
  });

  it("answers an exact facet's document, an unreadable facet as unsupported with its reason, and reaches a part by selector", async () => {
    const service = serviceOf(port());
    const driver = result(
      await service.serve(
        "inspect.query",
        ctx({ providerId: "backend-services", targetId: "driver:zeta" }),
      ),
    );
    expect(driver).toMatchObject({ outcome: "ok", state: "active" });
    expect(driver.shape.config).toEqual({
      state: "exact",
      document: { type: "object", properties: { host: { type: "string" } } },
    });
    const part = result(
      await service.serve(
        "inspect.query",
        ctx({
          providerId: "backend-services",
          targetId: "driver:zeta",
          selector: "config.document.properties.host.type",
        }),
      ),
    );
    expect(part.shape).toBe("string");
    const bad = result(
      await service.serve(
        "inspect.query",
        ctx({ providerId: "backend-services", targetId: "driver:alpha" }),
      ),
    );
    expect(bad).toMatchObject({ outcome: "ok", state: "unsupported" });
    expect(bad.shape.config).toEqual({ state: "unsupported", reason: "not-round-trip-stable" });
    const rpc = result(
      await service.serve(
        "inspect.query",
        ctx({ providerId: "backend-services", targetId: "rpc:aetheria.regions" }),
      ),
    );
    expect(rpc.shape).toMatchObject({
      id: "aetheria.regions",
      scope: null,
      stream: true,
      success: { state: "unsupported", reason: "conversion-threw:Error" },
    });
  });

  it("an unknown target is unavailable; a throwing port is unavailable and never an empty list, and its error text goes nowhere", async () => {
    const service = serviceOf(port());
    expect(
      result(
        await service.serve(
          "inspect.query",
          ctx({ providerId: "backend-services", targetId: "driver:nope" }),
        ),
      ),
    ).toMatchObject({ outcome: "unavailable" });
    const logs: InspectLogEvent[] = [];
    const throwing = serviceOf(
      port({
        drivers: () => {
          throw new Error("canary-port-error-text");
        },
      }),
      (e) => logs.push(e),
    );
    const listed = await throwing.serve("inspect.list", ctx({ providerId: "backend-services" }));
    expect(listed).toEqual({ status: "unavailable", code: "INSPECT_PROVIDER_FAILED" });
    expect(JSON.stringify([listed, logs])).not.toContain("canary");
  });

  it("follows a replaced port: the answer is the new port's, with nothing left of the old one", async () => {
    let current = port();
    const service = serviceOf({
      drivers: () => current.drivers(),
      rpcMethods: () => current.rpcMethods(),
    });
    expect(
      result(await service.serve("inspect.list", ctx({ providerId: "backend-services" }))).total,
    ).toBe(4);
    current = port({
      drivers: () => [],
      rpcMethods: () => [
        {
          id: "only.one",
          scope: "read",
          stream: false,
          payload: exact({}),
          success: exact({}),
          error: exact({}),
        },
      ],
    });
    const after = result(
      await service.serve("inspect.list", ctx({ providerId: "backend-services" })),
    );
    expect(after.entries.map((e: any) => e.targetId)).toEqual(["rpc:only.one"]);
  });

  it("reads only the port's two methods", async () => {
    const p = port();
    const service = serviceOf(p);
    await service.serve("inspect.list", ctx({ providerId: "backend-services" }));
    await service.serve(
      "inspect.query",
      ctx({ providerId: "backend-services", targetId: "rpc:aetheria.regions" }),
    );
    expect(new Set(p.reads)).toEqual(new Set(["drivers", "rpc"]));
  });

  it("a port that returns a callable or a cycle is refused as read-only, never serialized", async () => {
    const callable = serviceOf(
      port({
        drivers: () => [{ id: "x", metadata: { run: () => 1 }, config: exact({}) }] as never,
      }),
    );
    expect(
      await callable.serve(
        "inspect.query",
        ctx({ providerId: "backend-services", targetId: "driver:x" }),
      ),
    ).toEqual({ status: "refused", code: "INSPECT_READONLY" });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const loop = serviceOf(
      port({ drivers: () => [{ id: "x", metadata: cyclic, config: exact({}) }] as never }),
    );
    expect(
      await loop.serve(
        "inspect.query",
        ctx({ providerId: "backend-services", targetId: "driver:x" }),
      ),
    ).toEqual({ status: "refused", code: "INSPECT_READONLY" });
  });
});
