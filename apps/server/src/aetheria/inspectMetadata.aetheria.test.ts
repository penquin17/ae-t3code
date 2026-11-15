// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M11 Plan step 10 (C4 K6; B1; D2, D5, D12) — the read-only driver and RPC metadata port the Backend's `backend-services` provider is given, against T3's real sources.
//
// Boundary: T3's real `BUILT_IN_DRIVERS` (eleven objects) and the real exhaustive `WsRpcGroup` request map with its real scope map, read through the production port, and then through the real
// inspection service and registration so every target passes the core's plain-data guard. It shows: the port lists exactly the sources' drivers and methods (K6: source-equal, counted from the
// sources themselves), each facet is `exact` or `unsupported` with a reason, a driver is read through `driverKind`, `metadata` and `configSchema` and nothing else, no driver function is called
// (a spy sees zero calls), a replacement source is followed with no residue, a throwing source is unavailable and never an empty list, and every one of the real targets answers through the service
// as a plain, bounded result. It does NOT show the Pi tool list, a native page, a measured round trip, or any business call — there is none to make.
import { createInspectBackendRegistration } from "@t3tools/aetheria-server";
import { WsRpcGroup } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { RPC_REQUIRED_SCOPES } from "../auth/RpcAuthorization.ts";
import { BUILT_IN_DRIVERS } from "../provider/builtInDrivers.ts";
import { createBackendServicesMetadata, type MetadataSources } from "./inspectMetadata.ts";

const CALLER = { threadId: "t", providerSessionId: "p", providerInstanceId: "pi" };
const ctx = (args: Record<string, unknown>) => ({
  caller: CALLER,
  sessionId: "s",
  kind: "main",
  rootSessionId: "s",
  args,
});
const serviceOf = (port: ReturnType<typeof createBackendServicesMetadata>) =>
  createInspectBackendRegistration({
    access: { check: async () => ({ ok: true }) },
    enablement: { enabled: true },
    metadata: port,
  }).service;

describe("the production port over T3's real sources", () => {
  const port = createBackendServicesMetadata();

  it("lists exactly the real drivers and the real request map, counted from the sources", () => {
    const drivers = port.drivers();
    const methods = port.rpcMethods();
    expect(drivers).toHaveLength(BUILT_IN_DRIVERS.length);
    expect(drivers.map((d) => d.id)).toEqual(
      BUILT_IN_DRIVERS.map((d) => String((d as { driverKind: unknown }).driverKind)),
    );
    expect(methods.map((m) => m.id)).toEqual([...WsRpcGroup.requests.keys()]);
    expect(new Set(methods.map((m) => m.id)).size).toBe(methods.length);
    for (const method of methods)
      expect(method.scope).toBe(
        (RPC_REQUIRED_SCOPES as Record<string, string | undefined>)[method.id] ?? null,
      );
    expect(methods.some((m) => m.stream)).toBe(true);
    expect(methods.some((m) => m.id.startsWith("aetheria."))).toBe(true);
  });

  it("gives every facet as exact or unsupported with a reason, never a guessed shape", () => {
    const facets = [
      ...port.drivers().map((d) => d.config),
      ...port.rpcMethods().flatMap((m) => [m.payload, m.success, m.error]),
    ];
    for (const facet of facets) {
      expect(["exact", "unsupported"]).toContain(facet.state);
      if (facet.state === "unsupported") expect(facet.reason).not.toBe("");
      else expect(JSON.parse(JSON.stringify(facet.document))).toEqual(facet.document);
    }
  });

  it("measures each real target against the core's plain-data limits (depth 64, 100,000 nodes; the deepest real one is 35)", () => {
    const measure = (value: unknown): { depth: number; nodes: number } => {
      let nodes = 0;
      const walk = (v: unknown, depth: number): number => {
        nodes += 1;
        if (typeof v !== "object" || v === null) return depth;
        return Math.max(depth, ...Object.values(v).map((child) => walk(child, depth + 1)));
      };
      const depth = walk(value, 0);
      return { depth, nodes };
    };
    const rows = [
      ...port.drivers().map((d) => ({ id: d.id, ...measure(d) })),
      ...port.rpcMethods().map((m) => ({ id: m.id, ...measure(m) })),
    ];
    const over = rows.filter((r) => r.depth >= 60 || r.nodes > 100_000);
    expect(
      over,
      `deepest ${Math.max(...rows.map((r) => r.depth))}, largest ${Math.max(...rows.map((r) => r.nodes))} nodes`,
    ).toEqual([]);
  });

  it("answers every real target through the real service as a plain result, bounded by the cap", async () => {
    const service = serviceOf(port);
    const total = BUILT_IN_DRIVERS.length + WsRpcGroup.requests.size;
    let seen = 0;
    for (let offset = 0; offset < total; offset += 100) {
      const page = await service.serve(
        "inspect.list",
        ctx({ providerId: "backend-services", offset, limit: 100 }),
      );
      expect(page).toMatchObject({ status: "done", result: { total } });
      const entries = (page as unknown as { result: { entries: Array<{ targetId: string }> } })
        .result.entries;
      seen += entries.length;
      for (const { targetId } of entries) {
        const answer = (await service.serve(
          "inspect.query",
          ctx({ providerId: "backend-services", targetId }),
        )) as { status: string; result: { outcome: string } };
        expect(answer.status, targetId).toBe("done");
        expect(["ok", "truncated"], targetId).toContain(answer.result.outcome);
        expect(
          Buffer.byteLength(JSON.stringify(answer.result), "utf8"),
          targetId,
        ).toBeLessThanOrEqual(1_048_576);
      }
    }
    expect(seen).toBe(total);
  });
});

