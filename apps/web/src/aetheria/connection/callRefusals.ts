// A refusal code in an Aetheria reply reaches the connection (M10 step 20; D7): a revoked or expired device ends access while the socket stays open. Nothing is stored or replayed; no listener drops it.
// Call sites report every code through `reportRefusalIn`/`reportSendResult`; only the controller (`isDeviceEndedCode`) judges, so a denied target never ends access.
import type { SendResult } from "../core/outcome";

type Listener = (code: string) => void;

const listeners = new Set<Listener>();

export function reportCallRefusal(code: string): void {
  for (const listener of listeners) listener(code);
}

/** Reports the refusal code a Backend reply carries: `{ ok: false, code }` for an RPC reply, `{ tag: "refused", code }` for a refused download. Anything else carries no code and reports nothing. */
export function reportRefusalIn(reply: unknown): void {
  if (reply === null || typeof reply !== "object") return;
  const { ok, tag, code } = reply as { ok?: unknown; tag?: unknown; code?: unknown };
  if ((ok === false || tag === "refused") && typeof code === "string" && code !== "") {
    reportCallRefusal(code);
  }
}

/** Reports the refusal in an accepted result's reply, and returns the result itself. A lost, unavailable or T3-refused result carries no Backend code. */
export function reportSendResult<T>(sent: SendResult<T>): SendResult<T> {
  if (sent.tag === "accepted") reportRefusalIn(sent.value);
  return sent;
}

/** Returns the function that stops listening. */
export function subscribeCallRefusals(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
