// The connection view the action sites gate on (review finding 2). Boundary: the module store that the mounted connection monitors publish into and `gateOnConnection` reads at send time.
// A fake step counts sends, so this shows what the gate lets through and what it stops; it does not show that a real hook publishes (the browser test of the monitor does).
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createActionRunner, type OutcomeStep } from "../core/outcome";
import { applyBaseline, awaitingBaseline } from "../core/resync";
import { currentConnectionView, publishConnectionView, withdrawConnectionView } from "./current";
import { gateOnConnection } from "./gate";
import { applyEvent, initialFacts, viewOf, type ConnectionEvent } from "./state";

const EXPECTED = `sha256:${"a".repeat(64)}`;
const open = {
  network: "online",
  phase: "connected",
  stage: null,
  attempt: 1,
  retryAt: null,
  blocked: null,
} as const;
const events = (generation: number): ConnectionEvent[] => [
  { type: "transport", generation, transport: open },
  { type: "ready", generation },
  { type: "projection", generation, projection: applyBaseline(awaitingBaseline<number>(), 1, 1) },
  {
    type: "composition",
    generation,
    result: { tag: "read", digest: EXPECTED, phase: "running", modules: [] },
  },
];
const base = initialFacts({ tag: "present", value: EXPECTED });
const connected = viewOf(events(1).reduce(applyEvent, base));
const ended = viewOf(
  [
    ...events(1),
    { type: "call-refused", generation: 1, code: "JOBS_DEVICE_REVOKED" } as const,
  ].reduce(applyEvent, base),
);
const disconnected = viewOf(base);

function counted() {
  const sent: string[] = [];
  const step: OutcomeStep<string> = {
    label: "Do it",
    send: async (id) => {
      sent.push(id);
      return { tag: "accepted", value: "ok" };
    },
  };
  return { sent, step };
}
const run = (step: OutcomeStep<string>) =>
  createActionRunner({ newRequestId: () => "r1" }).run("k", gateOnConnection(step));

afterEach(() => {
  for (const id of ["a", "b"]) withdrawConnectionView(id);
});

describe("the current connection view", () => {
  it("is unknown while no monitor is mounted", () => {
    expect(currentConnectionView()).toBeNull();
  });

  it("is what a mounted monitor published, and unknown again after it is withdrawn", () => {
    publishConnectionView("a", connected);
    expect(currentConnectionView()).toBe(connected);
    withdrawConnectionView("a");
    expect(currentConnectionView()).toBeNull();
  });

  it("is blocked when any mounted monitor says actions are blocked", () => {
    publishConnectionView("a", connected);
    publishConnectionView("b", ended);
    expect(currentConnectionView()).toBe(ended);
    publishConnectionView("b", connected);
    expect(currentConnectionView()?.actions).toBe("allowed");
  });
});

describe("gateOnConnection", () => {
  it("sends nothing while the connection is not connected, and says why in the gate's words", async () => {
    publishConnectionView("a", disconnected);
    const { sent, step } = counted();
    const result = await run(step);
    expect(sent).toEqual([]);
    expect(result.outcome).toMatchObject({ kind: "unavailable" });
    expect((result.outcome as { reason: string }).reason).toMatch(/nothing was sent/i);
  });

  it("sends nothing after access ended, even though the monitor saw a connected socket before", async () => {
    publishConnectionView("a", connected);
    publishConnectionView("a", ended);
    const { sent, step } = counted();
    expect((await run(step)).outcome).toMatchObject({ kind: "unavailable" });
    expect(sent).toEqual([]);
  });

  it("sends once when connected", async () => {
    publishConnectionView("a", connected);
    const { sent, step } = counted();
    expect((await run(step)).outcome).toMatchObject({ kind: "confirmed", value: "ok" });
    expect(sent).toEqual(["r1"]);
  });

  it("does not block when no monitor is mounted: the connection is then unobserved, not known to be down", async () => {
    const { sent, step } = counted();
    expect((await run(step)).outcome).toMatchObject({ kind: "confirmed" });
    expect(sent).toEqual(["r1"]);
  });

  it("reads the view when the send happens, not when the step was made", async () => {
    const { sent, step } = counted();
    const gated = gateOnConnection(step);
    publishConnectionView("a", disconnected);
    publishConnectionView("a", connected);
    const result = await createActionRunner({ newRequestId: () => "r1" }).run("k", gated);
    expect(result.outcome).toMatchObject({ kind: "confirmed" });
    expect(sent).toEqual(["r1"]);
  });
});
