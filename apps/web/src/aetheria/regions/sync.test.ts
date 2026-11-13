// AETHERIA M10 step 23 (D17, XC-19; D4): the client's report of what is mounted. It sends the WHOLE set with a rising sequence (a lost reply is repeated safely; the Backend refuses a stale one),
// one call at a time, never carrying a principal, a session or a value, and it never lets a reply to an abandoned call replace what a newer call settled.
import {
  AetheriaRpcGroup,
  AETHERIA_WS_METHODS,
  RegionsReportPayload,
} from "@t3tools/aetheria-contracts";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { declareRegion } from "./descriptor";
import { createRegionRegistry } from "./registry";
import { createRegionSync, type RegionsReply, type RegionsTransport } from "./sync";

const CLIENT = "client-0123456789abcdef";
const shell = declareRegion({
  id: "shell",
  kind: "screen",
  owner: "aetheria-ui",
  parent: null,
  description: "The app shell",
});
const panel = declareRegion({
  id: "panel.files",
  kind: "panel",
  owner: "aetheria-ui",
  parent: "shell",
  description: "The files panel",
});

const held = (sequence: number): RegionsReply => ({
  ok: true,
  value: { clientId: CLIENT, sequence, regions: [], viewing: [] },
});

// The options the server decodes a report with: the ones the Rpc carries.
const wireOptions = Context.get(
  AetheriaRpcGroup.requests.get(AETHERIA_WS_METHODS.regionsReport)!.annotations,
  Rpc.ParseOptions,
);
const decodeOnWire = Schema.decodeUnknownSync(RegionsReportPayload as never, wireOptions);

type Payload = Parameters<RegionsTransport["report"]>[0];

function setup(reply: (payload: Payload, call: number) => Promise<RegionsReply>) {
  const calls: Payload[] = [];
  const transport: RegionsTransport = {
    report: (payload) => {
      calls.push(structuredClone(payload));
      return reply(payload, calls.length);
    },
  };
  const registry = createRegionRegistry({
    clientId: CLIENT,
    now: () => 0,
    readToken: () => undefined,
  });
  const sync = createRegionSync({
    registry,
    transport,
    debounceMs: 50,
    replyTimeoutMs: 1000,
    retry: { baseMs: 100, maxMs: 400, maxAttempts: 3 },
  });
  return { calls, registry, sync };
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("what is sent", () => {
  it("announces the client with an empty set at start, then the whole set after a change", async () => {
    const { calls, registry, sync } = setup(async (_p, n) => held(n));
    sync.start();
    await tick(50);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ clientId: CLIENT, sequence: 1, regions: [] });
    registry.register(shell, () => ({ props: {}, state: {} }));
    registry.register(panel, () => ({ props: {}, state: {} }));
    await tick(50);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({
      clientId: CLIENT,
      sequence: 2,
      regions: [
        { descriptor: panel, visible: true },
        { descriptor: shell, visible: true },
      ],
    });
    sync.stop();
  });

  it("carries exactly a client id, a sequence and the regions: no principal, session, viewing or value", async () => {
    const { calls, registry, sync } = setup(async (_p, n) => held(n));
    registry.register(shell, () => ({ props: { token: "SECRET" }, state: {} }));
    sync.start();
    await tick(50);
    expect(Object.keys(calls[0]!).toSorted()).toEqual(["clientId", "regions", "sequence"]);
    expect(Object.keys(calls[0]!.regions[0]!).toSorted()).toEqual(["descriptor", "visible"]);
    expect(JSON.stringify(calls)).not.toContain("SECRET");
    sync.stop();
  });

  it("sends only keys the contract declares at every depth: each report decodes under the wire's own strict options", async () => {
    const { calls, registry, sync } = setup(async (_p, n) => held(n));
    registry.register(
      declareRegion({
        id: "composer",
        kind: "panel",
        owner: "aetheria-ui",
        parent: "shell",
        description: "The composer",
        props: [{ name: "draft", type: "string", report: "value" }],
        state: [{ name: "phase", type: "string" }],
        tokens: ["--ae-color-accent"],
      }),
      () => ({ props: { draft: "SECRET" }, state: { phase: "idle" } }),
    );
    registry.register(shell, () => ({ props: {}, state: {} }));
    sync.start();
    await tick(50);
    expect(wireOptions.onExcessProperty).toBe("error");
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(() => decodeOnWire(call)).not.toThrow();
    sync.stop();
  });

  it("sends a visibility change and an unmount as new whole sets", async () => {
    const { calls, registry, sync } = setup(async (_p, n) => held(n));
    const dispose = registry.register(shell, () => ({ props: {}, state: {} }));
    sync.start();
    await tick(50);
    registry.setVisible("shell", false);
    await tick(50);
    expect(calls[1]!.regions).toEqual([{ descriptor: shell, visible: false }]);
    dispose();
    await tick(50);
    expect(calls[2]).toEqual({ clientId: CLIENT, sequence: 3, regions: [] });
    sync.stop();
  });

  it("joins changes inside the quiet window into one call", async () => {
    const { calls, registry, sync } = setup(async (_p, n) => held(n));
    sync.start();
    await tick(50);
    registry.register(shell, () => ({ props: {}, state: {} }));
    await tick(20);
    registry.register(panel, () => ({ props: {}, state: {} }));
    registry.setVisible("panel.files", false);
    await tick(50);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.regions).toHaveLength(2);
    sync.stop();
  });

  it("keeps one call in flight, and follows a change made meanwhile with a newer sequence after the reply", async () => {
    let release: (() => void) | undefined;
    const { calls, registry, sync } = setup(
      (_p, n) =>
        new Promise((resolve) => {
          release = () => resolve(held(n));
        }),
    );
    sync.start();
    await tick(50);
    expect(calls).toHaveLength(1);
    registry.register(shell, () => ({ props: {}, state: {} }));
    await tick(200);
    expect(calls).toHaveLength(1);
    release?.();
    await tick(50);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.sequence).toBe(2);
    expect(sync.status()).toMatchObject({ state: "syncing" });
    release?.();
    await tick(0);
    expect(sync.status()).toEqual({ state: "idle", ackedSequence: 2 });
    sync.stop();
  });
});

