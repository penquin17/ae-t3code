// AETHERIA M10 step 23 (D17, XC-19; Plan: U3/K6): the registry's boundary. Regions register with a pure in-memory reporter and a disposer; a query answers from the declared descriptor — a value
// only where the descriptor says `value`, the shape otherwise, and every missing, unsupported or unavailable answer explicit. Nothing here makes a request or calls an action.
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { declareRegion } from "./descriptor";
import { createRegionRegistry, type RegionRegistry } from "./registry";

const CLIENT = "client-0123456789abcdef";
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);

const running = declareRegion({
  id: "conversation.running",
  kind: "region",
  owner: "aetheria-ui",
  parent: "shell",
  description: "The running state of the open conversation",
  props: [
    { name: "threadKey", type: "string" },
    { name: "title", type: "string", report: "value" },
  ],
  state: [
    { name: "phase", type: "string", report: "value" },
    { name: "elapsedMs", type: "number" },
    { name: "items", type: "array", report: "value" },
  ],
  tokens: ["--ae-color-accent"],
});
const shell = declareRegion({
  id: "shell",
  kind: "screen",
  owner: "aetheria-ui",
  parent: null,
  description: "The app shell",
});

const make = (readToken: (name: string) => string | undefined = () => "#123456") =>
  createRegionRegistry({ clientId: CLIENT, now: () => NOW, readToken });

const reporter =
  (props: object = {}, state: object = {}) =>
  () => ({ props, state });

afterEach(() => vi.restoreAllMocks());

describe("registration and disposal", () => {
  it("lists a registered region as mounted and visible, and removes it when its disposer runs", () => {
    const registry = make();
    const dispose = registry.register(shell, reporter());
    expect(registry.snapshot()).toEqual({
      clientId: CLIENT,
      regions: [{ descriptor: shell, visible: true }],
    });
    dispose();
    expect(registry.snapshot().regions).toEqual([]);
    dispose();
    expect(registry.snapshot().regions).toEqual([]);
  });

  it("lists regions in id order, so one set always reads the same way", () => {
    const registry = make();
    registry.register(running, reporter());
    registry.register(shell, reporter());
    expect(registry.snapshot().regions.map((entry) => entry.descriptor.id)).toEqual([
      "conversation.running",
      "shell",
    ]);
  });

  it("lets a second registration of an id replace the first, and an old disposer never removes the replacement", () => {
    const registry = make();
    const first = registry.register(shell, reporter({}, { a: 1 }));
    const second = registry.register(shell, reporter());
    expect(registry.snapshot().regions).toHaveLength(1);
    first();
    expect(registry.snapshot().regions).toHaveLength(1);
    second();
    expect(registry.snapshot().regions).toHaveLength(0);
  });

  it("tracks visibility by id and ignores an id that is not mounted", () => {
    const registry = make();
    registry.register(shell, reporter());
    registry.setVisible("shell", false);
    expect(registry.snapshot().regions[0]?.visible).toBe(false);
    registry.setVisible("not.mounted", true);
    expect(registry.snapshot().regions).toHaveLength(1);
  });

  it("tells subscribers once per change that matters, and stops when they unsubscribe", () => {
    const registry = make();
    const seen = vi.fn();
    const stop = registry.subscribe(seen);
    const dispose = registry.register(shell, reporter());
    registry.setVisible("shell", false);
    registry.setVisible("shell", false);
    dispose();
    expect(seen).toHaveBeenCalledTimes(3);
    stop();
    registry.register(shell, reporter());
    expect(seen).toHaveBeenCalledTimes(3);
  });

  it("empties on disposal of the whole registry and refuses to hold anything afterwards", () => {
    const registry = make();
    registry.register(shell, reporter());
    registry.register(running, reporter());
    registry.dispose();
    expect(registry.snapshot().regions).toEqual([]);
    const late = registry.register(shell, reporter());
    expect(registry.snapshot().regions).toEqual([]);
    late();
  });
});

const ask = (registry: RegionRegistry, id = "conversation.running", version?: number) =>
  registry.query(id, version === undefined ? undefined : { schemaVersion: version });

