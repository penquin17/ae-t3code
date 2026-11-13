// Drift between the canonical refusal codes and the display table (D14). Pure: two inputs, no I/O. A code with no line, a line with no code, or a line with an empty language is drift.
import type { RefusalLocale } from "./describe";

export interface CanonicalVocabulary {
  readonly codes: ReadonlyArray<{ readonly code: string; readonly class: string }>;
}
export type DisplayLines = Readonly<Record<string, Readonly<Record<RefusalLocale, string>>>>;

export interface RefusalDrift {
  /** Canonical codes with no line at all, in canonical order. */
  readonly missing: string[];
  /** Codes with a line but no canonical entry, in the table's order. */
  readonly extra: string[];
  /** Codes whose line exists but is blank in a language, canonical order then locale order. */
  readonly missingLocale: Array<{ readonly code: string; readonly locale: RefusalLocale }>;
}

const LOCALES: readonly RefusalLocale[] = ["en", "zh"];

export function refusalDrift(canonical: CanonicalVocabulary, lines: DisplayLines): RefusalDrift {
  const known = new Set(canonical.codes.map((entry) => entry.code));
  const missing: string[] = [];
  const missingLocale: RefusalDrift["missingLocale"] = [];
  for (const { code } of canonical.codes) {
    const line = Object.hasOwn(lines, code) ? lines[code] : undefined;
    if (line === undefined) {
      missing.push(code);
      continue;
    }
    for (const locale of LOCALES) {
      if ((line[locale] ?? "").trim() === "") missingLocale.push({ code, locale });
    }
  }
  const extra = Object.keys(lines).filter((code) => !known.has(code));
  return { missing, extra, missingLocale };
}
