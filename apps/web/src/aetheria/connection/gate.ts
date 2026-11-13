// Gating actions on the connection (D4, D6). A step is sent only while the view allows actions, judged when the send happens, not when the control mounted.
// A blocked step is answered `unavailable` at once — it is not queued, so connecting later sends nothing; and the core's runner never re-sends, so an uncertain reply stays unknown across a reconnect.
import type { OutcomeStep } from "../core/outcome";
import { currentConnectionView } from "./current";
import type { ConnectionView } from "./state";

/** `view` answers null when no connection is observed: nothing then says the connection is down, so the step is sent and T3's own transport answers (a send it cannot make is a lost reply, never resent). */
export function gateStep<T>(
  view: () => ConnectionView | null,
  step: OutcomeStep<T>,
): OutcomeStep<T> {
  return {
    ...step,
    send: async (requestId) => {
      const current = view();
      if (current !== null && current.actions !== "allowed") {
        return {
          tag: "unavailable",
          reason: `Not connected (${current.kind}): nothing was sent, and it will not be sent later.`,
        };
      }
      return step.send(requestId);
    },
  };
}

/** The gate every mutating Aetheria action goes through: it reads the connection the mounted monitors publish, when the send happens. Reads are not gated (the design blocks actions, not reads). */
export function gateOnConnection<T>(step: OutcomeStep<T>): OutcomeStep<T> {
  return gateStep(currentConnectionView, step);
}
