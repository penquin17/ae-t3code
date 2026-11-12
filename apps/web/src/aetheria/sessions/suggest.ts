import type { SessionId, SuggestionPair, SuggestionRow, SuggestionSource } from "./types";

// The suggestion rule: a pure, deterministic heuristic over one project's unpinned dormant rows.
// It names pairs of titles that look related and never joins them. It reads titles only.

/** Words that carry no topic; titles are lower-cased before the lookup. */
const SUGGESTION_STOP_WORDS: ReadonlySet<string> = new Set(
  (
    "the and for with from into onto about after before over under this that these those then than when what which while where who how why " +
    "are was were has have had not but all any can could should would will just also only very more most some such via per our your their its you they them " +
    "session sessions error errors fix fixes continue resume cycle cycles work test tests run check update request reply task new start started previous last"
  ).split(" "),
);

/** A pair needs at least this many shared words, and at least half of the shorter title's words. */
const MIN_SHARED = 2;
/** At most this many suggestions per call, which is per project. */
const MAX_PAIRS = 3;

/** The key of an unordered id pair. */
export function pairKey(a: SessionId, b: SessionId): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** Distinct topic words: lower-case, split on every non letter/digit/hyphen, at least three code points, not stop words. */
function wordsOf(title: string): ReadonlySet<string> {
  const words = new Set<string>();
  for (const word of title.toLowerCase().split(/[^\p{L}\p{N}-]+/u)) {
    if (Array.from(word).length >= 3 && !SUGGESTION_STOP_WORDS.has(word)) words.add(word);
  }
  return words;
}

interface Candidate {
  readonly a: SessionId;
  readonly b: SessionId;
  readonly shared: number;
  readonly newest: number;
}

/**
 * Suggested pairs among `rows`. Skipped: a row with itself, rows already joined (equal groupKey or
 * in `joined`), a pair in `dismissed`. Ranked by shared count, newer time, smaller id, larger id;
 * taken greedily so a row appears at most once; at most three pairs; the smaller id is `a`.
 */
export function suggestPairs(
  rows: readonly SuggestionRow[],
  joined: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
): SuggestionPair[] {
  const words = rows.map((row) => wordsOf(row.title));
  const candidates: Candidate[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const left = rows[i] as SuggestionRow;
    const leftWords = words[i] as ReadonlySet<string>;
    for (let j = i + 1; j < rows.length; j += 1) {
      const right = rows[j] as SuggestionRow;
      if (left.id === right.id || left.groupKey === right.groupKey) continue;
      const key = pairKey(left.id, right.id);
      if (joined.has(key) || dismissed.has(key)) continue;
      const rightWords = words[j] as ReadonlySet<string>;
      let shared = 0;
      for (const word of leftWords) if (rightWords.has(word)) shared += 1;
      if (shared < MIN_SHARED || shared * 2 < Math.min(leftWords.size, rightWords.size)) continue;
      const [a, b] = left.id < right.id ? [left.id, right.id] : [right.id, left.id];
      candidates.push({
        a: a as SessionId,
        b: b as SessionId,
        shared,
        newest: Math.max(left.updatedAt, right.updatedAt),
      });
    }
  }
  candidates.sort(
    (x, y) =>
      y.shared - x.shared ||
      y.newest - x.newest ||
      (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) ||
      (x.b < y.b ? -1 : x.b > y.b ? 1 : 0),
  );

  const taken = new Set<SessionId>();
  const pairs: SuggestionPair[] = [];
  for (const candidate of candidates) {
    if (pairs.length === MAX_PAIRS) break;
    if (taken.has(candidate.a) || taken.has(candidate.b)) continue;
    taken.add(candidate.a);
    taken.add(candidate.b);
    pairs.push({ a: candidate.a, b: candidate.b, shared: candidate.shared });
  }
  return pairs;
}

/** The model's suggestion seat over `suggestPairs`, binding the user's dismissed pairs. */
export function createSuggestionSource(
  dismissed: Iterable<{ readonly a: SessionId; readonly b: SessionId }>,
): SuggestionSource {
  const dismissedKeys: ReadonlySet<string> = new Set(
    [...dismissed].map((pair) => pairKey(pair.a, pair.b)),
  );
  const none: ReadonlySet<string> = new Set();
  return { suggestFor: (rows) => suggestPairs(rows, none, dismissedKeys) };
}
