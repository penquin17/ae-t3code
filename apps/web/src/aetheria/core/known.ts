// Known<T>: a backend fact is known, not yet read (unknown), or not supplied by this backend
// (unavailable). A view takes Known<T> for each backend fact, so an absent fact can never be
// shown as zero, idle or empty. Plain TypeScript: no DOM, no T3 import (D19).

export type Known<T> =
  | { readonly state: "known"; readonly value: T }
  | { readonly state: "unknown"; readonly reason: string }
  | { readonly state: "unavailable"; readonly reason: string };

export const known = <T>(value: T): Known<T> => ({ state: "known", value });
/** The fact exists but has not been read, or cannot be read right now. */
export const unknown = <T>(reason: string): Known<T> => ({ state: "unknown", reason });
/** This backend does not supply the fact at all. */
export const unavailable = <T>(reason: string): Known<T> => ({ state: "unavailable", reason });

export const isKnown = <T>(fact: Known<T>): fact is { state: "known"; value: T } =>
  fact.state === "known";

export function mapKnown<T, U>(fact: Known<T>, map: (value: T) => U): Known<U> {
  return fact.state === "known" ? known(map(fact.value)) : fact;
}

/** Text for a fact: the formatted value when known, otherwise a word that says it is not known and why. */
export function describeKnown<T>(fact: Known<T>, format: (value: T) => string): string {
  if (fact.state === "known") return format(fact.value);
  return fact.state === "unknown" ? `Unknown (${fact.reason})` : `Unavailable (${fact.reason})`;
}
