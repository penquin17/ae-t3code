// AETHERIA M11 change exercise (design D1–D5): a new provider, `exercise-provider`, joins the REAL Backend inspect registration through `registry.register` alone.
// Shows list, query, paging, selector and refusals through the real service, every request and result checked by the core's XC-6 inspect codec, and a clean disposal.
// Does NOT show the app server's wire or M03's verdict; a provider needing a new state, outcome or operation would be a core change, and none is attempted.
import { describe, expect, it } from "vite-plus/test";

import {
  decodeListRequest,
  decodeListResult,
  decodeQueryRequest,
  decodeQueryResult,
  type InspectProvider,
  type ListPage,
  type QueryTarget,
} from "./inspectEntry.ts";
import { createInspectBackendRegistration } from "./inspectRegistration.ts";
import type { InspectAccessPort } from "./inspectAccess.ts";
import type { InspectLogEvent, InspectSettled } from "./service.ts";
import type { BackendServicesMetadataPort } from "./metadataProviders.ts";

const PROVIDER_ID = "exercise-provider";

interface Fixture {
  readonly id: string;
  readonly state: "active" | "inactive";
  readonly shape: { readonly label: string; readonly size: number; readonly tags: string[] };
}
const FIXTURES: readonly Fixture[] = Array.from({ length: 7 }, (_, index) => {
  const n = String(index + 1).padStart(2, "0");
  return {
    id: `item-${n}`,
    state: index === 4 ? "inactive" : "active",
    shape: { label: `Item ${n}`, size: index + 1, tags: ["plain", `n${index + 1}`] },
  } as const;
});

/** The whole adapter: plain data in, plain data out. It reads no service, calls nothing, and holds no capability. */
const createExerciseProvider = (reads: string[] = []): InspectProvider => ({
  providerId: PROVIDER_ID,
  host: "backend",
  list(page: ListPage) {
    reads.push("list");
    const all = page.kind === undefined || page.kind === "exercise-item" ? FIXTURES : [];
    return {
      total: all.length,
      entries: all.slice(page.offset, page.offset + page.limit).map((f) => ({
        targetId: f.id,
        kind: "exercise-item",
        state: f.state,
        summary: `static exercise target ${f.id}`,
      })),
    };
  },
  query(request: QueryTarget) {
    reads.push("query");
    const found = FIXTURES.find((f) => f.id === request.targetId);
    if (found === undefined) return { outcome: "unavailable" };
    return { outcome: "ok", state: found.state, shape: { id: found.id, ...found.shape } };
  },
});

const exact = { state: "exact", document: { type: "object" } } as const;
const metadata = (): BackendServicesMetadataPort => ({
  drivers: () => [{ id: "alpha", metadata: { displayName: "Alpha" }, config: exact }],
  rpcMethods: () => [],
});

const ctx = (args: Record<string, unknown>) => ({
  caller: { threadId: "t", providerSessionId: "p", providerInstanceId: "pi" },
  sessionId: "s",
  kind: "main",
  rootSessionId: "s",
  args,
});
const ALLOW: InspectAccessPort = { check: async () => ({ ok: true }) };

const build = (
  options: {
    access?: InspectAccessPort;
    enabled?: boolean;
    log?: (event: InspectLogEvent) => void;
  } = {},
) => {
  const registration = createInspectBackendRegistration({
    access: options.access ?? ALLOW,
    enablement: { enabled: options.enabled ?? true },
    metadata: metadata(),
    ...(options.log === undefined ? {} : { log: options.log }),
  });
  return registration;
};

/** Serve a list call: the request must pass the codec, and the settled `done` result must decode as a list result. */
const list = async (
  service: ReturnType<typeof build>["service"],
  args: Record<string, unknown>,
) => {
  expect(decodeListRequest(args).ok, JSON.stringify(args)).toBe(true);
  const settled = await service.serve("inspect.list", ctx(args));
  expect(settled.status).toBe("done");
  const result = (settled as { result: unknown }).result;
  const decoded = decodeListResult(result);
  expect(decoded.ok, JSON.stringify(decoded)).toBe(true);
  return result as {
    outcome: string;
    entries: Array<{
      providerId: string;
      targetId: string;
      kind: string;
      host: string;
      state: string;
    }>;
    total: number;
    offset: number;
    limit: number;
    nextOffset: number | null;
  };
};
const query = async (
  service: ReturnType<typeof build>["service"],
  args: Record<string, unknown>,
) => {
  expect(decodeQueryRequest(args).ok, JSON.stringify(args)).toBe(true);
  const settled = await service.serve("inspect.query", ctx(args));
  expect(settled.status).toBe("done");
  const result = (settled as { result: unknown }).result;
  const decoded = decodeQueryResult(result);
  expect(decoded.ok, JSON.stringify(decoded)).toBe(true);
  return result as {
    outcome: string;
    state?: string;
    shape?: unknown;
    values?: unknown;
    omitted?: unknown;
  };
};

