// M11 step 18 (C5 P4; D8–D12): the real resolver over a scripted `ClientPort` and a scripted scheduler (no wall clock) — eligibility, one request, one wait, one outcome, 300 abandoned queries leave nothing.
// Not shown: the registry, a socket, the XC-6 carrier or the service's hold (clientsService.aetheria.test.ts).
import { describe, expect, it } from "vite-plus/test";

import {
  createClientQueries,
  type ClientLogEvent,
  type ClientPort,
  type ClientRegionInfo,
  type ClientRequest,
  type ClientView,
} from "./clients.ts";

const CLIENT_A = "client-aaaaaaaaaaaaaaaa";
const CLIENT_B = "client-bbbbbbbbbbbbbbbb";
const D = 10_000;

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

/** A scripted port: who views which thread, on which connection, and what was sent where. */
const makePort = () => {
  const views = new Map<string, Map<string, ClientView>>();
  const open = new Set<string>();
  const sent: Array<{ connectionId: string; request: ClientRequest }> = [];
  const port: ClientPort = {
    viewers: (threadId) => [...(views.get(threadId)?.values() ?? [])],
    viewer: (threadId, clientId) => views.get(threadId)?.get(clientId),
    send: (connectionId, request) => {
      if (!open.has(connectionId)) return false;
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
      open.add(connectionId);
    },
    leave(threadId: string, clientId: string) {
      views.get(threadId)?.delete(clientId);
    },
  };
};

const setup = (log?: (event: ClientLogEvent) => void) => {
  const clock = makeClock();
  const world = makePort();
  let n = 0;
  const queries = createClientQueries({
    port: world.port,
    deadlineMs: D,
    schedule: clock.schedule,
    newId: () => `req-${(n += 1)}`,
    ...(log === undefined ? {} : { log }),
  });
  return { clock, world, queries };
};

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};
const okReply = {
  outcome: "ok",
  state: "active",
  shape: { anything: "the page's own shape is ignored for a mounted region" },
  values: {
    "props.title": "Hello",
    "props.secretNote": "must not pass",
    "state.phase": "running",
    "props.undeclared": "must not pass",
    "tokens.--ae-color-accent": "#ff0000",
    "tokens.--not-declared": "x",
  },
};

describe("which page is asked", () => {
  it("answers no-client when nobody views the requesting thread, and sends nothing", async () => {
    const { queries, world } = setup();
    expect(await queries.query({ threadId: "t1", regionId: "shell" })).toEqual({
      outcome: "no-client",
    });
    expect(world.sent).toEqual([]);
  });

  it("answers ambiguous for two viewers with ids and last-seen only, and sends nothing", async () => {
    const { queries, world } = setup();
    world.view("t1", CLIENT_B, "conn-b");
    world.view("t1", CLIENT_A, "conn-a");
    const answer = await queries.query({ threadId: "t1", regionId: "shell" });
    expect(answer).toEqual({
      outcome: "ambiguous",
      clients: [
        { clientId: CLIENT_A, lastSeenMs: 1_700_000_000_000 },
        { clientId: CLIENT_B, lastSeenMs: 1_700_000_000_000 },
      ],
    });
    expect(JSON.stringify(answer)).not.toMatch(/conn-|principal|device|shell/);
    expect(world.sent).toEqual([]);
  });

  it("with an explicit id selects that one of two viewers; an id viewing another thread or unknown is no-client", async () => {
    const { queries, world } = setup();
    world.view("t1", CLIENT_A, "conn-a");
    world.view("t1", CLIENT_B, "conn-b");
    world.view("t2", "client-cccccccccccccccc", "conn-c");
    const pending = queries.query({ threadId: "t1", regionId: "shell", clientId: CLIENT_B });
    expect(world.sent.map((s) => s.connectionId)).toEqual(["conn-b"]);
    expect(queries.reply({ connectionId: "conn-b", requestId: "req-1", reply: okReply })).toBe(
      "accepted",
    );
    expect((await pending).outcome).toBe("ok");
    expect(
      await queries.query({
        threadId: "t1",
        regionId: "shell",
        clientId: "client-cccccccccccccccc",
      }),
    ).toEqual({
      outcome: "no-client",
    });
    expect(
      await queries.query({
        threadId: "t1",
        regionId: "shell",
        clientId: "client-zzzzzzzzzzzzzzzz",
      }),
    ).toEqual({
      outcome: "no-client",
    });
    expect(world.sent).toHaveLength(1);
  });

  it("answers no-client, with nothing sent, when the one viewer has no open request stream", async () => {
    const { queries, world } = setup();
    world.view("t1", CLIENT_A, "conn-a");
    world.port.send = () => false;
    expect(await queries.query({ threadId: "t1", regionId: "shell" })).toEqual({
      outcome: "no-client",
    });
    expect(queries.held()).toBe(0);
  });

  it("lists the regions the viewing clients have mounted, one per id, visible if visible anywhere", () => {
    const { queries, world } = setup();
    world.view("t1", CLIENT_A, "conn-a", [region("shell", { visible: false }), region("composer")]);
    world.view("t1", CLIENT_B, "conn-b", [region("shell")]);
    world.view("t2", "client-cccccccccccccccc", "conn-c", [region("other")]);
    expect(queries.regions("t1").map((r) => [r.id, r.visible])).toEqual([
      ["composer", true],
      ["shell", true],
    ]);
    expect(queries.regions("t9")).toEqual([]);
  });
});

