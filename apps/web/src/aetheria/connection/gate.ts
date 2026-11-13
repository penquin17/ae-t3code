// Gating actions on the connection (D4, D6). A step is sent only while the view allows actions, judged when the send happens, not when the control mounted.
// A blocked step is answered `unavailable` at once — it is not queued, so connecting later sends nothing; and the core's runner never re-sends, so an uncertain reply stays unknown across a reconnect.
import type { OutcomeStep } from "../core/outcome";
import type { ConnectionView } from "./state";

export function gateStep<T>(view: () => ConnectionView, step: OutcomeStep<T>): OutcomeStep<T> {
  return {
    ...step,
    send: async (requestId) => {
      const current = view();
      if (current.actions !== "allowed") {
        return {
          tag: "unavailable",
          reason: `Not connected (${current.kind}): nothing was sent, and it will not be sent later.`,
        };
      }
      return step.send(requestId);
    },
  };
}
