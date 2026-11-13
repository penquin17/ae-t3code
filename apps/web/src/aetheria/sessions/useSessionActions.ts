import {
  parseScopedProjectKey,
  parseScopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useThreadActions } from "../../hooks/useThreadActions";
import { newThreadId, randomUUID } from "~/lib/utils";
import { readThreadShell, waitForThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { createActionRunner, type OutcomeStep, type RunResult } from "../core/outcome";
import { sendResultFromCommand } from "./commandResult";
import { forkThenRename } from "./forkSequence";

type ThreadRef = NonNullable<ReturnType<typeof parseScopedThreadKey>>;

export interface SessionActions {
  open(sessionId: string): void;
  pin(sessionId: string, pinned: boolean): Promise<RunResult<unknown>>;
  archive(sessionId: string): Promise<RunResult<unknown>>;
  rename(sessionId: string, title: string): Promise<RunResult<unknown>>;
  fork(sessionId: string): Promise<RunResult<unknown>>;
  /** Fork, then name the fork; a fork that applied with a rename that did not ends as `partial`. */
  forkAndRename(sessionId: string, title: string): Promise<RunResult<unknown>>;
  startSession(workspaceId: string): Promise<RunResult<unknown>>;
}

/**
 * The session actions, each ending as one of the five outcomes through the action runner. A row is
 * never edited here: success is whatever T3's next snapshot shows, and nothing is sent twice. A fork
 * is confirmed by waiting for the new thread's shell; its rename is a separate sequenced step (step 8).
 */
export function useSessionActions(): SessionActions {
  const router = useRouter();
  const { pinThread, unpinThread, archiveThread } = useThreadActions();
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const forkFromRun = useAtomCommand(threadEnvironment.forkFromRun, { reportFailure: false });
  const startNewThread = useNewThreadHandler();
  const [runner] = useState(() => createActionRunner({ newRequestId: randomUUID }));

  const open = (sessionId: string) => {
    const ref = parseScopedThreadKey(sessionId);
    if (ref === null) return;
    void router.navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };

  const onThread = (
    sessionId: string,
    label: string,
    build: (ref: ThreadRef) => OutcomeStep<unknown>,
  ): Promise<RunResult<unknown>> => {
    const ref = parseScopedThreadKey(sessionId);
    if (ref === null) {
      return runner.run(sessionId, {
        label,
        send: async () => ({ tag: "unavailable", reason: "the session is not a T3 thread" }),
      });
    }
    return runner.run(sessionId, build(ref));
  };

  const forkStep = (ref: ThreadRef): OutcomeStep<ThreadRef> => ({
    label: "Fork",
    send: async () => {
      const source = readThreadShell(ref);
      const runId = source?.latestRun?.runId;
      if (source === null || runId === undefined) {
        return { tag: "unavailable", reason: "this session has no run to fork from yet" };
      }
      const targetThreadId = newThreadId();
      const sent = sendResultFromCommand(
        await forkFromRun({
          environmentId: ref.environmentId,
          input: {
            sourceThreadId: ref.threadId,
            targetThreadId,
            runId,
            title: `${source.title} fork`,
          },
        }),
      );
      return sent.tag === "accepted"
        ? { tag: "accepted", value: scopeThreadRef(ref.environmentId, targetThreadId) }
        : sent;
    },
    confirm: async (target) =>
      (await waitForThreadShell(target)) ? { tag: "shows" } : { tag: "absent" },
  });

  const renameStep = (ref: ThreadRef, title: string): OutcomeStep<unknown> => ({
    label: "Rename",
    send: async () =>
      sendResultFromCommand(
        await updateMetadata({
          environmentId: ref.environmentId,
          input: { threadId: ref.threadId, title },
        }),
      ),
  });

  return {
    open,
    forkAndRename: (sessionId, title) => {
      const ref = parseScopedThreadKey(sessionId);
      if (ref === null) {
        return runner.runSequence(sessionId, [
          {
            label: "Fork",
            send: async () => ({ tag: "unavailable", reason: "the session is not a T3 thread" }),
          },
        ]);
      }
      return forkThenRename(runner, sessionId, forkStep(ref), (target) =>
        renameStep(target, title),
      );
    },
    pin: (sessionId, pinned) =>
      onThread(sessionId, pinned ? "Pin" : "Unpin", (ref) => ({
        label: pinned ? "Pin" : "Unpin",
        send: async () => sendResultFromCommand(await (pinned ? pinThread(ref) : unpinThread(ref))),
      })),
    archive: (sessionId) =>
      onThread(sessionId, "Archive", (ref) => ({
        label: "Archive",
        send: async () => sendResultFromCommand(await archiveThread(ref)),
      })),
    rename: (sessionId, title) => onThread(sessionId, "Rename", (ref) => renameStep(ref, title)),
    fork: (sessionId) => onThread(sessionId, "Fork", forkStep),
    startSession: (workspaceId) =>
      runner.run(workspaceId, {
        label: "New session",
        send: async () => {
          const projectRef = parseScopedProjectKey(workspaceId);
          if (projectRef === null) {
            return { tag: "unavailable", reason: "this list entry is not a T3 project" };
          }
          try {
            return { tag: "accepted", value: await startNewThread(projectRef) };
          } catch (error) {
            return {
              tag: "refused",
              code: "NEW_SESSION_FAILED",
              message: error instanceof Error ? error.message : "The new session could not start.",
            };
          }
        },
      }),
  };
}