describe("one request, one wait, one outcome", () => {
  it("sends exactly one correlated request with the region, schema and deadline, and settles ok on the reply", async () => {
    const { queries, world, clock } = setup();
    world.view("t1", CLIENT_A, "conn-a");
    const pending = queries.query({ threadId: "t1", regionId: "shell" });
    expect(world.sent).toEqual([
      {
        connectionId: "conn-a",
        request: { requestId: "req-1", regionId: "shell", schemaVersion: 1, remainingMs: D },
      },
    ]);
    expect(queries.held()).toBe(1);
    expect(clock.timers()).toBe(1);
    expect(queries.reply({ connectionId: "conn-a", requestId: "req-1", reply: okReply })).toBe(
      "accepted",
    );
    const answer = await pending;
    expect(answer).toMatchObject({ outcome: "ok", clientId: CLIENT_A, state: "active" });
    expect(world.sent).toHaveLength(1);
    expect(queries.held()).toBe(0);
    expect(clock.timers()).toBe(0);
  });

  it("applies the descriptor again: only value fields pass, shape fields are omitted, undeclared keys and tokens are dropped, the shape is the descriptor's", async () => {
    const { queries, world } = setup();
    world.view("t1", CLIENT_A, "conn-a");
    const pending = queries.query({ threadId: "t1", regionId: "shell" });
    queries.reply({ connectionId: "conn-a", requestId: "req-1", reply: okReply });
    const answer = await pending;
    if (answer.outcome !== "ok") throw new Error("expected ok");
    expect(answer.values).toEqual({
      "props.title": "Hello",
      "state.phase": "running",
      "tokens.--ae-color-accent": "#ff0000",
    });
    expect(answer.omitted).toEqual([{ path: "props.secretNote", reason: "not-allowed" }]);
    expect(JSON.stringify(answer)).not.toMatch(/must not pass|undeclared|not-declared|ignored/);
    expect(answer.shape).toMatchObject({ id: "shell", schemaVersion: 1 });
  });

  it("gives an unmounted region its shape and no value, even if the page sent values", async () => {
    const { queries, world } = setup();
    world.view("t1", CLIENT_A, "conn-a", [region("other")]);
    const pending = queries.query({ threadId: "t1", regionId: "shell" });
    queries.reply({
      connectionId: "conn-a",
      requestId: "req-1",
      reply: {
        outcome: "ok",
        state: "inactive",
        shape: { id: "shell", props: [] },
        values: { "props.title": "leak" },
      },
    });
    expect(await pending).toEqual({
      outcome: "ok",
      clientId: CLIENT_A,
      state: "inactive",
      shape: { id: "shell", props: [] },
      values: {},
      omitted: [],
    });
  });

  it("passes the page's own region-not-found, schema-unsupported and unavailable through", async () => {
    for (const outcome of ["region-not-found", "schema-unsupported", "unavailable"] as const) {
      const { queries, world } = setup();
      world.view("t1", CLIENT_A, "conn-a");
      const pending = queries.query({ threadId: "t1", regionId: "shell" });
      queries.reply({ connectionId: "conn-a", requestId: "req-1", reply: { outcome } });
      expect(await pending).toEqual({ outcome });
    }
  });

  it("a silent page is timeout at D, not before, and its late reply is dropped", async () => {
    const events: ClientLogEvent[] = [];
    const { queries, world, clock } = setup((e) => events.push(e));
    world.view("t1", CLIENT_A, "conn-a");
    let settled: unknown;
    void queries.query({ threadId: "t1", regionId: "shell" }).then((a) => (settled = a));
    clock.advance(D - 1);
    await flush();
    expect(settled).toBeUndefined();
    expect(queries.held()).toBe(1);
    clock.advance(1);
    await flush();
    expect(settled).toEqual({ outcome: "timeout" });
    expect(queries.held()).toBe(0);
    expect(queries.reply({ connectionId: "conn-a", requestId: "req-1", reply: okReply })).toBe(
      "dropped",
    );
    expect(world.sent).toHaveLength(1);
    expect(events.some((e) => e.event === "reply-dropped" && e.code === "no-waiting-query")).toBe(
      true,
    );
  });

  it("the connection's end is disconnected, once, and only for the queries waiting on that connection", async () => {
    const { queries, world, clock } = setup();
    world.view("t1", CLIENT_A, "conn-a");
    world.view("t2", CLIENT_B, "conn-b");
    const a = queries.query({ threadId: "t1", regionId: "shell" });
    const b = queries.query({ threadId: "t2", regionId: "shell" });
    expect(queries.connectionEnded("conn-a")).toBe(1);
    expect(await a).toEqual({ outcome: "disconnected" });
    expect(queries.connectionEnded("conn-a")).toBe(0);
    expect(queries.held()).toBe(1);
    expect(clock.timers()).toBe(1);
    queries.reply({ connectionId: "conn-b", requestId: "req-2", reply: okReply });
    expect((await b).outcome).toBe("ok");
  });

  it("D does not reset: a reply after a reconnect is refused and the query still ends at D", async () => {
    const { queries, world, clock } = setup();
    world.view("t1", CLIENT_A, "conn-a");
    let settled: unknown;
    void queries.query({ threadId: "t1", regionId: "shell" }).then((a) => (settled = a));
    clock.advance(6_000);
    world.view("t1", CLIENT_A, "conn-a2"); // the same client id taken over on a new connection
    expect(queries.reply({ connectionId: "conn-a2", requestId: "req-1", reply: okReply })).toBe(
      "dropped",
    );
    expect(world.sent).toHaveLength(1); // never reissued to the new connection
    await flush();
    // the reply on the NEW connection was another connection's: the query is still waiting for the asked one
    clock.advance(4_000);
    await flush();
    expect(settled).toEqual({ outcome: "timeout" });
  });
});

