// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 23 (D17, R3, XC-7, XC-19; IP-58 to IP-60) — the Backend's region state (`regionsState.ts`): the declared regions each connected client reports, bound to the AUTHENTICATED principal of
// the connection that reported them, with the threads the connection is observed viewing taken from T3's own subscription.
//
// Boundary: the state module alone, over an injected clock and id source (no network, no T3). It shows: the principal is the connection's and nothing in a payload can change it (a forged principal, session or
// viewing field is not read, and a forged or foreign client id is refused); two principals never see each other's clients and a principal's read needs the principal; the report is a whole replacement with a
// rising sequence (a stale one changes nothing); every bound (regions, body, clients per principal, clients in all, viewed threads, call rate) refuses before storing; disconnect, unmount and drain remove a
// client and say so; the store holds declared descriptors and visibility only (no value, no unknown key, no function), and nothing here makes a request.
// It does NOT show T3's `subscribeThread` or the handlers (regionsRpc.aetheria.test.ts), nor M11's consumer.
import {
  REGIONS_MAX_BODY_BYTES,
  REGIONS_MAX_CLIENTS,
  REGIONS_MAX_CLIENTS_PER_PRINCIPAL,
  REGIONS_MAX_REGIONS,
  REGIONS_MAX_VIEWING,
  REGIONS_RATE_BURST,
  REGIONS_RATE_PER_SECOND,
  type RegionDescriptor,
} from "@t3tools/aetheria-contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createRegionRegistry,
  drainSharedRegionRegistry,
  getSharedRegionRegistry,
  type RegionConnection,
  type RegionEvent,
  type RegionRegistry,
} from "./regionsState.ts";

let clock = 1_000_000;
const registryOf = (): RegionRegistry => {
  let n = 0;
  return createRegionRegistry({ now: () => clock, newId: () => `conn-${(n += 1)}` });
};

afterEach(() => {
  clock = 1_000_000;
  vi.restoreAllMocks();
});

const descriptor = (id: string, extra: Partial<RegionDescriptor> = {}): RegionDescriptor => ({
  id,
  kind: "region",
  owner: "aetheria-ui",
  parent: null,
  description: `The ${id} region`,
  schemaVersion: 1,
  props: [],
  state: [{ name: "phase", type: "string", report: "value" }],
  tokens: ["--ae-color-accent"],
  ...extra,
});

const ALICE = { subject: "alice", deviceSessionId: "dev-a1" };
const ALICE_PHONE = { subject: "alice", deviceSessionId: "dev-a2" };
const BOB = { subject: "bob", deviceSessionId: "dev-b1" };
const CLIENT_A = "client-alice-000000001";
const CLIENT_B = "client-bob-0000000001";

const report = (
  connection: RegionConnection,
  clientId: string,
  sequence: number,
  regions: ReadonlyArray<{ descriptor: RegionDescriptor; visible: boolean }> = [],
) => connection.report({ clientId, sequence, regions });
const mounted = (...ids: string[]) =>
  ids.map((id) => ({ descriptor: descriptor(id), visible: true }));

