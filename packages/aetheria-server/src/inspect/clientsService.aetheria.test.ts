// @effect-diagnostics globalDate:off
// AETHERIA M11 Plan steps 18 and 20 (C5 P4, C2 P1; D8–D12) — the `client-regions` provider through the REAL inspection service: the caller's own thread is the only one asked, a client query is held to D and
// answers `done` with an outcome (never `pending`), and no waiting work outlives a call.
//
// Boundary: the real service and the real C5 resolver over a scripted `ClientPort`, a scripted caller check and a scripted scheduler (the deadline is a number the test moves). It shows: the verified caller's
// thread, not an argument, selects the pages (an argument naming a thread is INSPECT_INVALID, another thread's pages are never listed or reached); list is the registry's live regions for that thread only;
// one viewer answers ok through the projector's caps and a selector, two answer ambiguous with ids and last-seen, none no-client; a silent page answers timeout at D with the service's held call and the
// resolver's waiting entry both gone; 300 abandoned queries leave nothing held and no timer and never answer pending; drain settles held client queries unavailable and counts each once. It does NOT show
// the registry, the request stream, the reply method or the XC-6 route (apps/server inspectIsolation.aetheria.test.ts and inspectXc6.aetheria.test.ts).
import type { Xc6OperationContext } from "@t3tools/aetheria-contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createClientQueries,
  type ClientPort,
  type ClientRegionInfo,
  type ClientRequest,
  type ClientView,
} from "./clients.ts";
import { createInspectService, type InspectSettled } from "./service.ts";

const D = 10_000;
const CLIENT_A = "client-aaaaaaaaaaaaaaaa";
const CLIENT_B = "client-bbbbbbbbbbbbbbbb";
const flush = async () => {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
};

const region = (id: string, extra: Partial<ClientRegionInfo> = {}): ClientRegionInfo => ({
  id,
  kind: "region",
  description: `The ${id} region`,
  schemaVersion: 1,
  visible: true,
  props: [
    { name: "title", type: "string", report: "value" },
    { name: "secretNote", type: "string", report: "shape" },
  ],
  state: [{ name: "phase", type: "string", report: "value" }],
  tokens: ["--ae-color-accent"],
  ...extra,
});

const makeClock = () => {
  let elapsed = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => 1_700_000_000_000 + elapsed,
    schedule: (ms: number, fn: () => void) => {
      const id = next++;
      timers.set(id, { at: elapsed + ms, fn });
      return () => void timers.delete(id);
    },
    advance: (ms: number) => {
      elapsed += ms;
      for (const [id, timer] of timers)
        if (timer.at <= elapsed) {
          timers.delete(id);
          timer.fn();
        }
    },
    timers: () => timers.size,
  };
};

const world = () => {
  const views = new Map<string, Map<string, ClientView>>();
  const sent: Array<{ connectionId: string; request: ClientRequest }> = [];
  const port: ClientPort = {
    viewers: (threadId) => [...(views.get(threadId)?.values() ?? [])],
    viewer: (threadId, clientId) => views.get(threadId)?.get(clientId),
    send: (connectionId, request) => {
      sent.push({ connectionId, request });
      return true;
    },
  };
  return {
    port,
    sent,
    view(threadId: string, clientId: string, connectionId: string, regions = [region("shell")]) {
      const map = views.get(threadId) ?? new Map<string, ClientView>();
      map.set(clientId, { clientId, connectionId, lastSeenMs: 1_700_000_000_000, regions });
      views.set(threadId, map);
    },
  };
};

const setup = () => {
  const clock = makeClock();
  const pages = world();
  let n = 0;
  const clients = createClientQueries({
    port: pages.port,
    deadlineMs: D,
    schedule: clock.schedule,
    newId: () => `req-${(n += 1)}`,
  });
  const service = createInspectService({
    access: { check: async () => ({ ok: true }) },
    enabled: true,
    registries: [],
    clients,
    showValues: [],
    now: clock.now,
    schedule: clock.schedule,
    deadlineMs: D,
  });
  return { clock, pages, clients, service };
};

const context = (args: Record<string, unknown>, threadId = "thread-1"): Xc6OperationContext => ({
  caller: { threadId, providerSessionId: "ps-1", providerInstanceId: "pi" },
  sessionId: "session-1",
  kind: "main",
  rootSessionId: "session-1",
  args,
});
const result = (settled: InspectSettled) => {
  if (settled.status !== "done") throw new Error(`expected done, got ${settled.status}`);
  return settled.result as Record<string, unknown>;
};
const okReply = {
  outcome: "ok",
  state: "active",
  shape: {},
  values: { "props.title": "Hello", "props.secretNote": "no", "state.phase": "running" },
};

