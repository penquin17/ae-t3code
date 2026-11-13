// The one Stop for the Aetheria web (R1, D4, D5, C3): the button, the `thread.stop` shortcut and the per-child control all end here, so no native cascading Stop is reachable from them.
//
// A root (or any non-subagent thread) is stopped by the Backend's tree Stop: one `aetheria.children.cancelTree` call. A subagent is stopped one child at a time: its mode is read from the
// Backend's list of the root, then a continuable child is interrupted and a one-shot child closed. Nothing is edited optimistically and nothing is sent twice: a second click, shortcut press
// or control on a Stop still in flight sends nothing; a lost reply is "unknown" and is not retried; the running indicator shows stopping and settled from the Backend's projection.
import type { EnvironmentId } from "@t3tools/contracts";
import { useRef, useState } from "react";

import { randomUUID } from "~/lib/utils";
import { toastManager } from "../../components/ui/toast";
import { useAtomCommand } from "../../state/use-atom-command";
import { gateOnConnection } from "../connection/gate";
import { aetheriaSendResult } from "../connection/sendResult";
import { createActionRunner, type ActionOutcome, type OutcomeStep } from "../core/outcome";
import type { OutcomeNotice } from "../sessions/outcomeText";
import { childStopSend } from "./childStop";
import { aetheriaChildren } from "./stopCommands";
import {
  stopNotice,
  stopOutcomeFromAccepted,
  stopSendResult,
  type CancelTreeValue,
  type StopReply,
} from "./stopReply";

export interface StopTarget {
  readonly environmentId: EnvironmentId;
  /** The thread the person is stopping. */
  readonly threadId: string;
  /** The root of its tree, as T3's lineage says. Used only for a subagent. */
  readonly rootThreadId: string;
  /** Whether T3's lineage says this thread is a subagent (a child to interrupt or close), not a root to stop. */
  readonly isSubagent: boolean;
}
export type StopResult =
  /** A Stop for this thread was already in flight: nothing was sent. */
  | { readonly sent: false }
  | {
      readonly sent: true;
      readonly outcome: ActionOutcome<unknown>;
      readonly notice: OutcomeNotice;
    };

export function useAetheriaStop() {
  const cancelTree = useAtomCommand(aetheriaChildren.cancelTree, { reportFailure: false });
  const list = useAtomCommand(aetheriaChildren.list, { reportFailure: false });
  const interrupt = useAtomCommand(aetheriaChildren.interrupt, { reportFailure: false });
  const close = useAtomCommand(aetheriaChildren.close, { reportFailure: false });
  const [runner] = useState(() => createActionRunner({ newRequestId: randomUUID }));
  const inFlight = useRef(new Set<string>());

  const treeStep = (target: StopTarget): OutcomeStep<CancelTreeValue> => ({
    label: "Stop",
    send: async () => {
      const sent = aetheriaSendResult(
        await cancelTree({
          environmentId: target.environmentId,
          input: { rootThreadId: target.threadId },
        }),
      );
      return sent.tag === "accepted"
        ? stopSendResult(sent.value as StopReply<CancelTreeValue>)
        : sent;
    },
  });

  const childStep = (target: StopTarget): OutcomeStep<unknown> => ({
    label: "Stop",
    send: () => {
      const input = { rootThreadId: target.rootThreadId, childThreadId: target.threadId };
      const { environmentId } = target;
      return childStopSend(
        {
          list: async () =>
            aetheriaSendResult(
              await list({ environmentId, input: { rootThreadId: target.rootThreadId } }),
            ),
          interrupt: async () => aetheriaSendResult(await interrupt({ environmentId, input })),
          close: async () => aetheriaSendResult(await close({ environmentId, input })),
        },
        { rootThreadId: target.rootThreadId, childThreadId: target.threadId },
      );
    },
  });

  const runStop = async (target: StopTarget, key: string): Promise<StopResult> => {
    // Sent only while the connection allows actions, judged when it is sent; a blocked Stop says nothing was sent and is not queued.
    const run = target.isSubagent
      ? await runner.run(key, gateOnConnection(childStep(target)))
      : await runner.run(key, gateOnConnection(treeStep(target)));
    const outcome = target.isSubagent
      ? run.outcome
      : stopOutcomeFromAccepted(run.outcome as ActionOutcome<CancelTreeValue>);
    const notice = stopNotice(outcome);
    if (notice.tone !== "ok") {
      toastManager.add({
        type: notice.tone === "warning" ? "warning" : "error",
        title: notice.text,
      });
    }
    return { sent: true, outcome, notice };
  };

  const stop = async (target: StopTarget): Promise<StopResult> => {
    const key = `${target.environmentId}:${target.threadId}`;
    if (inFlight.current.has(key)) return { sent: false };
    inFlight.current.add(key);
    // `.finally` rather than try/finally: React Compiler cannot compile a `try` without a `catch`.
    return runStop(target, key).finally(() => {
      inFlight.current.delete(key);
    });
  };

  return { stop };
}