describe("a reply that is not the asked page's, in the asked view, once", () => {
  it("drops a reply from another connection and a duplicate, changing nothing", async () => {
    const { queries, world } = setup();
    world.view("t1", CLIENT_A, "conn-a");
    world.view("t2", CLIENT_B, "conn-b");
    const pending = queries.query({ threadId: "t1", regionId: "shell" });
    expect(queries.reply({ connectionId: "conn-b", requestId: "req-1", reply: okReply })).toBe(
      "dropped",
    );
    expect(queries.held()).toBe(1);
    expect(queries.reply({ connectionId: "conn-a", requestId: "req-1", reply: okReply })).toBe(
      "accepted",
    );
    expect(queries.reply({ connectionId: "conn-a", requestId: "req-1", reply: okReply })).toBe(
      "dropped",
    );
    expect((await pending).outcome).toBe("ok");
  });

  it("a reply after the page left the thread is disconnected and carries nothing it held", async () => {
    const { queries, world } = setup();
    world.view("t1", CLIENT_A, "conn-a");
    const pending = queries.query({ threadId: "t1", regionId: "shell" });
    world.leave("t1", CLIENT_A);
    expect(queries.reply({ connectionId: "conn-a", requestId: "req-1", reply: okReply })).toBe(
      "dropped",
    );
    expect(await pending).toEqual({ outcome: "disconnected" });
  });

  it("a malformed reply (function, extra key, wrong state) is unavailable and carries nothing", async () => {
    for (const bad of [
      { outcome: "ok", state: "active", shape: () => 1, values: {} },
      { outcome: "ok", state: "active", shape: {}, values: {}, extra: 1 },
      { outcome: "ok", state: "weird", shape: {}, values: {} },
      { outcome: "region-not-found", extra: 1 },
      "text",
    ]) {
      const { queries, world } = setup();
      world.view("t1", CLIENT_A, "conn-a");
      const pending = queries.query({ threadId: "t1", regionId: "shell" });
      expect(queries.reply({ connectionId: "conn-a", requestId: "req-1", reply: bad })).toBe(
        "dropped",
      );
      expect(await pending).toEqual({ outcome: "unavailable" });
    }
  });

  it("logs codes and outcomes only, never a request id, client id, value or text", async () => {
    const events: ClientLogEvent[] = [];
    const { queries, world } = setup((e) => events.push(e));
    world.view("t1", CLIENT_A, "conn-a");
    const pending = queries.query({ threadId: "t1", regionId: "shell" });
    queries.reply({ connectionId: "conn-a", requestId: "req-1", reply: okReply });
    await pending;
    queries.reply({ connectionId: "conn-a", requestId: "req-1", reply: okReply });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toMatch(/req-1|client-aaaa|Hello|conn-a/);
  });
});