describe("a reply that never came, and a late one", () => {
  it("abandons the call after the reply timeout and repeats the whole set with a newer sequence", async () => {
    const { calls, sync } = setup(async (_p, n) => (n === 1 ? new Promise(() => {}) : held(n)));
    sync.start();
    await tick(50);
    await tick(1000);
    await tick(100);
    expect(calls.map((c) => c.sequence)).toEqual([1, 2]);
    expect(sync.status()).toEqual({ state: "idle", ackedSequence: 2 });
    sync.stop();
  });

  it("does not let a late reply to an abandoned call replace what a newer call settled", async () => {
    let late: ((reply: RegionsReply) => void) | undefined;
    const { sync } = setup((_p, n) =>
      n === 1
        ? new Promise((resolve) => {
            late = resolve;
          })
        : Promise.resolve(held(n)),
    );
    sync.start();
    await tick(50);
    await tick(1100);
    expect(sync.status()).toEqual({ state: "idle", ackedSequence: 2 });
    late?.({ ok: false, code: "REGIONS_CLIENT_CONFLICT", detail: "late" });
    await tick(0);
    expect(sync.status()).toEqual({ state: "idle", ackedSequence: 2 });
    late?.(held(1));
    await tick(0);
    expect(sync.status().ackedSequence).toBe(2);
    sync.stop();
  });
});

describe("refusals and failures", () => {
  it("stops on a refusal retrying cannot change, and says which", async () => {
    for (const code of [
      "REGIONS_CLIENT_CONFLICT",
      "REGIONS_NOT_AUTHORIZED",
      "REGIONS_DEVICE_REVOKED",
      "REGIONS_SCHEMA_UNSUPPORTED",
      "REGIONS_TOO_LARGE",
      "REGIONS_INVALID_REPORT",
    ] as const) {
      const { calls, sync } = setup(async () => ({ ok: false, code, detail: "no" }));
      sync.start();
      await tick(50);
      await tick(5000);
      expect(calls).toHaveLength(1);
      expect(sync.status()).toMatchObject({ state: "refused", lastCode: code });
      sync.stop();
    }
  });

  it("repeats the whole set after a rate limit, a stale refusal, an unavailable Backend or a lost reply, with backoff and a bound", async () => {
    for (const code of ["REGIONS_RATE_LIMITED", "REGIONS_STALE", "REGIONS_UNAVAILABLE"] as const) {
      const { calls, sync } = setup(async () => ({ ok: false, code, detail: "later" }));
      sync.start();
      await tick(50);
      expect(calls).toHaveLength(1);
      await tick(99);
      expect(calls).toHaveLength(1);
      await tick(1);
      expect(calls).toHaveLength(2);
      await tick(200);
      expect(calls).toHaveLength(3);
      await tick(10_000);
      expect(calls).toHaveLength(3);
      expect(calls.map((c) => c.sequence)).toEqual([1, 2, 3]);
      expect(sync.status()).toMatchObject({ state: "failed", lastCode: code });
      sync.stop();
    }
    const { calls, sync } = setup(async () => {
      throw new Error("socket closed");
    });
    sync.start();
    await tick(50);
    await tick(10_000);
    expect(calls).toHaveLength(3);
    expect(sync.status()).toMatchObject({ state: "failed" });
    sync.stop();
  });

  it("tries again from the start when the page changes after a failure", async () => {
    let fail = true;
    const { calls, registry, sync } = setup(async (_p, n) =>
      fail ? { ok: false, code: "REGIONS_UNAVAILABLE" } : held(n),
    );
    sync.start();
    await tick(50);
    await tick(10_000);
    expect(sync.status().state).toBe("failed");
    fail = false;
    registry.register(shell, () => ({ props: {}, state: {} }));
    await tick(50);
    expect(sync.status()).toEqual({ state: "idle", ackedSequence: calls.length });
    sync.stop();
  });
});