describe("a query's answer", () => {
  it("names the client, region, schema version and capture time, and reads the reporter once, at the query", () => {
    const registry = make();
    const report = vi.fn(() => ({ props: { threadKey: "t" }, state: { phase: "gather" } }));
    registry.register(running, report);
    expect(report).not.toHaveBeenCalled();
    const reply = ask(registry);
    expect(report).toHaveBeenCalledTimes(1);
    expect(reply).toMatchObject({
      ok: true,
      clientId: CLIENT,
      regionId: "conversation.running",
      schemaVersion: 1,
      capturedAt: new Date(NOW).toISOString(),
    });
  });

  it("reports a value only where the descriptor says value, and the shape of every other field", () => {
    const registry = make();
    registry.register(
      running,
      reporter(
        { threadKey: "secret-thread-key", title: "A title" },
        { phase: "gather", elapsedMs: 7_777_777, items: [1, 2] },
      ),
    );
    const reply = ask(registry);
    expect(reply.ok && reply.props).toEqual([
      { name: "threadKey", status: "shape", type: "string" },
      { name: "title", status: "value", value: "A title" },
    ]);
    expect(reply.ok && reply.state).toEqual([
      { name: "phase", status: "value", value: "gather" },
      { name: "elapsedMs", status: "shape", type: "number" },
      { name: "items", status: "value", value: [1, 2] },
    ]);
    expect(JSON.stringify(reply)).not.toContain("secret-thread-key");
    expect(JSON.stringify(reply)).not.toContain("7777777");
  });

  it("never returns a prop or state the descriptor did not declare, however the reporter names it", () => {
    const registry = make();
    registry.register(
      running,
      reporter({ apiKey: "SEEDED-SECRET-1", threadKey: "t" }, { password: "SEEDED-SECRET-2" }),
    );
    const text = JSON.stringify(ask(registry));
    expect(text).not.toContain("SEEDED-SECRET");
    expect(text).not.toContain("apiKey");
    expect(text).not.toContain("password");
  });

  it("says a declared field is omitted, with the reason, when the reporter gave nothing for it", () => {
    const registry = make();
    registry.register(running, reporter({}, {}));
    const reply = ask(registry);
    expect(reply.ok && reply.props).toEqual([
      { name: "threadKey", status: "omitted", reason: "not-reported" },
      { name: "title", status: "omitted", reason: "not-reported" },
    ]);
  });

  it("omits a value that is not plain data or is too large, instead of passing it on", () => {
    const registry = make();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    registry.register(
      running,
      reporter({ title: () => "a function" }, { phase: "x".repeat(100_000), items: [cyclic] }),
    );
    const reply = ask(registry);
    expect(reply.ok && reply.props.find((p) => p.name === "title")).toEqual({
      name: "title",
      status: "omitted",
      reason: "not-plain-data",
    });
    expect(reply.ok && reply.state.find((p) => p.name === "phase")).toEqual({
      name: "phase",
      status: "omitted",
      reason: "too-large",
    });
    expect(reply.ok && reply.state.find((p) => p.name === "items")).toEqual({
      name: "items",
      status: "omitted",
      reason: "not-plain-data",
    });
  });

  it("returns a copy: changing the reporter's data afterwards does not change an answer already given", () => {
    const registry = make();
    const items = [1, 2];
    registry.register(running, reporter({}, { items }));
    const reply = ask(registry);
    items.push(3);
    expect(reply.ok && reply.state.find((s) => s.name === "items")).toEqual({
      name: "items",
      status: "value",
      value: [1, 2],
    });
  });

  it("reads each declared token's live value at the query and nowhere earlier", () => {
    const readToken = vi.fn((name: string) => (name === "--ae-color-accent" ? " #0a84ff " : ""));
    const registry = make(readToken);
    registry.register(running, reporter());
    registry.snapshot();
    expect(readToken).not.toHaveBeenCalled();
    const reply = ask(registry);
    expect(readToken).toHaveBeenCalledTimes(1);
    expect(reply.ok && reply.tokens).toEqual([
      { name: "--ae-color-accent", status: "value", value: "#0a84ff" },
    ]);
  });

  it("says a token is unavailable when the page resolves it to nothing", () => {
    const registry = make(() => "");
    registry.register(running, reporter());
    const reply = ask(registry);
    expect(reply.ok && reply.tokens).toEqual([
      { name: "--ae-color-accent", status: "omitted", reason: "unavailable" },
    ]);
  });
});

describe("the three named failures", () => {
  it("answers region-not-found, with the client and the capture time, for an id that is not mounted", () => {
    const registry = make();
    expect(ask(registry, "no.such")).toEqual({
      ok: false,
      outcome: "region-not-found",
      clientId: CLIENT,
      regionId: "no.such",
      capturedAt: new Date(NOW).toISOString(),
    });
  });

  it("answers region-not-found again once the region unmounted", () => {
    const registry = make();
    const dispose = registry.register(running, reporter());
    expect(ask(registry).ok).toBe(true);
    dispose();
    expect(ask(registry)).toMatchObject({ ok: false, outcome: "region-not-found" });
  });

  it("answers schema-unsupported for a version the descriptor does not carry, naming what it does", () => {
    const registry = make();
    registry.register(running, reporter());
    expect(ask(registry, "conversation.running", 2)).toMatchObject({
      ok: false,
      outcome: "schema-unsupported",
      regionId: "conversation.running",
      supportedSchemaVersion: 1,
    });
    expect(ask(registry, "conversation.running", 1).ok).toBe(true);
  });

  it("answers unavailable when the reporter throws, and says nothing of what it held", () => {
    const registry = make();
    registry.register(running, () => {
      throw new Error("boom: token abc123");
    });
    const reply = ask(registry);
    expect(reply).toMatchObject({
      ok: false,
      outcome: "unavailable",
      regionId: "conversation.running",
    });
    expect(JSON.stringify(reply)).not.toContain("abc123");
  });

  it("answers unavailable when the reporter returns something that is not props and state", () => {
    const registry = make();
    registry.register(running, (() => "nope") as never);
    expect(ask(registry)).toMatchObject({ ok: false, outcome: "unavailable" });
  });
});

describe("a reporter performs no request and calls no action", () => {
  it("makes none through registration, snapshot, visibility, query or disposal", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const socket = vi.fn();
    vi.stubGlobal("WebSocket", socket);
    const registry = make();
    const dispose = registry.register(running, reporter({ title: "t" }, { phase: "p" }));
    registry.setVisible("conversation.running", false);
    registry.snapshot();
    ask(registry);
    dispose();
    registry.dispose();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
