// How one Backend reply is read by the supplied-control panels (M10 Plan step 18, D14, D4). A reply is the Backend's own `{ ok, value }` or `{ ok: false, code, detail? }`; a transport that never
// received one rejects, and the caller treats that as unknown, never as an empty success. The class of a failure comes from its code's suffix: `_UNAVAILABLE` (the Backend could not take the request),
// `_OUTCOME_UNKNOWN` (it may have landed), anything else a refusal that keeps its code and words. Plain TypeScript: no DOM, no T3 import.

export type Reply<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly detail?: string };

export type ReplyView =
  | { readonly tag: "ok"; readonly value: unknown }
  | { readonly tag: "unavailable"; readonly reason: string }
  | { readonly tag: "unknown"; readonly reason: string }
  | { readonly tag: "refused"; readonly code: string; readonly detail?: string };

/** The result of reading a supplied value strictly: it parses, or the reason it cannot be read. */
export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export type ReadView<T> =
  | { readonly tag: "reading" }
  | { readonly tag: "read"; readonly value: T }
  | { readonly tag: "unavailable"; readonly reason: string }
  | { readonly tag: "unknown"; readonly reason: string }
  | { readonly tag: "refused"; readonly code: string; readonly detail?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const NOT_A_REPLY = "the Backend's answer was not a reply this view can read";

export function classifyReply(reply: unknown): ReplyView {
  if (!isRecord(reply) || typeof reply.ok !== "boolean") {
    return { tag: "unknown", reason: NOT_A_REPLY };
  }
  if (reply.ok) return { tag: "ok", value: reply.value };
  if (typeof reply.code !== "string" || reply.code === "") {
    return { tag: "unknown", reason: NOT_A_REPLY };
  }
  const detail = typeof reply.detail === "string" ? reply.detail : undefined;
  if (reply.code.endsWith("_UNAVAILABLE")) {
    return { tag: "unavailable", reason: detail ?? "The Backend could not take the request." };
  }
  if (reply.code.endsWith("_OUTCOME_UNKNOWN")) {
    return { tag: "unknown", reason: detail ?? "The Backend did not say what happened." };
  }
  return detail === undefined
    ? { tag: "refused", code: reply.code }
    : { tag: "refused", code: reply.code, detail };
}

/** One reply as one view of a read. A value the parser cannot read is unknown with the parser's reason, never an empty read. */
export function readViewFromReply<T>(
  reply: unknown,
  parse: (value: unknown) => Parsed<T>,
): ReadView<T> {
  const classified = classifyReply(reply);
  if (classified.tag !== "ok") return classified;
  const parsed = parse(classified.value);
  return parsed.ok
    ? { tag: "read", value: parsed.value }
    : { tag: "unknown", reason: parsed.reason };
}
