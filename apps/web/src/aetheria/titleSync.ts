import { resolveTabTitle } from "./brand";

export interface TitleSources {
  /** The title of the thread the route has open, or null when none is. */
  readonly readOpenThreadTitle: () => string | null;
  /** Calls `notify` whenever the open thread or its title may have changed. */
  readonly subscribe: (notify: () => void) => () => void;
  readonly write: (title: string) => void;
}

/** Keeps the tab title equal to the open thread's title (or the default) until the returned stop is called. */
export function startTitleSync(sources: TitleSources): () => void {
  let written: string | null = null;
  const sync = () => {
    const next = resolveTabTitle(sources.readOpenThreadTitle());
    if (next === written) return;
    written = next;
    sources.write(next);
  };
  const stop = sources.subscribe(sync);
  sync();
  return stop;
}