describe("lifetime", () => {
  it("300 abandoned queries each end at D and leave no waiting entry and no timer, and a following query is served", async () => {
    const { queries, world, clock } = setup();
    world.view("t1", CLIENT_A, "conn-a");
    for (let i = 0; i < 300; i += 1) {
      let settled: unknown;
      void queries.query({ threadId: "t1", regionId: "shell" }).then((a) => (settled = a));
      expect(queries.held()).toBe(1);
      clock.advance(D);
      await flush();
      expect(settled).toEqual({ outcome: "timeout" });
      expect(queries.held()).toBe(0);
      expect(clock.timers()).toBe(0);
    }
    expect(world.sent).toHaveLength(300); // one attempt each, never a retry
    const next = queries.query({ threadId: "t1", regionId: "shell" });
    queries.reply({ connectionId: "conn-a", requestId: "req-301", reply: okReply });
    expect((await next).outcome).toBe("ok");
  });

  it("drain settles every waiting query unavailable, counts them, cancels the timers and refuses new queries", async () => {
    const { queries, world, clock } = setup();
    world.view("t1", CLIENT_A, "conn-a");
    world.view("t2", CLIENT_B, "conn-b");
    const a = queries.query({ threadId: "t1", regionId: "shell" });
    const b = queries.query({ threadId: "t2", regionId: "shell" });
    expect(queries.drain()).toEqual({ stopped: 2 });
    expect(await a).toEqual({ outcome: "unavailable" });
    expect(await b).toEqual({ outcome: "unavailable" });
    expect(clock.timers()).toBe(0);
    expect(await queries.query({ threadId: "t1", regionId: "shell" })).toEqual({
      outcome: "unavailable",
    });
    expect(world.sent).toHaveLength(2);
  });
});