describe("the principal is the connection's, never a payload's", () => {
  it("stores the client under the principal the connection was opened for, and reads nothing else from the payload", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    const forged = {
      clientId: CLIENT_A,
      sequence: 1,
      regions: mounted("shell"),
      principal: { subject: "bob", deviceSessionId: "dev-b1" },
      subject: "bob",
      deviceSessionId: "dev-b1",
      sessionId: "forged-session",
      viewing: ["forged-thread"],
      threadId: "forged-thread",
    };
    const result = connection.report(forged as never);
    expect(result).toMatchObject({ ok: true });
    const client = registry.clientsFor({ subject: "alice" })[0]!;
    expect(client.principal).toEqual(ALICE);
    expect(client.viewing).toEqual([]);
    expect(registry.clientsFor({ subject: "bob" })).toEqual([]);
    expect(JSON.stringify(client)).not.toContain("forged");
  });

  it("takes the viewed threads only from the connection's observed subscriptions", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    report(connection, CLIENT_A, 1, mounted("shell"));
    const stop = connection.observeViewing("thread-1");
    connection.observeViewing("thread-2");
    expect(registry.clientsFor({ subject: "alice" })[0]!.viewing).toEqual(["thread-1", "thread-2"]);
    stop();
    expect(registry.clientsFor({ subject: "alice" })[0]!.viewing).toEqual(["thread-2"]);
  });

  it("keeps a thread viewed until its last subscription ends, and ignores a double release", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    report(connection, CLIENT_A, 1);
    const first = connection.observeViewing("thread-1");
    const second = connection.observeViewing("thread-1");
    first();
    first();
    expect(registry.clientsFor({ subject: "alice" })[0]!.viewing).toEqual(["thread-1"]);
    second();
    expect(registry.clientsFor({ subject: "alice" })[0]!.viewing).toEqual([]);
  });

  it("knows what a connection views before its first report, so a late first report is already correct", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    connection.observeViewing("thread-1");
    expect(registry.clientsFor({ subject: "alice" })).toEqual([]);
    report(connection, CLIENT_A, 1);
    expect(registry.clientsFor({ subject: "alice" })[0]!.viewing).toEqual(["thread-1"]);
  });
});

describe("two principals never see each other's clients", () => {
  it("answers a principal's read with its own clients only, and an id of another principal's client as absent", () => {
    const registry = registryOf();
    const a = registry.openConnection(ALICE);
    const b = registry.openConnection(BOB);
    report(a, CLIENT_A, 1, mounted("shell", "composer"));
    report(b, CLIENT_B, 1, mounted("shell"));
    expect(registry.clientsFor({ subject: "alice" }).map((c) => c.clientId)).toEqual([CLIENT_A]);
    expect(registry.clientsFor({ subject: "bob" }).map((c) => c.clientId)).toEqual([CLIENT_B]);
    expect(registry.clientOf({ subject: "bob" }, CLIENT_A)).toBeUndefined();
    expect(registry.clientOf({ subject: "alice" }, CLIENT_A)?.clientId).toBe(CLIENT_A);
    expect(registry.clientsFor({ subject: "carol" })).toEqual([]);
  });

  it("filters by the viewed thread, so two principals viewing different roots are told apart", () => {
    const registry = registryOf();
    const a = registry.openConnection(ALICE);
    const b = registry.openConnection(BOB);
    report(a, CLIENT_A, 1);
    report(b, CLIENT_B, 1);
    a.observeViewing("thread-a");
    b.observeViewing("thread-b");
    expect(registry.clientsFor({ subject: "alice" }, { viewingThreadId: "thread-a" })).toHaveLength(
      1,
    );
    expect(registry.clientsFor({ subject: "alice" }, { viewingThreadId: "thread-b" })).toEqual([]);
    expect(registry.clientsFor({ subject: "bob" }, { viewingThreadId: "thread-a" })).toEqual([]);
  });

  it("lists every client of one principal, each with its device, so a second tab or device is explicit and never picked for the caller", () => {
    const registry = registryOf();
    const first = registry.openConnection(ALICE);
    const phone = registry.openConnection(ALICE_PHONE);
    report(first, CLIENT_A, 1);
    report(phone, "client-alice-phone-0001", 1);
    const clients = registry.clientsFor({ subject: "alice" });
    expect(clients.map((c) => c.principal.deviceSessionId).toSorted()).toEqual([
      "dev-a1",
      "dev-a2",
    ]);
  });

  it("delivers a subscription's events for its own principal only", () => {
    const registry = registryOf();
    const seenByAlice: RegionEvent[] = [];
    const seenByBob: RegionEvent[] = [];
    registry.subscribe({ subject: "alice" }, (event) => seenByAlice.push(event));
    registry.subscribe({ subject: "bob" }, (event) => seenByBob.push(event));
    const a = registry.openConnection(ALICE);
    report(a, CLIENT_A, 1, mounted("shell"));
    a.observeViewing("thread-1");
    a.close();
    expect(seenByAlice.map((e) => e.type)).toEqual([
      "client-changed",
      "client-changed",
      "client-removed",
    ]);
    expect(seenByAlice.every((e) => e.clientId === CLIENT_A)).toBe(true);
    expect(seenByBob).toEqual([]);
  });

  it("isolates a throwing subscriber and an unsubscribed one", () => {
    const registry = registryOf();
    const kept: RegionEvent[] = [];
    registry.subscribe({ subject: "alice" }, () => {
      throw new Error("boom");
    });
    const stop = registry.subscribe({ subject: "alice" }, (event) => kept.push(event));
    const a = registry.openConnection(ALICE);
    report(a, CLIENT_A, 1);
    expect(kept).toHaveLength(1);
    stop();
    report(a, CLIENT_A, 2);
    expect(kept).toHaveLength(1);
  });
});

