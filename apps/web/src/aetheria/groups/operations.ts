// The five request bodies, checked before anything is sent, and the rule for what a re-read must show.
// Limits copy DSH (docs/dsh/aetheria-ui.md "Host record and route"). The 8 KiB UTF-8 body cap is the
// carried limit (Plan reading b): a body over it is refused here, the cap is not raised, the 200-id bound
// not cut.

import { ID_MAX, NAME_MAX, type GroupRecord } from "./record";

export const MAX_BODY_BYTES = 8192;
const MAX_RENAME_MEMBERS = 200;

export type GroupBody =
  | { readonly op: "group" | "ungroup" | "dismiss"; readonly a: string; readonly b: string }
  | { readonly op: "detach"; readonly a: string }
  | { readonly op: "rename"; readonly members: readonly string[]; readonly name: string };

export type BuiltBody =
  | { readonly ok: true; readonly body: GroupBody; readonly bytes: number }
  | {
      readonly ok: false;
      readonly code: "GROUPS_INVALID_REQUEST" | "GROUPS_REQUEST_TOO_LARGE";
      readonly reason: string;
    };

const invalid = (reason: string): BuiltBody => ({
  ok: false,
  code: "GROUPS_INVALID_REQUEST",
  reason,
});

const validId = (id: string): boolean => id.length >= 1 && id.length <= ID_MAX;
const encoder = new TextEncoder();

function seal(body: GroupBody): BuiltBody {
  const bytes = encoder.encode(JSON.stringify(body)).length;
  if (bytes > MAX_BODY_BYTES) {
    return {
      ok: false,
      code: "GROUPS_REQUEST_TOO_LARGE",
      reason: `The request is ${bytes} bytes, over the ${MAX_BODY_BYTES}-byte limit for one change (up to ${MAX_RENAME_MEMBERS} sessions fit only when their ids are short). Nothing was sent.`,
    };
  }
  return { ok: true, body, bytes };
}

/** Group, ungroup or dismiss one unordered pair; the ids are sent with the smaller first. */
export function pairBody(op: "group" | "ungroup" | "dismiss", a: string, b: string): BuiltBody {
  if (!validId(a) || !validId(b)) return invalid(`Session ids must be 1 to ${ID_MAX} characters.`);
  if (a === b) return invalid("A pair needs two different sessions.");
  return seal(a < b ? { op, a, b } : { op, a: b, b: a });
}

/** Detach one session from every confirmed link; forks and dismissals stay. */
export function detachBody(a: string): BuiltBody {
  if (!validId(a)) return invalid(`Session ids must be 1 to ${ID_MAX} characters.`);
  return seal({ op: "detach", a });
}

/** Name the group whose full component is `members`; an empty (or blank) name clears the saved name. */
export function renameBody(members: readonly string[], name: string): BuiltBody {
  if (members.length > MAX_RENAME_MEMBERS) {
    return invalid(
      `A rename names at most ${MAX_RENAME_MEMBERS} sessions; this group has ${members.length}.`,
    );
  }
  if (!members.every(validId)) return invalid(`Session ids must be 1 to ${ID_MAX} characters.`);
  const unique = [...new Set(members)].toSorted((l, r) => (l < r ? -1 : l > r ? 1 : 0));
  if (unique.length < 2) return invalid("A group name needs at least two different sessions.");
  const trimmed = name.trim();
  if (trimmed.length > NAME_MAX) return invalid(`A group name is at most ${NAME_MAX} characters.`);
  return seal({ op: "rename", members: unique, name: trimmed });
}

const sameMembers = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index]);

/**
 * True when the record shows the effect the body asked for. A change the Backend reports as already in
 * place (a no-op) shows its effect too, so it is confirmed like any other.
 */
export function effectShown(body: GroupBody, record: GroupRecord): boolean {
  switch (body.op) {
    case "group":
      return record.links.some((link) => link.a === body.a && link.b === body.b);
    case "ungroup":
      return !record.links.some((link) => link.a === body.a && link.b === body.b);
    case "dismiss":
      return record.dismissed.some((pair) => pair.a === body.a && pair.b === body.b);
    case "detach":
      return !record.links.some((link) => link.a === body.a || link.b === body.a);
    case "rename": {
      const touching = record.names.filter((saved) =>
        saved.members.some((id) => body.members.includes(id)),
      );
      if (body.name === "") return touching.length === 0;
      return (
        touching.length === 1 &&
        sameMembers(touching[0]!.members, body.members) &&
        touching[0]!.name === body.name
      );
    }
  }
}
