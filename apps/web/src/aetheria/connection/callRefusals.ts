// Where an Aetheria call that the Backend refused for the device (`<METHOD>_DEVICE_REVOKED`) says so (M10 step 20; D7): a revoked, missing or expired device ends access even while the socket stays open.
// A call site reports the refusal code it received; the connection controller decides whether it ends access (only a device-ended code does). Nothing is stored or replayed: a report reaches the listeners
// subscribed now, and one with no listener is dropped.
type Listener = (code: string) => void;

const listeners = new Set<Listener>();

export function reportCallRefusal(code: string): void {
  for (const listener of listeners) listener(code);
}

/** Returns the function that stops listening. */
export function subscribeCallRefusals(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