describe("a forged or foreign client id is refused", () => {
  it("refuses another principal's client id and leaves that client unchanged", () => {
    const registry = registryOf();
    report(registry.openConnection(ALICE), CLIENT_A, 1, mounted("shell"));
    const intruder = registry.openConnection(BOB);
    expect(report(intruder, CLIENT_A, 99, mounted("evil"))).toMatchObject({
      ok: false,
      code: "REGIONS_CLIENT_CONFLICT",
    });
    expect(registry.clientsFor({ subject: "bob" })).toEqual([]);
    expect(
      registry.clientOf({ subject: "alice" }, CLIENT_A)?.regions.map((r) => r.descriptor.id),
    ).toEqual(["shell"]);
  });

  it("refuses a second client id on a connection that already reports one", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    report(connection, CLIENT_A, 1);
    expect(report(connection, "client-alice-other-01", 2)).toMatchObject({
      ok: false,
      code: "REGIONS_CLIENT_CONFLICT",
    });
    expect(registry.clientsFor({ subject: "alice" }).map((c) => c.clientId)).toEqual([CLIENT_A]);
  });

  it("lets the same device session take its client id over on a new connection (a reconnect), still refusing a sequence that does not rise", () => {
    const registry = registryOf();
    const old = registry.openConnection(ALICE);
    report(old, CLIENT_A, 5, mounted("shell"));
    const fresh = registry.openConnection(ALICE);
    expect(report(fresh, CLIENT_A, 5, mounted("composer"))).toMatchObject({
      ok: false,
      code: "REGIONS_STALE",
    });
    expect(report(fresh, CLIENT_A, 6, mounted("composer"))).toMatchObject({ ok: true });
    expect(registry.clientsFor({ subject: "alice" })).toHaveLength(1);
    expect(
      registry.clientsFor({ subject: "alice" })[0]!.regions.map((r) => r.descriptor.id),
    ).toEqual(["composer"]);
    // The old connection no longer owns a client, and closing it removes nothing of the new one.
    expect(old.readOwn()).toMatchObject({ ok: true, value: undefined });
    old.close();
    expect(registry.clientsFor({ subject: "alice" })).toHaveLength(1);
  });

  it("does not let a different device of the same subject take a client id over", () => {
    const registry = registryOf();
    report(registry.openConnection(ALICE), CLIENT_A, 1);
    expect(report(registry.openConnection(ALICE_PHONE), CLIENT_A, 2)).toMatchObject({
      ok: false,
      code: "REGIONS_CLIENT_CONFLICT",
    });
  });
});

