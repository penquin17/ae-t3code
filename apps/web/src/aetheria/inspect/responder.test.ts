// M11 step 21 (C6 U3, C4 K6): the real answer function and responder over the real region registry and a scripted transport — every declared region answers, values are live and descriptor-limited,
// only the correlated reply is sent, and a request after unmount or answered after a rebind sends nothing. Not shown: T3's stream, the Backend's second filter, a rendered page.
import { describe, expect, it, vi } from "vite-plus/test";

import type { InspectClientRequest, InspectReplyPayload } from "@t3tools/aetheria-contracts";

import { REGION_DECLARATIONS } from "../regions/declarations";
import { declareRegion } from "../regions/descriptor";
import { createRegionRegistry } from "../regions/registry";
import { answerRequest } from "./answer";
import { createResponder, type ResponderTransport } from "./responder";

const CLIENT = "client-0123456789abcdef";
const running = declareRegion({
  id: "conversation.running",
  kind: "region",
  owner: "aetheria-ui",
  parent: null,
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

const registryOf = (token = "#123456") => {
  let current = token;
  const registry = createRegionRegistry({
    clientId: CLIENT,
    now: () => 1_700_000_000_000,
    readToken: () => current,
  });
  return { registry, setToken: (value: string) => (current = value) };
};
const request = (
  regionId: string,
  extra: Partial<InspectClientRequest> = {},
): InspectClientRequest => ({
  requestId: "req-1",
  regionId,
  schemaVersion: 1,
  remainingMs: 10_000,
  ...extra,
});

describe("the answer for each region the build declares", () => {
  it("answers every declared region, mounted or not, without a value for the unmounted and without throwing", () => {
    const { registry } = registryOf();
    for (const declared of REGION_DECLARATIONS) {
      const reply = answerRequest(request(declared.id), {
        registry,
        declared: REGION_DECLARATIONS,
      });
      expect(reply).toMatchObject({
        requestId: "req-1",
        outcome: "ok",
        state: "inactive",
        values: {},
      });
      expect((reply as { shape: { id: string } }).shape.id).toBe(declared.id);
    }
    expect(REGION_DECLARATIONS.length).toBeGreaterThan(0);
  });

  it("a mounted region reports values only where its descriptor says value, with live tokens", () => {
    const { registry } = registryOf("#aa0000");
    registry.register(running, () => ({
      props: { threadKey: "t-secret", title: "Hello", extra: "undeclared" },
      state: { phase: "running", elapsedMs: 42, items: [1, 2], other: "undeclared" },
    }));
    const reply = answerRequest(request("conversation.running"), { registry, declared: [running] });
    expect(reply).toMatchObject({ outcome: "ok", state: "active" });
    const values = (reply as { values: Record<string, unknown> }).values;
    expect(values).toEqual({
      "props.title": "Hello",
      "state.phase": "running",
      "state.items": [1, 2],
      "tokens.--ae-color-accent": "#aa0000",
    });
    expect(JSON.stringify(reply)).not.toMatch(/t-secret|undeclared|"elapsedMs":42/);
  });

  it("reads the reporter and the token at each request, so a changed value is seen and nothing is cached", () => {
    const { registry, setToken } = registryOf("#111111");
    let phase = "idle";
    registry.register(running, () => ({ props: { title: "T" }, state: { phase, items: [] } }));
    const sources = { registry, declared: [running] };
    const first = answerRequest(request("conversation.running"), sources) as {
      values: Record<string, unknown>;
    };
    phase = "running";
    setToken("#222222");
    const second = answerRequest(
      request("conversation.running", { requestId: "req-2" }),
      sources,
    ) as {
      requestId: string;
      values: Record<string, unknown>;
    };
    expect(first.values["state.phase"]).toBe("idle");
    expect(second.values["state.phase"]).toBe("running");
    expect(second.values["tokens.--ae-color-accent"]).toBe("#222222");
    expect(second.requestId).toBe("req-2");
  });

  it("omits a non-plain or oversized value instead of sending it", () => {
    const { registry } = registryOf();
    registry.register(running, () => ({
      props: { title: () => "fn" as unknown as string },
      state: { phase: "x".repeat(20_000), items: [] },
    }));
    const reply = answerRequest(request("conversation.running"), { registry, declared: [running] });
    const values = (reply as { values: Record<string, unknown> }).values;
    expect(values).not.toHaveProperty("props.title");
    expect(values).not.toHaveProperty("state.phase");
    expect(values["state.items"]).toEqual([]);
  });

  it("answers region-not-found for an unknown region, schema-unsupported for another version, and unavailable when the reporter throws", () => {
    const { registry } = registryOf();
    registry.register(running, () => {
      throw new Error("boom");
    });
    const sources = { registry, declared: [running] };
    expect(answerRequest(request("nothing.here"), sources)).toEqual({
      requestId: "req-1",
      outcome: "region-not-found",
    });
    expect(answerRequest(request("conversation.running", { schemaVersion: 2 }), sources)).toEqual({
      requestId: "req-1",
      outcome: "schema-unsupported",
    });
    expect(answerRequest(request("conversation.running"), sources)).toEqual({
      requestId: "req-1",
      outcome: "unavailable",
    });
    const unmounted = registryOf().registry;
    expect(
      answerRequest(request("conversation.running", { schemaVersion: 2 }), {
        registry: unmounted,
        declared: [running],
      }),
    ).toEqual({
      requestId: "req-1",
      outcome: "schema-unsupported",
    });
  });
});

const transportOf = () => {
  const handlers: Array<(request: InspectClientRequest) => void> = [];
  const released: number[] = [];
  const replies: InspectReplyPayload[] = [];
  const transport: ResponderTransport = {
    subscribe: (onRequest) => {
      const index = handlers.push(onRequest) - 1;
      return () => void released.push(index);
    },
    reply: async (payload) => void replies.push(payload),
  };
  return { transport, handlers, released, replies };
};
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe("the responder's lifetime", () => {
  it("sends exactly the correlated reply for each request, and nothing unasked", async () => {
    const { registry } = registryOf();
    registry.register(running, () => ({ props: { title: "T" }, state: { phase: "p", items: [] } }));
    const { transport, handlers, replies } = transportOf();
    const responder = createResponder({ registry, declared: [running], transport });
    responder.start();
    expect(replies).toEqual([]);
    handlers[0]!(request("conversation.running", { requestId: "a" }));
    handlers[0]!(request("nothing.here", { requestId: "b" }));
    await flush();
    expect(replies.map((r) => [r.requestId, r.outcome])).toEqual([
      ["a", "ok"],
      ["b", "region-not-found"],
    ]);
  });

  it("a rebind releases the old stream and ignores what the old one still delivers", async () => {
    const { registry } = registryOf();
    const { transport, handlers, released, replies } = transportOf();
    const responder = createResponder({ registry, declared: REGION_DECLARATIONS, transport });
    responder.start();
    responder.rebind();
    expect(released).toEqual([0]);
    handlers[0]!(request("shell", { requestId: "late" })); // delivered by the old connection's stream
    handlers[1]!(request("shell", { requestId: "fresh" }));
    await flush();
    expect(replies.map((r) => r.requestId)).toEqual(["fresh"]);
  });

  it("unmount releases the stream and nothing is sent afterwards; a second stop and a start after stop are safe", async () => {
    const { registry } = registryOf();
    const { transport, handlers, released, replies } = transportOf();
    const responder = createResponder({ registry, declared: REGION_DECLARATIONS, transport });
    responder.start();
    responder.stop();
    responder.stop();
    responder.rebind(); // not running: does nothing
    expect(released).toEqual([0]);
    handlers[0]!(request("shell"));
    await flush();
    expect(replies).toEqual([]);
    expect(handlers).toHaveLength(1);
  });

  it("a reply that fails to send is dropped without retry and without throwing", async () => {
    const { registry } = registryOf();
    const handlers: Array<(r: InspectClientRequest) => void> = [];
    const reply = vi.fn(async () => {
      throw new Error("lost");
    });
    const responder = createResponder({
      registry,
      declared: REGION_DECLARATIONS,
      transport: { subscribe: (h) => (handlers.push(h), () => undefined), reply },
    });
    responder.start();
    handlers[0]!(request("shell"));
    await flush();
    expect(reply).toHaveBeenCalledTimes(1);
  });
});