describe("supplying another adapter by registration only", () => {
  it("registers through the real registration's registry and appears beside backend-services in the stable order", async () => {
    const registration = build();
    const operationsBefore = Object.keys(registration.service.operations()).sort();
    expect(registration.registry.providers()).toEqual(["backend-services"]);

    const dispose = registration.registry.register(createExerciseProvider());
    expect(registration.registry.providers().sort()).toEqual(
      [PROVIDER_ID, "backend-services"].sort(),
    );
    expect(Object.keys(registration.service.operations()).sort()).toEqual(operationsBefore);
    expect(operationsBefore).toEqual(["inspect.list", "inspect.query"]);

    const all = await list(registration.service, {});
    expect(all.entries.map((e) => `${e.providerId}:${e.targetId}`).slice(0, 3)).toEqual([
      "backend-services:driver:alpha",
      `${PROVIDER_ID}:item-01`,
      `${PROVIDER_ID}:item-02`,
    ]);
    expect(all.total).toBe(8);
    expect(all.entries.every((e) => e.host === "backend")).toBe(true);
    dispose();
  });

  it("lists its targets, filters by kind, and pages with a nextOffset that resumes to the end", async () => {
    const registration = build();
    registration.registry.register(createExerciseProvider());
    const first = await list(registration.service, { providerId: PROVIDER_ID, limit: 3 });
    expect(first).toMatchObject({ outcome: "ok", total: 7, offset: 0, limit: 3, nextOffset: 3 });
    expect(first.entries.map((e) => e.targetId)).toEqual(["item-01", "item-02", "item-03"]);
    expect(
      first.entries.every((e) => e.providerId === PROVIDER_ID && e.kind === "exercise-item"),
    ).toBe(true);
    const second = await list(registration.service, {
      providerId: PROVIDER_ID,
      offset: 3,
      limit: 3,
    });
    expect(second).toMatchObject({ nextOffset: 6 });
    expect(second.entries.map((e) => `${e.targetId}:${e.state}`)).toEqual([
      "item-04:active",
      "item-05:inactive",
      "item-06:active",
    ]);
    const last = await list(registration.service, { providerId: PROVIDER_ID, offset: 6, limit: 3 });
    expect(last.entries.map((e) => e.targetId)).toEqual(["item-07"]);
    expect(last.nextOffset).toBeNull();
    const kind = await list(registration.service, {
      providerId: PROVIDER_ID,
      kind: "exercise-item",
    });
    expect(kind.total).toBe(7);
    const other = await list(registration.service, { providerId: PROVIDER_ID, kind: "module" });
    expect(other.entries).toEqual([]);
  });

  it("answers a query with its shape-only fields, carries state, reaches a part by selector and reports a missing part as schema-unsupported", async () => {
    const registration = build();
    registration.registry.register(createExerciseProvider());
    const whole = await query(registration.service, {
      providerId: PROVIDER_ID,
      targetId: "item-05",
    });
    expect(whole).toMatchObject({
      outcome: "ok",
      state: "inactive",
      shape: { id: "item-05", label: "Item 05", size: 5, tags: ["plain", "n5"] },
      values: {},
      omitted: [],
    });
    const part = await query(registration.service, {
      providerId: PROVIDER_ID,
      targetId: "item-02",
      selector: "tags[1]",
    });
    expect(part).toMatchObject({ outcome: "ok", shape: "n2" });
    const missing = await query(registration.service, {
      providerId: PROVIDER_ID,
      targetId: "item-02",
      selector: "nothing.here",
    });
    expect(missing.outcome).toBe("schema-unsupported");
    const unknown = await query(registration.service, {
      providerId: PROVIDER_ID,
      targetId: "item-99",
    });
    expect(unknown.outcome).toBe("unavailable");
  });

  it("is refused by the same boundaries as every provider: unknown id, write-shaped request, refused caller, inspection off", async () => {
    const reads: string[] = [];
    const registration = build();
    registration.registry.register(createExerciseProvider(reads));
    expect(
      await registration.service.serve("inspect.list", ctx({ providerId: "exercise-other" })),
    ).toEqual({
      status: "unavailable",
      code: "INSPECT_UNKNOWN_PROVIDER",
    });
    expect(
      await registration.service.serve("inspect.run", ctx({ providerId: PROVIDER_ID })),
    ).toEqual({
      status: "refused",
      code: "INSPECT_READONLY",
    });
    const write = ctx({
      providerId: PROVIDER_ID,
      targetId: "item-01",
      selector: "label.constructor()",
    });
    expect(decodeQueryRequest(write.args).ok).toBe(false);
    expect(await registration.service.serve("inspect.query", write)).toMatchObject({
      status: "refused",
    });
    const claim = ctx({ providerId: PROVIDER_ID, targetId: "item-01", sessionId: "other" });
    expect(await registration.service.serve("inspect.query", claim)).toMatchObject({
      status: "refused",
    });
    expect(reads).toEqual([]);

    const denied = build({
      access: { check: async () => ({ ok: false, code: "AUTH_FORBIDDEN", reason: "no" }) },
    });
    denied.registry.register(createExerciseProvider(reads));
    expect(
      await denied.service.serve(
        "inspect.query",
        ctx({ providerId: PROVIDER_ID, targetId: "item-01" }),
      ),
    ).toMatchObject({ status: "refused", code: "AUTH_FORBIDDEN" });
    const off = build({ enabled: false });
    off.registry.register(createExerciseProvider(reads));
    expect(await off.service.serve("inspect.list", ctx({ providerId: PROVIDER_ID }))).toEqual({
      status: "unavailable",
      code: "INSPECT_UNAVAILABLE",
    });
    expect(reads).toEqual([]);
  });

  it("refuses a duplicate id and a provider whose answer carries a callable, with no change to the other providers", async () => {
    const registration = build();
    registration.registry.register(createExerciseProvider());
    expect(() => registration.registry.register(createExerciseProvider())).toThrow(
      expect.objectContaining({ code: "INSPECT_DUPLICATE_PROVIDER" }),
    );
    registration.registry.register({
      providerId: "exercise-handle",
      host: "backend",
      list: () => ({ total: 0, entries: [] }),
      query: () => ({ outcome: "ok", state: "active", shape: { run: () => 1 } }),
    });
    const settled: InspectSettled = await registration.service.serve(
      "inspect.query",
      ctx({ providerId: "exercise-handle", targetId: "x" }),
    );
    expect(settled).toEqual({ status: "refused", code: "INSPECT_READONLY" });
    expect(
      (await query(registration.service, { providerId: PROVIDER_ID, targetId: "item-01" })).outcome,
    ).toBe("ok");
    expect((await list(registration.service, { providerId: "backend-services" })).total).toBe(1);
  });

  it("leaves nothing behind when disposed: the id is unknown, the other provider and both operations are as before, and no log line carries a value", async () => {
    const logs: InspectLogEvent[] = [];
    const registration = build({ log: (e) => logs.push(e) });
    const dispose = registration.registry.register(createExerciseProvider());
    await query(registration.service, { providerId: PROVIDER_ID, targetId: "item-01" });
    dispose();
    dispose();
    expect(registration.registry.providers()).toEqual(["backend-services"]);
    expect(
      await registration.service.serve("inspect.list", ctx({ providerId: PROVIDER_ID })),
    ).toEqual({
      status: "unavailable",
      code: "INSPECT_UNKNOWN_PROVIDER",
    });
    expect((await list(registration.service, {})).total).toBe(1);
    expect(Object.keys(registration.service.operations()).sort()).toEqual([
      "inspect.list",
      "inspect.query",
    ]);
    expect(JSON.stringify(logs)).not.toContain("Item 01");
    expect(registration.service.held()).toBe(0);
  });
});
