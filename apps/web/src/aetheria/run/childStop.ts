// A per-child Stop (R1, D4): read the root's children for this child's mode, then interrupt a continuable child or close a one-shot child, once. Plain TypeScript over three injected
// calls, each already a settled `SendResult` of the Backend's reply, so the decision is tested without T3.
import type { SendResult } from "../core/outcome";
import { stopSendResult, type StopReply } from "./stopReply";

export interface ChildStopCalls {
  readonly list: () => Promise<SendResult<unknown>>;
  readonly interrupt: () => Promise<SendResult<unknown>>;
  readonly close: () => Promise<SendResult<unknown>>;
}
export interface ChildStopTarget {
  readonly rootThreadId: string;
  readonly childThreadId: string;
}
interface ListedRows {
  readonly rows: ReadonlyArray<{
    readonly childId: string;
    readonly mode: "one-shot" | "continuable";
  }>;
}

const asReply = <T>(sent: SendResult<unknown>): SendResult<StopReply<T>> =>
  sent as SendResult<StopReply<T>>;

export async function childStopSend(
  calls: ChildStopCalls,
  target: ChildStopTarget,
): Promise<SendResult<unknown>> {
  // The mode decides interrupt or close, so it is read first. A read that failed sent nothing, so it is unavailable, never unknown.
  const read = asReply<ListedRows>(await calls.list());
  const listed = read.tag === "accepted" ? stopSendResult(read.value) : read;
  if (listed.tag === "refused") return listed;
  if (listed.tag !== "accepted") {
    return {
      tag: "unavailable",
      reason: "The root's children could not be read, so nothing was sent.",
    };
  }
  const row = listed.value.rows.find((entry) => entry.childId === target.childThreadId);
  if (row === undefined) {
    return {
      tag: "refused",
      code: "CHILDREN_NOT_FOUND",
      message: "That child is not listed under its root, so nothing was sent.",
    };
  }
  const acted = asReply<unknown>(
    row.mode === "one-shot" ? await calls.close() : await calls.interrupt(),
  );
  return acted.tag === "accepted" ? stopSendResult(acted.value) : acted;
}