describe("the report is a whole replacement with a rising sequence", () => {
  it("replaces the set: a region left out is unmounted, a flipped flag is applied", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    report(connection, CLIENT_A, 1, mounted("shell", "composer"));
    report(connection, CLIENT_A, 2, [{ descriptor: descriptor("shell"), visible: false }]);
    const client = registry.clientOf({ subject: "alice" }, CLIENT_A)!;
    expect(client.sequence).toBe(2);
    expect(client.regions.map((r) => [r.descriptor.id, r.visible])).toEqual([["shell", false]]);
  });

  it("refuses a sequence that does not rise and changes nothing", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    report(connection, CLIENT_A, 3, mounted("shell"));
    for (const sequence of [3, 2, 1])
      expect(report(connection, CLIENT_A, sequence, mounted("evil"))).toMatchObject({
        ok: false,
        code: "REGIONS_STALE",
      });
    const client = registry.clientOf({ subject: "alice" }, CLIENT_A)!;
    expect(client.sequence).toBe(3);
    expect(client.regions.map((r) => r.descriptor.id)).toEqual(["shell"]);
  });

  it("answers the confirmed record, and says when it changed", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    clock = 5_000;
    const reply = report(connection, CLIENT_A, 1, mounted("shell"));
    expect(reply).toMatchObject({
      ok: true,
      value: { clientId: CLIENT_A, sequence: 1, updatedAtMs: 5_000 },
    });
  });

  it("refuses a descriptor of a schema version it does not speak, changing nothing", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    report(connection, CLIENT_A, 1, mounted("shell"));
    expect(
      report(connection, CLIENT_A, 2, [
        { descriptor: descriptor("future", { schemaVersion: 2 }), visible: true },
      ]),
    ).toMatchObject({ ok: false, code: "REGIONS_SCHEMA_UNSUPPORTED" });
    expect(registry.clientOf({ subject: "alice" }, CLIENT_A)!.sequence).toBe(1);
  });

  it("refuses a duplicate region id in one report, whatever the contract's own decode did", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    expect(report(connection, CLIENT_A, 1, mounted("shell", "shell"))).toMatchObject({
      ok: false,
      code: "REGIONS_INVALID_REPORT",
    });
  });
});

