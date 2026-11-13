// Gating actions on the connection (D4, D6): a send is attempted only when the view allows it, is never queued for later, and is never re-sent after a reconnect.
// Boundary: the gate wraps the core's OutcomeStep; the real runner supplies the outcome semantics. A fake send counts calls — it shows the gate's behaviour, not a real RPC.
import { describe, expect, it } from "vite-plus/test";

import { createActionRunner, type OutcomeStep, type SendResult } from "../core/outcome";
import { applyBaseline, awaitingBaseline } from "../core/resync";
import { gateStep } from "./gate";
import {
  applyEvent,
  initialFacts,
  viewOf,
  type ConnectionEvent,
  type ConnectionFacts,
} from "./state";

const EXPECTED = `sha256:${"a".repeat(64)}`;
const open = {
  network: "online",
  phase: "connected",
  stage: null,
  attempt: 1,
  retryAt: null,
  blocked: null,
} as const;
const healthy = (generation: number): ConnectionEvent[] => [
  { type: "transport", generation, transport: open },
  { type: "ready", generation },
  { type: "projection", generation, projection: applyBaseline(awaitingBaseline<number>(), 1, 1) },
  {
    type: "composition",
    generation,
    result: { tag: "read", digest: EXPECTED, phase: "running", modules: [] },
  },
];

function harness() {
  let facts: ConnectionFacts = initialFacts({ tag: "present", value: EXPECTED });
  const calls: string[] = [];
  let reply: SendResult<string> = { tag: "accepted", value: "ok" };
  const step: OutcomeStep<string> = {
    label: "do it",
    send: async (id) => {
      calls.push(id);
      return reply;
    },
  };
  return {
    feed: (events: readonly ConnectionEvent[]) => {
      facts = events.reduce(applyEvent, facts);
    },
    calls,
    setReply: (r: SendResult<string>) => {
      reply = r;
    },
    gated: gateStep(() => viewOf(facts), step),
  };
}

describe("gateStep", () => {
  it("never calls the send while the connection is not connected, and says why", async () => {
    const h = harness();
    const runner = createActionRunner({ newRequestId: () => "r1" });
    const result = await runner.run("k", h.gated);
    expect(h.calls).toEqual([]);
    expect(result.outcome).toMatchObject({ kind: "unavailable" });
    expect((result.outcome as { reason: string }).reason).toMatch(/not connected|disconnected/i);
  });

  it("passes the send through once connected", async () => {
    const h = harness();
    h.feed(healthy(1));
    const result = await createActionRunner({ newRequestId: () => "r1" }).run("k", h.gated);
    expect(h.calls).toEqual(["r1"]);
    expect(result.outcome).toMatchObject({ kind: "confirmed", value: "ok" });
  });

  it("a blocked send is not queued: connecting later sends nothing by itself", async () => {
    const h = harness();
    await createActionRunner({ newRequestId: () => "r1" }).run("k", h.gated);
    h.feed(healthy(1));
    expect(h.calls).toEqual([]);
  });

  it("an uncertain reply stays unknown across a reconnect — the step is not re-sent", async () => {
    const h = harness();
    h.feed(healthy(1));
    h.setReply({ tag: "lost" });
    const result = await createActionRunner({ newRequestId: () => "r1" }).run("k", h.gated);
    expect(result.outcome).toMatchObject({ kind: "unknown" });
    h.feed([
      { type: "transport", generation: 1, transport: { ...open, phase: "backoff" } },
      ...healthy(2),
    ]);
    expect(h.calls).toEqual(["r1"]);
  });

  it("reads the view at send time, so access that ended after mounting blocks the send", async () => {
    const h = harness();
    h.feed(healthy(1));
    h.feed([{ type: "call-refused", generation: 1, code: "JOBS_DEVICE_REVOKED" }]);
    const result = await createActionRunner({ newRequestId: () => "r1" }).run("k", h.gated);
    expect(h.calls).toEqual([]);
    expect(result.outcome).toMatchObject({ kind: "unavailable" });
  });

  it("keeps the step's label and read-back seat", () => {
    const step: OutcomeStep<string> = {
      label: "x",
      send: async () => ({ tag: "lost" }),
      confirm: async () => ({ tag: "shows" }),
    };
    const gated = gateStep(() => viewOf(initialFacts({ tag: "present", value: EXPECTED })), step);
    expect(gated.label).toBe("x");
    expect(gated.confirm).toBeTypeOf("function");
  });
});
