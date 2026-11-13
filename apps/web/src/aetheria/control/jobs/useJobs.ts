// The jobs panel's behaviour (M10 Plan step 18, D4, XC-15/16): one owner for the last job list and outbox read of a root, a Kill that is sent once with an honest outcome, and output read by explicit
// offset. Nothing is edited optimistically, a lost reply is `unknown` and is never resent, a stale reply lands nowhere, leaving the page kills nothing, and no call here acknowledges a notice.
import { useEffect, useRef, useState } from "react";

import { randomUUID } from "~/lib/utils";
import { gateOnConnection } from "../../connection/gate";
import { createActionRunner, type ActionOutcome, type SendResult } from "../../core/outcome";
import {
  applyOutput,
  initialOutput,
  killConfirm,
  killSendFromReply,
  offsetsOf,
  parseJobList,
  parseOutbox,
  type KillValue,
  type OutputState,
} from "./model";
import { classifyReply, type ReplyView } from "./reply";
import type { JobsTransport } from "./transport";
import { useSuppliedRead } from "./useSuppliedRead";

export interface KillNoticeState {
  readonly rootThreadId: string;
  readonly jobId: string;
  readonly label: string;
  readonly outcome: ActionOutcome<KillValue>;
}

export function useJobs(input: {
  readonly environmentId: string;
  readonly rootThreadId: string;
  readonly transport: JobsTransport;
}) {
  const { environmentId, rootThreadId, transport } = input;
  const target = { environmentId, rootThreadId };
  const resetKey = `${environmentId}\u0000${rootThreadId}`;
  const list = useSuppliedRead({
    environmentId,
    resetKey,
    read: () => transport.list(target),
    parse: parseJobList,
  });
  const outbox = useSuppliedRead({
    environmentId,
    resetKey,
    read: () => transport.outbox(target),
    parse: parseOutbox,
  });
  const root = useRef(rootThreadId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest root for a Kill that settles after the page moved to another root
  useEffect(() => {
    root.current = rootThreadId;
  }, [rootThreadId]);
  const [notice, setNotice] = useState<KillNoticeState | null>(null);
  const [killing, setKilling] = useState<ReadonlySet<string>>(new Set());
  const [runner] = useState(() => createActionRunner({ newRequestId: randomUUID }));
  const inFlight = useRef(new Set<string>());

  /** One Kill: sent once. The list is then re-read, which is a read and never a resend; a lost reply is never sent again. */
  async function kill(row: { readonly jobId: string; readonly label: string }): Promise<void> {
    const forRoot = rootThreadId;
    const key = `${environmentId}\u0000${forRoot}\u0000${row.jobId}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setKilling(new Set(inFlight.current));
    // `.finally` rather than try/finally: React Compiler cannot compile a `try` without a `catch`.
    await runKill(forRoot, key, row).finally(() => {
      inFlight.current.delete(key);
      setKilling(new Set(inFlight.current));
    });
  }

  async function runKill(
    forRoot: string,
    key: string,
    row: { readonly jobId: string; readonly label: string },
  ): Promise<void> {
    // Sent only while the connection allows actions, judged when it is sent; a blocked kill is never queued.
    const run = await runner.run<KillValue>(
      key,
      gateOnConnection<KillValue>({
        label: "Kill",
        send: async (): Promise<SendResult<KillValue>> => {
          try {
            return killSendFromReply(
              await transport.kill({ environmentId, rootThreadId: forRoot, jobId: row.jobId }),
            );
          } catch {
            // A call that threw never told us what the Backend did: it is a lost reply, not a refusal.
            return { tag: "lost" };
          }
        },
        confirm: async (accepted) => killConfirm(await list.refresh(), accepted.jobId),
      }),
    );
    if (run.outcome.kind === "unknown") void list.refresh();
    // The page may have moved to another root while the Kill was away: its notice belongs to the root it was sent for.
    if (root.current !== forRoot || !run.current) return;
    setNotice({
      rootThreadId: forRoot,
      jobId: row.jobId,
      label: row.label,
      outcome: run.outcome,
    });
  }

  const visibleNotice = notice !== null && notice.rootThreadId === rootThreadId ? notice : null;
  return {
    list,
    outbox,
    notice: visibleNotice,
    kill: (row: { readonly jobId: string; readonly label: string }) => void kill(row),
    isKilling: (jobId: string) =>
      killing.has(`${environmentId}\u0000${rootThreadId}\u0000${jobId}`),
  };
}

/** What stopped an output read, as the Backend said it. Shown beside any text already read. */
export type OutputProblem = Exclude<ReplyView, { readonly tag: "ok" }>;

export interface OutputHold {
  readonly output: OutputState;
  readonly problem: OutputProblem | null;
  readonly reading: boolean;
}

/** Output of one job, read by explicit offset: each read asks for the end of what is shown and nothing is assumed about a cursor. One read at a time. */
export function useJobOutput(input: {
  readonly environmentId: string;
  readonly rootThreadId: string;
  readonly jobId: string;
  readonly transport: JobsTransport;
}) {
  const { environmentId, rootThreadId, jobId, transport } = input;
  const current = useRef<OutputState>(initialOutput(jobId));
  const reading = useRef(false);
  const [hold, setHold] = useState<OutputHold>(() => ({
    output: initialOutput(jobId),
    problem: null,
    reading: false,
  }));

  async function read(): Promise<void> {
    if (reading.current) return;
    reading.current = true;
    const before = current.current;
    const offsets = offsetsOf(before);
    setHold({ output: before, problem: null, reading: true });
    let problem: OutputProblem | null = null;
    try {
      const classified = classifyReply(
        await transport.output({ environmentId, rootThreadId, jobId, offsets }),
      );
      if (classified.tag === "ok") {
        const applied = applyOutput(before, offsets, classified.value);
        if (applied.ok) current.current = applied.state;
        else problem = { tag: "unknown", reason: applied.reason };
      } else {
        problem = classified;
      }
    } catch (error) {
      const why = error instanceof Error && error.message !== "" ? error.message : String(error);
      problem = { tag: "unknown", reason: `the read failed before an answer (${why})` };
    }
    reading.current = false;
    setHold({ output: current.current, problem, reading: false });
  }

  return { hold, read: () => void read() };
}
