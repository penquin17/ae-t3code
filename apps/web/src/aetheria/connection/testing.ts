// Connection views for the tests of the action sites that gate on the connection (`gateOnConnection`). Each is the real reducer's view for a sequence of events, not a hand-written literal, so a test shows what
// the gate does with the views the model can produce. Not imported by production code.
import { vi } from "vite-plus/test";

import { applyBaseline, awaitingBaseline } from "../core/resync";
import { publishConnectionView, withdrawConnectionView } from "./current";
import { applyEvent, initialFacts, viewOf, type ConnectionEvent } from "./state";

const DIGEST = `sha256:${"a".repeat(64)}`;

/** For a real-app test over a fake socket that should be connected: the build embeds this digest. Call once at the top of the file. */
export const stubBuildDigest = (): void => {
  vi.stubEnv("VITE_AETHERIA_BACKEND_DIGEST", DIGEST);
};

/** What the fake socket answers to `aetheria.composition.status` so the client sees a running Backend whose digest matches `stubBuildDigest`. */
export const COMPOSITION_STATUS_REPLY = {
  composition: "aetheria-backend",
  host: "backend",
  phase: "running",
  digest: { version: 1, algorithm: "sha256", value: DIGEST },
  artifact: { package: "backend-archive", version: "0.1.0", stamp: `sha256:${"b".repeat(64)}` },
  activationOrder: ["alpha"],
  modules: [{ id: "alpha", required: true, state: "running" }],
  disposal: null,
} as const;
const base = initialFacts({ tag: "present", value: DIGEST });
const healthy: readonly ConnectionEvent[] = [
  {
    type: "transport",
    generation: 1,
    transport: {
      network: "online",
      phase: "connected",
      stage: null,
      attempt: 1,
      retryAt: null,
      blocked: null,
    },
  },
  { type: "ready", generation: 1 },
  {
    type: "projection",
    generation: 1,
    projection: applyBaseline(awaitingBaseline<number>(), 1, 1),
  },
  {
    type: "composition",
    generation: 1,
    result: { tag: "read", digest: DIGEST, phase: "running", modules: [] },
  },
];

/** Connected: actions are allowed. */
export const connectedView = viewOf(healthy.reduce(applyEvent, base));
/** Nothing connected yet: actions are blocked. */
export const notConnectedView = viewOf(base);
/** A device refusal ended access while the socket stayed open: actions are blocked. */
export const accessEndedView = viewOf(
  [
    ...healthy,
    { type: "call-refused", generation: 1, code: "JOBS_DEVICE_REVOKED" } as const,
  ].reduce(applyEvent, base),
);

/** Makes `view` what the action sites see, as a mounted monitor would; returns the function that withdraws it. */
export function showConnection(view: typeof connectedView): () => void {
  publishConnectionView("test", view);
  return () => withdrawConnectionView("test");
}
