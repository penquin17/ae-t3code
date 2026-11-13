// One honest class per action reply (D4, D14, A2): accepted (confirmed only by a re-read), a coded refusal with the Backend's words and record kept verbatim, or unknown.
// Unknown is EVERY INTERACTION_UNAVAILABLE whatever its free text says, an unknown code, a non-reply, and a lost reply: never resent, and the view re-reads.
import type { SendResult } from "../core/outcome";
import type { InteractionRecord, TransportResult } from "./types";

export type ReplyClass =
  | "accepted"
  | "refused"
  | "stale-revision"
  | "already-settled"
  | "delivery-failed"
  | "unknown";

export interface ClassifiedReply<V> {
  readonly class: ReplyClass;
  readonly value?: V;
  readonly code?: string;
  /** The Backend's own words, exactly as supplied. Absent when it supplied none. */
  readonly detail?: string;
  /** The record the Backend supplied with an already-settled or delivery-failed reply. */
  readonly record?: InteractionRecord;
  /** Whether the view should re-read the snapshot because of this reply. */
  readonly reread: boolean;
}

const KNOWN_REFUSALS = new Set([
  "INTERACTION_NOT_FOUND",
  "INTERACTION_ORIGIN_NOT_HUMAN",
  "INTERACTION_ANSWER_INVALID",
  "INTERACTION_GRANT_INVALID",
]);
/** A refusal the Backend made before touching any record: nothing about the view can have changed. */
const NO_REREAD = new Set([
  "INTERACTION_ORIGIN_NOT_HUMAN",
  "INTERACTION_ANSWER_INVALID",
  "INTERACTION_GRANT_INVALID",
]);

const unknownReply = <V>(detail?: string): ClassifiedReply<V> => ({
  class: "unknown",
  ...(detail === undefined ? {} : { detail }),
  reread: true,
});

const isRecord = (value: unknown): value is InteractionRecord =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as { interactionId?: unknown }).interactionId === "string";

export function classifyTransport<V>(result: TransportResult): ClassifiedReply<V> {
  if (result.tag === "lost") return unknownReply();
  if (result.tag === "failed") {
    return { class: "refused", code: "COMMAND_FAILED", detail: result.message, reread: false };
  }
  const reply = result.reply as {
    ok?: unknown;
    value?: V;
    code?: unknown;
    detail?: unknown;
    record?: unknown;
  } | null;
  // A value that is not a reply says nothing about what happened.
  if (reply === null || typeof reply !== "object" || typeof reply.ok !== "boolean") {
    return unknownReply();
  }
  if (reply.ok) {
    return "value" in reply && reply.value !== undefined
      ? { class: "accepted", value: reply.value, reread: true }
      : unknownReply();
  }
  if (typeof reply.code !== "string") return unknownReply();
  const detail = typeof reply.detail === "string" ? reply.detail : undefined;
  const record = isRecord(reply.record) ? reply.record : undefined;
  const carried = {
    code: reply.code,
    ...(detail === undefined ? {} : { detail }),
    ...(record === undefined ? {} : { record }),
  };
  switch (reply.code) {
    case "INTERACTION_UNAVAILABLE":
      return unknownReply(detail);
    case "INTERACTION_STALE_REVISION":
      return { class: "stale-revision", ...carried, reread: true };
    case "INTERACTION_ALREADY_SETTLED":
      return { class: "already-settled", ...carried, reread: true };
    case "INTERACTION_DELIVERY_FAILED":
      return { class: "delivery-failed", ...carried, reread: true };
    default:
      return KNOWN_REFUSALS.has(reply.code)
        ? { class: "refused", ...carried, reread: !NO_REREAD.has(reply.code) }
        : unknownReply(detail);
  }
}

/** The runner's view of a classified reply. A refusal's message is the Backend's own words ("" when it gave none): the view pairs it with `describeRefusal`, never with invented text. */
export function sendResultOf<V>(reply: ClassifiedReply<V>): SendResult<V> {
  switch (reply.class) {
    case "accepted":
      return { tag: "accepted", value: reply.value as V };
    case "unknown":
      return { tag: "lost" };
    default:
      return { tag: "refused", code: reply.code ?? "REFUSED", message: reply.detail ?? "" };
  }
}
