// A Backend reply to a group read or change becomes one honest result. Refusals the Backend made before acting
// carry its own message; "not connected" is unavailable; any other code or a malformed reply is a lost reply,
// never resent (D4). The refusal codes are this client's reading of DSH's route statuses; phase 2b replaces
// them with the contract's own.
import type { SendResult } from "../core/outcome";
import { readGroupRecord, type GroupRecord } from "./record";
import { GROUPS_UNAVAILABLE, GROUPS_UNAVAILABLE_REASON } from "./transport";

const PRE_ACTION_REFUSALS: ReadonlySet<string> = new Set([
  "GROUPS_INVALID_REQUEST",
  "GROUPS_REQUEST_TOO_LARGE",
  "GROUPS_NOT_AUTHORIZED",
  "GROUPS_DEVICE_REVOKED",
  "GROUPS_SESSION_NOT_FOUND",
  "GROUPS_STORE_UNUSABLE",
]);

const isReply = (value: unknown): value is { ok: boolean; [key: string]: unknown } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { ok?: unknown }).ok === "boolean";

const detailOf = (reply: { [key: string]: unknown }): string | undefined =>
  typeof reply.detail === "string" ? reply.detail : undefined;

export function changeSendResult(reply: unknown): SendResult<GroupRecord> {
  if (!isReply(reply)) return { tag: "lost" };
  if (reply.ok) {
    const read = readGroupRecord(reply.value);
    return read.ok ? { tag: "accepted", value: read.record } : { tag: "lost" };
  }
  const code = typeof reply.code === "string" ? reply.code : "";
  if (code === GROUPS_UNAVAILABLE) {
    return { tag: "unavailable", reason: detailOf(reply) ?? GROUPS_UNAVAILABLE_REASON };
  }
  if (PRE_ACTION_REFUSALS.has(code)) {
    return {
      tag: "refused",
      code,
      message: detailOf(reply) ?? `The Backend refused the change (${code}).`,
    };
  }
  return { tag: "lost" };
}

export type ReadResult =
  | { readonly tag: "record"; readonly record: GroupRecord }
  | { readonly tag: "unavailable"; readonly code: string; readonly reason: string }
  | { readonly tag: "unsupported"; readonly reason: string }
  | { readonly tag: "failed"; readonly code: string; readonly reason: string };

export function readResult(reply: unknown): ReadResult {
  if (!isReply(reply)) {
    return {
      tag: "failed",
      code: "GROUPS_READ_FAILED",
      reason: "The Backend's reply was not understood.",
    };
  }
  if (reply.ok) {
    const read = readGroupRecord(reply.value);
    return read.ok
      ? { tag: "record", record: read.record }
      : {
          tag: "unsupported",
          reason: `The saved groups are in a form this client does not read (${read.reason}).`,
        };
  }
  const code = typeof reply.code === "string" ? reply.code : "GROUPS_READ_FAILED";
  if (code === GROUPS_UNAVAILABLE) {
    return { tag: "unavailable", code, reason: detailOf(reply) ?? GROUPS_UNAVAILABLE_REASON };
  }
  return {
    tag: "failed",
    code,
    reason: detailOf(reply) ?? `The Backend could not read the saved groups (${code}).`,
  };
}