describe("the caller's thread selects the pages", () => {
  it("lists only the regions of pages viewing the caller's thread, in the client host, with their live state", async () => {
    const { service, pages } = setup();
    pages.view("thread-1", CLIENT_A, "conn-a", [
      region("shell"),
      region("composer", { visible: false }),
    ]);
    pages.view("thread-2", CLIENT_B, "conn-b", [region("elsewhere")]);
    const listed = result(
      await service.serve("inspect.list", context({ providerId: "client-regions" })),
    );
    expect(listed).toMatchObject({ outcome: "ok", total: 2 });
    expect(
      (listed.entries as Array<Record<string, unknown>>).map((e) => [e.targetId, e.state, e.host]),
    ).toEqual([
      ["composer", "inactive", "client"],
      ["shell", "active", "client"],
    ]);
    const other = result(
      await service.serve("inspect.list", context({ providerId: "client-regions" }, "thread-2")),
    );
    expect((other.entries as Array<Record<string, unknown>>).map((e) => e.targetId)).toEqual([
      "elsewhere",
    ]);
    expect(pages.sent).toEqual([]); // a list asks no page
  });

  it("refuses an argument that names a thread, a client's principal or a session: the thread is the caller's alone", async () => {
    const { service, pages } = setup();
    pages.view("thread-2", CLIENT_B, "conn-b");
    for (const forged of [{ threadId: "thread-2" }, { principal: "bob" }, { sessionId: "x" }]) {
      const answer = await service.serve(
        "inspect.query",
        context({ providerId: "client-regions", targetId: "shell", ...forged }),
      );
      expect(answer).toMatchObject({ status: "refused", code: "INSPECT_INVALID" });
    }
    expect(pages.sent).toEqual([]);
  });

  it("a page viewing another thread is never asked, even by explicit id: no-client", async () => {
    const { service, pages } = setup();
    pages.view("thread-2", CLIENT_B, "conn-b");
    const answer = result(
      await service.serve(
        "inspect.query",
        context({ providerId: "client-regions", targetId: "shell", clientId: CLIENT_B }),
      ),
    );
    expect(answer).toMatchObject({
      outcome: "no-client",
      providerId: "client-regions",
      targetId: "shell",
    });
    expect(pages.sent).toEqual([]);
  });
});

