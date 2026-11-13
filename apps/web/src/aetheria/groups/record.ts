// The Backend's group record as this client reads it: a strict copy of DSH's version-2 shape
// (dsh/packages/aetheria-ui/src/host/groups-types.ts, docs/dsh/aetheria-ui.md "Host record"). Plain
// TypeScript, no T3 import. A record that is malformed or not version 2 is refused as `unsupported`;
// it is never repaired, and never read as empty. Empty is a record the Backend sent empty.

import type { GroupName } from "../sessions/types";

export type { GroupName };

export const ID_MAX = 512;
export const NAME_MAX = 80;

export interface GroupedLink {
  readonly a: string;
  readonly b: string;
  readonly kind: "grouped";
  readonly at: number;
}
export interface DismissedPair {
  readonly a: string;
  readonly b: string;
  readonly at: number;
}
export interface GroupRecord {
  readonly version: 2;
  readonly links: readonly GroupedLink[];
  readonly dismissed: readonly DismissedPair[];
  readonly names: readonly GroupName[];
}

export type RecordRead =
  | { readonly ok: true; readonly record: GroupRecord }
  | { readonly ok: false; readonly code: "unsupported"; readonly reason: string };

class Unsupported extends Error {}
const refuse = (reason: string): never => {
  throw new Unsupported(reason);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function exactKeys(value: Record<string, unknown>, keys: readonly string[], what: string): void {
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((key) => own.includes(key))) {
    refuse(`${what} must have exactly the keys ${keys.join(", ")}`);
  }
}

function validId(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > ID_MAX) {
    return refuse(`${what} must be a string of 1 to ${ID_MAX} characters`);
  }
  return value;
}

function finiteTime(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return refuse(`${what} must be a finite number`);
  }
  return value;
}

const pairKeyOf = (a: string, b: string): string => JSON.stringify([a, b]);

function readPairs<T extends { a: string; b: string }>(
  value: unknown,
  what: string,
  keys: readonly string[],
  build: (entry: Record<string, unknown>, a: string, b: string) => T,
): T[] {
  if (!Array.isArray(value)) return refuse(`${what} must be an array`);
  const seen = new Set<string>();
  return value.map((entry): T => {
    if (!isObject(entry)) return refuse(`${what} entries must be objects`);
    exactKeys(entry, keys, `a ${what} entry`);
    const a = validId(entry.a, `${what} a`);
    const b = validId(entry.b, `${what} b`);
    if (!(a < b)) refuse(`${what} entries must have a < b`);
    const key = pairKeyOf(a, b);
    if (seen.has(key)) refuse(`${what} must not repeat a pair`);
    seen.add(key);
    return build(entry, a, b);
  });
}

function readNames(value: unknown): GroupName[] {
  if (!Array.isArray(value)) return refuse("names must be an array");
  const seen = new Set<string>();
  return value.map((entry): GroupName => {
    if (!isObject(entry)) return refuse("names entries must be objects");
    exactKeys(entry, ["members", "name", "at"], "a name entry");
    const members = entry.members;
    if (!Array.isArray(members) || members.length < 2) {
      return refuse("a name needs at least two members");
    }
    const ids = members.map((member) => validId(member, "a name member"));
    for (let i = 1; i < ids.length; i += 1) {
      if (!((ids[i - 1] as string) < (ids[i] as string))) {
        refuse("name members must be strictly increasing and unique");
      }
    }
    const name = entry.name;
    if (typeof name !== "string" || name === "" || name !== name.trim() || name.length > NAME_MAX) {
      return refuse(`a name must be trimmed text of 1 to ${NAME_MAX} characters`);
    }
    const key = JSON.stringify(ids);
    if (seen.has(key)) refuse("two names must not share one member list");
    seen.add(key);
    return { members: ids, name, at: finiteTime(entry.at, "a name time") };
  });
}

/** Reads the Backend's value strictly. Anything but a valid version-2 record is `unsupported`. */
export function readGroupRecord(raw: unknown): RecordRead {
  try {
    if (!isObject(raw)) return refuse("the record is not an object");
    if (raw.version !== 2)
      return refuse(`the record version is ${JSON.stringify(raw.version)}, not 2`);
    exactKeys(raw, ["version", "links", "dismissed", "names"], "the record");
    const links = readPairs(raw.links, "links", ["a", "b", "kind", "at"], (entry, a, b) => {
      if (entry.kind !== "grouped") refuse('a link kind must be "grouped"');
      return { a, b, kind: "grouped" as const, at: finiteTime(entry.at, "a link time") };
    });
    const dismissed = readPairs(raw.dismissed, "dismissed", ["a", "b", "at"], (entry, a, b) => ({
      a,
      b,
      at: finiteTime(entry.at, "a dismissal time"),
    }));
    return { ok: true, record: { version: 2, links, dismissed, names: readNames(raw.names) } };
  } catch (error) {
    if (error instanceof Unsupported)
      return { ok: false, code: "unsupported", reason: error.message };
    throw error;
  }
}