describe("what is stored is declared data only", () => {
  it("keeps the descriptor's declared keys and drops any other, so a smuggled value or secret is never held", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    const smuggled = {
      ...descriptor("shell"),
      secret: "SEEDED-SECRET-1",
      state: [{ name: "phase", type: "string", report: "value", value: "SEEDED-SECRET-2" }],
    };
    report(connection, CLIENT_A, 1, [{ descriptor: smuggled as never, visible: true }]);
    const text = JSON.stringify(registry.clientsFor({ subject: "alice" }));
    expect(text).not.toContain("SEEDED-SECRET");
    expect(text).not.toContain("secret");
  });

  it("returns plain data copies: changing one never changes the store", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    report(connection, CLIENT_A, 1, mounted("shell"));
    const copy = registry.clientsFor({ subject: "alice" })[0]!;
    expect(() => structuredClone(copy)).not.toThrow();
    (copy.regions as Array<unknown>).length = 0;
    (copy.viewing as Array<string>).push("x");
    const again = registry.clientsFor({ subject: "alice" })[0]!;
    expect(again.regions).toHaveLength(1);
    expect(again.viewing).toEqual([]);
  });

  it("makes no request while storing, reading, subscribing, closing or draining", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    registry.subscribe({ subject: "alice" }, () => {});
    report(connection, CLIENT_A, 1, mounted("shell"));
    connection.observeViewing("thread-1");
    registry.clientsFor({ subject: "alice" });
    connection.close();
    registry.drain();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("bounds refuse before anything is stored", () => {
  it("refuses more regions than the cap, and a body over the byte cap", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    const many = Array.from({ length: REGIONS_MAX_REGIONS + 1 }, (_, i) => `r${i}`);
    expect(report(connection, CLIENT_A, 1, mounted(...many))).toMatchObject({
      ok: false,
      code: "REGIONS_TOO_LARGE",
    });
    const fat = descriptor("shell", { description: "x".repeat(200) });
    const big = Array.from({ length: 60 }, (_, i) => ({
      descriptor: {
        ...fat,
        id: `big${i}`,
        props: Array.from({ length: 32 }, (_, j) => ({
          name: `p${j}`,
          type: "string" as const,
          report: "shape" as const,
        })),
      },
      visible: true,
    }));
    expect(JSON.stringify(big).length).toBeGreaterThan(REGIONS_MAX_BODY_BYTES);
    expect(report(connection, CLIENT_A, 1, big)).toMatchObject({
      ok: false,
      code: "REGIONS_TOO_LARGE",
    });
    expect(registry.clientsFor({ subject: "alice" })).toEqual([]);
    expect(
      report(connection, CLIENT_A, 1, mounted(...many.slice(0, REGIONS_MAX_REGIONS))),
    ).toMatchObject({
      ok: true,
    });
  });

  it("refuses a ninth client of one principal, and a client over the total, without touching the others", () => {
    const registry = registryOf();
    for (let i = 0; i < REGIONS_MAX_CLIENTS_PER_PRINCIPAL; i += 1)
      expect(
        report(
          registry.openConnection(ALICE_PHONE),
          `client-alice-${String(i).padStart(8, "0")}`,
          1,
        ),
      ).toMatchObject({ ok: true });
    expect(
      report(registry.openConnection(ALICE_PHONE), "client-alice-extra-0001", 1),
    ).toMatchObject({
      ok: false,
      code: "REGIONS_TOO_LARGE",
    });
    expect(registry.clientsFor({ subject: "alice" })).toHaveLength(
      REGIONS_MAX_CLIENTS_PER_PRINCIPAL,
    );
    expect(report(registry.openConnection(BOB), CLIENT_B, 1)).toMatchObject({ ok: true });

    const wide = registryOf();
    for (let i = 0; i < REGIONS_MAX_CLIENTS; i += 1)
      expect(
        report(
          wide.openConnection({ subject: `user-${i}`, deviceSessionId: `dev-${i}` }),
          `client-${String(i).padStart(10, "0")}`,
          1,
        ),
      ).toMatchObject({ ok: true });
    expect(report(wide.openConnection(BOB), "client-one-too-many-01", 1)).toMatchObject({
      ok: false,
      code: "REGIONS_TOO_LARGE",
    });
  });

  it("stops recording viewed threads past the cap, so a flood of subscriptions grows nothing", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    report(connection, CLIENT_A, 1);
    for (let i = 0; i < REGIONS_MAX_VIEWING + 10; i += 1) connection.observeViewing(`thread-${i}`);
    expect(registry.clientsFor({ subject: "alice" })[0]!.viewing).toHaveLength(REGIONS_MAX_VIEWING);
  });

  it("limits calls per connection to a burst, earns them back by the second, and limits no other connection", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    const other = registry.openConnection(BOB);
    for (let i = 1; i <= REGIONS_RATE_BURST; i += 1)
      expect(report(connection, CLIENT_A, i)).toMatchObject({ ok: true });
    expect(report(connection, CLIENT_A, REGIONS_RATE_BURST + 1)).toMatchObject({
      ok: false,
      code: "REGIONS_RATE_LIMITED",
    });
    expect(connection.readOwn()).toMatchObject({ ok: false, code: "REGIONS_RATE_LIMITED" });
    expect(report(other, CLIENT_B, 1)).toMatchObject({ ok: true });
    clock += 1_000;
    for (let i = 0; i < REGIONS_RATE_PER_SECOND; i += 1)
      expect(report(connection, CLIENT_A, REGIONS_RATE_BURST + 1 + i)).toMatchObject({ ok: true });
    expect(report(connection, CLIENT_A, REGIONS_RATE_BURST + 100)).toMatchObject({
      ok: false,
      code: "REGIONS_RATE_LIMITED",
    });
  });

  it("changes nothing stored when a call is refused for its rate", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    for (let i = 1; i <= REGIONS_RATE_BURST; i += 1)
      report(connection, CLIENT_A, i, mounted("shell"));
    const before = JSON.stringify(registry.clientsFor({ subject: "alice" }));
    report(connection, CLIENT_A, 99, mounted("evil"));
    expect(JSON.stringify(registry.clientsFor({ subject: "alice" }))).toBe(before);
  });
});

