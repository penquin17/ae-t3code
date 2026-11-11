export const AETHERIA_NAME = "Aetheria";
export const AETHERIA_SLOGAN = "Knowledge comes together";

// oxlint-disable-next-line t3code/no-em-dash-copy -- the accepted tab titles are "Aetheria — Knowledge comes together" and "<thread> — Aetheria" (M10a, D21).
const DASH = "\u2014";

/** The tab title when no thread is open. */
export const DEFAULT_TAB_TITLE = `${AETHERIA_NAME} ${DASH} ${AETHERIA_SLOGAN}`;

/** The tab title for the thread's own title, or the default one when there is none. */
export function resolveTabTitle(openThreadTitle: string | null): string {
  const title = openThreadTitle?.trim();
  return title ? `${title} ${DASH} ${AETHERIA_NAME}` : DEFAULT_TAB_TITLE;
}
