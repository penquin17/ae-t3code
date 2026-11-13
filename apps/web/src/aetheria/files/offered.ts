// The offered edit paths as the Backend says them (M10 Plan step 16, D11/D12/R8, C5). Plain TypeScript over a supplied reply. The board's three answers — known (an empty list is a known empty), unknown
// (it holds no record for this root) and unavailable (it could not be read) — stay apart from each other and from a failed call. These are the files recorded as edited in the session, not per turn.
import { ClientOfferedPathsResult, type OfferedPath } from "@t3tools/aetheria-contracts";
import * as Schema from "effect/Schema";

import type { SendResult } from "../core/outcome";
import { failureFromBackend, failureFromSend, type FailureView } from "../deliverables/model";

export type OfferedView =
  | { readonly tag: "known"; readonly rootThreadId: string; readonly paths: readonly OfferedPath[] }
  | FailureView;

/** The words that sit over the list: what it is, and what it leaves out. */
export const OFFERED_LABEL = "Edited files: per session, not per turn; shell writes not tracked.";
/** Where turn changes live: T3's diff needs Git; outside Git this list is all there is. */
export const TURN_DIFF_NOTE =
  "Per-turn diffs are T3's own and exist only in a Git workspace; outside Git only this per-session list is shown.";

const decodeOffered = Schema.decodeUnknownSync(ClientOfferedPathsResult);

export function offeredViewFromSend(send: SendResult<unknown>, rootThreadId: string): OfferedView {
  if (send.tag !== "accepted") return failureFromSend(send, "edit record");
  let result: ClientOfferedPathsResult;
  try {
    result = decodeOffered(send.value);
  } catch {
    return { tag: "unknown", reason: "the Backend's answer was not an edit record" };
  }
  if (!result.ok) return failureFromBackend(result.code, result.detail);
  if (result.value.rootThreadId !== rootThreadId) {
    return { tag: "unknown", reason: "the Backend's answer was for another session" };
  }
  const { edits } = result.value;
  if (edits.status === "known") return { tag: "known", rootThreadId, paths: edits.paths };
  return edits.status === "unknown"
    ? { tag: "unknown", reason: "the board holds no edit record for this session" }
    : { tag: "unavailable", reason: "the board's edit record could not be read" };
}
