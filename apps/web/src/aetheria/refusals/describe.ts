// The one place that turns a refusal code into words (D14). A refusal is shown as the Backend sent it: its message is carried through verbatim and never rewritten; the display line only says in
// plain words what the code's class means. An unknown code is never hidden: its text is the Backend's, else the code itself. Plain TypeScript over data; no DOM, no T3.
import { CANONICAL_CODES, type CanonicalClass } from "./canonical";
import { LINES } from "./lines";

export type RefusalLocale = "en" | "zh";

export interface RefusalText {
  /** The display line for a known code, else the backend's own text, else the code itself. Never empty. */
  readonly text: string;
  /** False when the code has no display line, so `text` is the backend's text or the code. */
  readonly known: boolean;
  /** The Backend's message exactly as supplied, for the view to show beside `text`. Absent when none was supplied. */
  readonly backendMessage?: string;
}

const CLASS_OF = new Map<string, CanonicalClass>(CANONICAL_CODES.map((c) => [c.code, c.class]));

/** The canonical class of a code, or `undefined` for a code this table does not know (own properties only: `constructor` is not a code). */
export const classOf = (code: string): CanonicalClass | undefined => CLASS_OF.get(code);

export function describeRefusal(
  code: string,
  backendMessage?: string,
  locale: RefusalLocale = "en",
): RefusalText {
  const verbatim = backendMessage === undefined ? {} : { backendMessage };
  const line = Object.hasOwn(LINES, code) ? LINES[code] : undefined;
  if (line !== undefined) return { text: line[locale], known: true, ...verbatim };
  const own = backendMessage !== undefined && backendMessage.trim() !== "" ? backendMessage : code;
  return {
    text: own.trim() === "" ? "Refused (no code or message was supplied)." : own,
    known: false,
    ...verbatim,
  };
}