describe("disposal on unmount, disconnect and drain", () => {
  it("removes the client when its connection closes, and refuses the closed connection afterwards", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    report(connection, CLIENT_A, 1, mounted("shell"));
    connection.observeViewing("thread-1");
    connection.close();
    expect(registry.clientsFor({ subject: "alice" })).toEqual([]);
    expect(registry.stats()).toEqual({ connections: 0, clients: 0 });
    expect(report(connection, CLIENT_A, 2)).toMatchObject({
      ok: false,
      code: "REGIONS_UNAVAILABLE",
    });
    expect(connection.readOwn()).toMatchObject({ ok: false, code: "REGIONS_UNAVAILABLE" });
    expect(connection.observeViewing("thread-2")).toBeTypeOf("function");
    expect(registry.clientsFor({ subject: "alice" })).toEqual([]);
    connection.close();
  });

  it("drops an unmounted region with the next whole report, and leaves an empty client registered", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    report(connection, CLIENT_A, 1, mounted("shell"));
    report(connection, CLIENT_A, 2, []);
    expect(registry.clientOf({ subject: "alice" }, CLIENT_A)!.regions).toEqual([]);
  });

  it("drains every connection once, reports what it removed, and closes the registry to new work", () => {
    const registry = registryOf();
    const seen: RegionEvent[] = [];
    registry.subscribe({ subject: "alice" }, (event) => seen.push(event));
    const a = registry.openConnection(ALICE);
    const b = registry.openConnection(BOB);
    report(a, CLIENT_A, 1, mounted("shell", "composer"));
    report(b, CLIENT_B, 1, mounted("shell"));
    expect(registry.drain()).toEqual({ connections: 2, clients: 2, regions: 3, listeners: 1 });
    expect(registry.drain()).toEqual({ connections: 0, clients: 0, regions: 0, listeners: 0 });
    expect(registry.clientsFor({ subject: "alice" })).toEqual([]);
    expect(report(a, CLIENT_A, 2)).toMatchObject({ ok: false, code: "REGIONS_UNAVAILABLE" });
    const late = registry.openConnection(ALICE);
    expect(report(late, CLIENT_A, 1)).toMatchObject({ ok: false, code: "REGIONS_UNAVAILABLE" });
    expect(seen.at(-1)?.type).toBe("client-removed");
  });
});

describe("the server's one shared registry", () => {
  it("is one registry for every caller, drained with the Backend, and a fresh one serves the next Backend in the same process", () => {
    const first = getSharedRegionRegistry();
    expect(getSharedRegionRegistry()).toBe(first);
    report(first.openConnection(ALICE), CLIENT_A, 1, mounted("shell"));
    expect(drainSharedRegionRegistry()).toMatchObject({ connections: 1, clients: 1, regions: 1 });
    expect(first.clientsFor({ subject: "alice" })).toEqual([]);
    const next = getSharedRegionRegistry();
    expect(next).not.toBe(first);
    expect(report(next.openConnection(ALICE), CLIENT_A, 1)).toMatchObject({ ok: true });
    drainSharedRegionRegistry();
  });
});

describe("a connection reads only its own client", () => {
  it("returns the stored client, or a known none before the first report", () => {
    const registry = registryOf();
    const connection = registry.openConnection(ALICE);
    expect(connection.readOwn()).toMatchObject({ ok: true, value: undefined });
    report(connection, CLIENT_A, 1, mounted("shell"));
    expect(connection.readOwn()).toMatchObject({ ok: true, value: { clientId: CLIENT_A } });
    const bob = registry.openConnection(BOB);
    expect(bob.readOwn()).toMatchObject({ ok: true, value: undefined });
  });
});