describe("one live round trip, held", () => {
  it("one viewer answers ok after exactly one request, with only the descriptor's value fields and a selector applied to the shape", async () => {
    const { service, pages, clients, clock } = setup();
    pages.view("thread-1", CLIENT_A, "conn-a");
    const asking = service.serve(
      "inspect.query",
      context({ providerId: "client-regions", targetId: "shell" }),
    );
    await flush();
    expect(service.held()).toBe(1);
    expect(clients.held()).toBe(1);
    expect(pages.sent).toHaveLength(1);
    expect(clients.reply({ connectionId: "conn-a", requestId: "req-1", reply: okReply })).toBe(
      "accepted",
    );
    const answer = result(await asking);
    expect(answer).toMatchObject({
      outcome: "ok",
      providerId: "client-regions",
      targetId: "shell",
      state: "active",
      clientId: CLIENT_A,
      values: { "props.title": "Hello", "state.phase": "running" },
      omitted: [{ path: "props.secretNote", reason: "not-allowed" }],
    });
    expect(JSON.stringify(answer)).not.toContain('"no"');
    expect(service.held()).toBe(0);
    expect(clients.held()).toBe(0);
    expect(clock.timers()).toBe(0);

    const selected = pages.sent.length;
    const part = service.serve(
      "inspect.query",
      context({ providerId: "client-regions", targetId: "shell", selector: "props" }),
    );
    await flush();
    clients.reply({ connectionId: "conn-a", requestId: "req-2", reply: okReply });
    expect(result(await part)).toMatchObject({ outcome: "ok", selector: "props" });
    expect(pages.sent.length).toBe(selected + 1);
  });

  it("two viewers answer ambiguous with ids and last-seen only, and no request is sent", async () => {
    const { service, pages } = setup();
    pages.view("thread-1", CLIENT_A, "conn-a");
    pages.view("thread-1", CLIENT_B, "conn-b");
    const answer = result(
      await service.serve(
        "inspect.query",
        context({ providerId: "client-regions", targetId: "shell" }),
      ),
    );
    expect(answer).toMatchObject({ outcome: "ambiguous" });
    expect(answer.clients).toEqual([
      { clientId: CLIENT_A, lastSeen: "2023-11-14T22:13:20.000Z" },
      { clientId: CLIENT_B, lastSeen: "2023-11-14T22:13:20.000Z" },
    ]);
    expect(pages.sent).toEqual([]);
  });

  it("an explicit id selects one of two viewers", async () => {
    const { service, pages, clients } = setup();
    pages.view("thread-1", CLIENT_A, "conn-a");
    pages.view("thread-1", CLIENT_B, "conn-b");
    const asking = service.serve(
      "inspect.query",
      context({ providerId: "client-regions", targetId: "shell", clientId: CLIENT_B }),
    );
    await flush();
    expect(pages.sent.map((s) => s.connectionId)).toEqual(["conn-b"]);
    clients.reply({ connectionId: "conn-b", requestId: "req-1", reply: okReply });
    expect(result(await asking)).toMatchObject({ outcome: "ok", clientId: CLIENT_B });
  });

  it("a silent page is timeout at D, with the held call and the waiting entry both gone, and the late reply dropped", async () => {
    const { service, pages, clients, clock } = setup();
    pages.view("thread-1", CLIENT_A, "conn-a");
    let settled: InspectSettled | undefined;
    void service
      .serve("inspect.query", context({ providerId: "client-regions", targetId: "shell" }))
      .then((s) => (settled = s));
    await flush();
    clock.advance(D - 1);
    await flush();
    expect(settled).toBeUndefined();
    clock.advance(1);
    await flush();
    expect(result(settled!)).toMatchObject({ outcome: "timeout", targetId: "shell" });
    expect(service.held()).toBe(0);
    expect(clients.held()).toBe(0);
    expect(clock.timers()).toBe(0);
    expect(clients.reply({ connectionId: "conn-a", requestId: "req-1", reply: okReply })).toBe(
      "dropped",
    );
    expect(pages.sent).toHaveLength(1);
  });

  it("a connection that ends mid-query is disconnected", async () => {
    const { service, pages, clients } = setup();
    pages.view("thread-1", CLIENT_A, "conn-a");
    const asking = service.serve(
      "inspect.query",
      context({ providerId: "client-regions", targetId: "shell" }),
    );
    await flush();
    clients.connectionEnded("conn-a");
    expect(result(await asking)).toMatchObject({ outcome: "disconnected" });
    expect(service.held()).toBe(0);
  });
});

describe("lifetime", () => {
  it("300 abandoned client queries each end at D with nothing held, no timer and never a pending answer", async () => {
    const { service, pages, clients, clock } = setup();
    pages.view("thread-1", CLIENT_A, "conn-a");
    const statuses = new Set<string>();
    for (let i = 0; i < 300; i += 1) {
      void service
        .serve("inspect.query", context({ providerId: "client-regions", targetId: "shell" }))
        .then((s) => statuses.add(s.status));
      await flush();
      expect(clients.held()).toBe(1);
      clock.advance(D);
      await flush();
      expect(service.held()).toBe(0);
      expect(clients.held()).toBe(0);
      expect(clock.timers()).toBe(0);
    }
    expect([...statuses]).toEqual(["done"]);
    expect(pages.sent).toHaveLength(300);
  });

  it("drain settles held client queries unavailable, counts each held call once, and refuses later calls", async () => {
    const { service, pages, clients } = setup();
    pages.view("thread-1", CLIENT_A, "conn-a");
    pages.view("thread-2", CLIENT_B, "conn-b");
    const a = service.serve(
      "inspect.query",
      context({ providerId: "client-regions", targetId: "shell" }),
    );
    const b = service.serve(
      "inspect.query",
      context({ providerId: "client-regions", targetId: "shell" }, "thread-2"),
    );
    await flush();
    expect(service.drain()).toEqual({ stopped: 2 });
    expect(await a).toEqual({ status: "unavailable", code: "INSPECT_UNAVAILABLE" });
    expect(await b).toEqual({ status: "unavailable", code: "INSPECT_UNAVAILABLE" });
    expect(clients.held()).toBe(0);
    expect(
      await service.serve(
        "inspect.query",
        context({ providerId: "client-regions", targetId: "shell" }),
      ),
    ).toEqual({ status: "unavailable", code: "INSPECT_UNAVAILABLE" });
  });
});