describe("stopping", () => {
  it("sends nothing after stop, and does not call the Backend to unregister: the Backend drops the client when the connection closes", async () => {
    const { calls, registry, sync } = setup(async (_p, n) => held(n));
    sync.start();
    await tick(50);
    sync.stop();
    registry.register(shell, () => ({ props: {}, state: {} }));
    await tick(5000);
    expect(calls).toHaveLength(1);
  });
});

// A new connection to the Backend starts with no client of ours (the Backend drops the client when the old connection closes), and an unchanged page sends nothing by itself. `resend` is how the page
// says "the connection is new": one whole-set report, on the same client id with a sequence that still rises, so the Backend's same-device takeover of a client it has not dropped yet accepts it.
describe("a new connection", () => {
  it("sends the whole set once more, on the same client id with a rising sequence, though nothing on the page changed", async () => {
    const { calls, registry, sync } = setup(async (_p, n) => held(n));
    registry.register(shell, () => ({ props: {}, state: {} }));
    sync.start();
    await tick(50);
    expect(sync.status().state).toBe("idle");
    sync.resend();
    await tick(50);
    expect(calls.map((c) => [c.clientId, c.sequence])).toEqual([
      [CLIENT, 1],
      [CLIENT, 2],
    ]);
    expect(calls[1]!.regions).toEqual([{ descriptor: shell, visible: true }]);
    await tick(10_000);
    expect(calls).toHaveLength(2);
    expect(sync.status()).toEqual({ state: "idle", ackedSequence: 2 });
    sync.stop();
  });

  it("sends one report for several signals close together", async () => {
    const { calls, sync } = setup(async (_p, n) => held(n));
    sync.start();
    await tick(50);
    sync.resend();
    sync.resend();
    await tick(50);
    expect(calls.map((c) => c.sequence)).toEqual([1, 2]);
    sync.stop();
  });

  it("gives up on a call the old connection never answered, and a late reply to it changes nothing", async () => {
    const answers: Array<(reply: RegionsReply) => void> = [];
    const { calls, sync } = setup((_p, n) =>
      n === 1
        ? new Promise<RegionsReply>((resolve) => answers.push(resolve))
        : Promise.resolve(held(n)),
    );
    sync.start();
    await tick(50);
    expect(sync.status().state).toBe("syncing");
    sync.resend();
    await tick(50);
    expect(calls.map((c) => c.sequence)).toEqual([1, 2]);
    expect(sync.status()).toEqual({ state: "idle", ackedSequence: 2 });
    answers[0]!(held(1));
    await tick(0);
    expect(sync.status()).toEqual({ state: "idle", ackedSequence: 2 });
    sync.stop();
  });

  it("starts over after a failure or a refusal, since the new connection may be allowed what the old one was not", async () => {
    let refuse = true;
    const { calls, sync } = setup(async (_p, n) =>
      refuse ? { ok: false, code: "REGIONS_NOT_AUTHORIZED" } : held(n),
    );
    sync.start();
    await tick(50);
    expect(sync.status()).toMatchObject({ state: "refused", lastCode: "REGIONS_NOT_AUTHORIZED" });
    refuse = false;
    sync.resend();
    await tick(50);
    expect(calls.map((c) => c.sequence)).toEqual([1, 2]);
    expect(sync.status()).toEqual({ state: "idle", ackedSequence: 2 });
    sync.stop();
  });

  it("cuts a wait for a retry short: the new connection is tried now", async () => {
    let fail = true;
    const { calls, sync } = setup(async (_p, n) =>
      fail ? { ok: false, code: "REGIONS_UNAVAILABLE" } : held(n),
    );
    sync.start();
    await tick(50);
    expect(sync.status().state).toBe("waiting");
    fail = false;
    sync.resend();
    await tick(50);
    expect(calls.map((c) => c.sequence)).toEqual([1, 2]);
    expect(sync.status()).toEqual({ state: "idle", ackedSequence: 2 });
    sync.stop();
  });

  it("sends nothing before start or after stop", async () => {
    const { calls, sync } = setup(async (_p, n) => held(n));
    sync.resend();
    await tick(500);
    expect(calls).toHaveLength(0);
    sync.start();
    await tick(50);
    sync.stop();
    sync.resend();
    await tick(500);
    expect(calls).toHaveLength(1);
  });
});
