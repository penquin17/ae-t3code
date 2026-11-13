// The connection as the action sites read it (review finding 2; D4, D6). `useConnectionView` is the one owner of what the connection is; each mounted monitor publishes its view here and withdraws it on unmount,
// so a Stop, an answer or a kill judges the connection when it sends, without mounting a second controller of its own. The monitors all read the same T3 state, so they agree; where one says actions are blocked
// the answer is blocked, because sending on a connection that a monitor says has ended is the harm, and a spare blocked answer is only a refused click.
// With no monitor mounted nothing is known, and the answer is null: the gate then lets the send through and T3's own transport answers.
import type { ConnectionView } from "./state";

const published = new Map<string, ConnectionView>();

export function publishConnectionView(monitorId: string, view: ConnectionView): void {
  published.set(monitorId, view);
}

export function withdrawConnectionView(monitorId: string): void {
  published.delete(monitorId);
}

/** The view a send is judged by: a blocked one when any monitor published one, else a monitor's allowed one, else null (nothing observed). */
export function currentConnectionView(): ConnectionView | null {
  let first: ConnectionView | null = null;
  for (const view of published.values()) {
    if (view.actions !== "allowed") return view;
    first ??= view;
  }
  return first;
}
