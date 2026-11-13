// The single owner of the last answer for one root (M10 Plan step 16): a reply lands only through `finishRead`, so a stale reply or another root's reply never shows. Generic over the view a
// list builds, so the cards and the offered paths share one rule. Plain TypeScript: no DOM, no T3.

export interface ReadState<V> {
  readonly rootThreadId: string;
  readonly ticket: number;
  readonly refreshing: boolean;
  /** `reading` is only the time before the first answer for this root. */
  readonly view: { readonly tag: "reading" } | V;
}

export const initialReadState = <V>(rootThreadId: string): ReadState<V> => ({
  rootThreadId,
  ticket: 0,
  refreshing: false,
  view: { tag: "reading" },
});

/** A new read of `rootThreadId`. Another root starts from `reading`; the same root keeps its last answer on screen until the new one lands. */
export function startRead<V>(
  state: ReadState<V>,
  rootThreadId: string,
): { readonly state: ReadState<V>; readonly ticket: number } {
  const ticket = state.ticket + 1;
  const view = state.rootThreadId === rootThreadId ? state.view : { tag: "reading" as const };
  return { state: { rootThreadId, ticket, refreshing: true, view }, ticket };
}

/** A reply for an older read, or for another root, says nothing about the present: it changes nothing. */
export function finishRead<V>(
  state: ReadState<V>,
  ticket: number,
  rootThreadId: string,
  view: V,
): ReadState<V> {
  if (ticket !== state.ticket || rootThreadId !== state.rootThreadId) return state;
  return { ...state, refreshing: false, view };
}