describe("the port over replacement and failing sources", () => {
  it("reads a driver through driverKind, metadata and configSchema only, and calls no function", () => {
    const calls: string[] = [];
    const touched = new Set<string>();
    const spied = BUILT_IN_DRIVERS.map(
      (driver) =>
        new Proxy(driver as unknown as Record<string, unknown>, {
          get(target, key) {
            touched.add(String(key));
            const value = target[key as string];
            return typeof value === "function"
              ? (...args: unknown[]) => (
                  calls.push(String(key)),
                  (value as (...a: unknown[]) => unknown)(...args)
                )
              : value;
          },
        }),
    );
    createBackendServicesMetadata(() => ({
      drivers: spied,
      requests: WsRpcGroup.requests.entries(),
      scopes: RPC_REQUIRED_SCOPES as never,
    })).drivers();
    expect(calls).toEqual([]);
    expect(touched).toEqual(new Set(["driverKind", "metadata", "configSchema"]));
  });

  it("mutant: a reader that invoked a driver member would be seen by the spy", () => {
    const calls: string[] = [];
    const driver = new Proxy(
      {
        driverKind: "x",
        metadata: {},
        configSchema: undefined,
        defaultConfig: () => ({}),
      } as Record<string, unknown>,
      {
        get: (target, key) =>
          typeof target[key as string] === "function"
            ? () => (calls.push(String(key)), (target[key as string] as () => unknown)())
            : target[key as string],
      },
    );
    (driver.defaultConfig as () => unknown)();
    expect(calls).toEqual(["defaultConfig"]);
  });

  it("follows a replacement source with no residue, and carries secrets and functions of a driver nowhere", async () => {
    let current: MetadataSources = {
      drivers: [
        {
          driverKind: "one",
          metadata: { displayName: "One" },
          configSchema: undefined,
          defaultConfig: () => "canary-default-config",
          apiKey: "canary-api-key",
        },
      ],
      requests: [],
      scopes: {},
    };
    const port = createBackendServicesMetadata(() => current);
    const service = serviceOf(port);
    const first = await service.serve(
      "inspect.query",
      ctx({ providerId: "backend-services", targetId: "driver:one" }),
    );
    expect(first).toMatchObject({
      status: "done",
      result: { outcome: "ok", state: "unsupported" },
    });
    expect(JSON.stringify(first)).not.toContain("canary");
    current = { drivers: [], requests: [], scopes: {} };
    expect(
      await service.serve("inspect.list", ctx({ providerId: "backend-services" })),
    ).toMatchObject({ status: "done", result: { total: 0, entries: [] } });
  });

  it("a throwing source is unavailable, never an empty list", async () => {
    const port = createBackendServicesMetadata(() => {
      throw new Error("canary-source-failure");
    });
    const answer = await serviceOf(port).serve(
      "inspect.list",
      ctx({ providerId: "backend-services" }),
    );
    expect(answer).toEqual({ status: "unavailable", code: "INSPECT_PROVIDER_FAILED" });
  });
});
