// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M05 Plan step 6 (C2 ThreadPort table, C10, R1) — the ThreadPort adapter: the children service's view of T3, built from T3's own services.
//
// Services used, all through the captured Effect runtime (as humanControlDelivery.ts does): ThreadManagementService.dispatch/interruptThread (commands),
// OrchestratorV2.getThreadProjection/streamDomainEvents (reads and the terminal `run.updated` stream), ProviderSessionManagerV2.open (the child's provider session
// before release), EventSinkV2.write (persisting `provider-thread.updated`), IdAllocatorV2 (T3's own derived ids). It never calls a provider adapter's `startTurn`.
//
// R1 as built (record Deviations, 2026-11-11): the child is a T3 `delegated_task.request` with `workspaceStrategy {type:"root"}`, which T3 records as `defer_start`
// (run `preparing`, no provider request). `bindChildSession` then opens the provider session, ensures the thread on the held row and persists
// `provider-thread.updated` BEFORE `releaseFirstTurn`, so the real Pi session id exists with no prompt; a repeat of the bind makes no second session.
//
// What it does not do. It keeps no child state (the children service and M03 own it), only the working folder it was given for a held child that has not been
// bound yet. A command whose outcome may follow a commit is reported as `delivery-unavailable`/`unavailable`, never as success it did not see.
import {
  CommandId,
  MessageId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import type {
  ChildRestartNote,
  ChildThreadPort,
  ChildTurnCompletedEvent,
  ChildTurnOutcome,
  CreateChildThreadInput,
  DelegatedCompletionState,
  PortResult,
} from "@t3tools/aetheria-server";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { forkSlotKey, requestPiSessionId, withdrawPiSessionIdRequest } from "./piSessionIdSeam.ts";

export interface ChildThreadPortServices {
  readonly threads: ThreadManagementService.ThreadManagementService["Service"];
  readonly orchestrator: Orchestrator.OrchestratorV2["Service"];
  readonly sessions: ProviderSessionManager.ProviderSessionManagerV2["Service"];
  readonly sink: EventSink.EventSinkV2["Service"];
  readonly ids: IdAllocator.IdAllocatorV2["Service"];
}

/** A Pi session file's name carries the session id (`<timestamp>_<id>.jsonl`), the same rule the thread index applies; anything else is not a Pi session. */
const PI_FILE = /^[^_]+_([A-Za-z0-9][A-Za-z0-9-]{0,127})\.jsonl$/;
export const piSessionIdOf = (nativeId: string | null | undefined): string | undefined => {
  if (nativeId === undefined || nativeId === null) return undefined;
  const match = PI_FILE.exec(nativeId.slice(nativeId.lastIndexOf("/") + 1));
  return match?.[1];
};

/** T3 terminal run statuses mapped to a settle outcome; `waiting` and every other state is not terminal. A COPY of the archive's `mapRunStatus` table (children/settle.ts). */
const TERMINAL: Readonly<Record<string, ChildTurnOutcome>> = Object.freeze({
  completed: "completed",
  failed: "failed",
  rolled_back: "failed",
  interrupted: "interrupted",
  cancelled: "interrupted",
});
export const terminalOutcomeOf = (status: unknown): ChildTurnOutcome | null =>
  typeof status === "string" && Object.hasOwn(TERMINAL, status)
    ? (TERMINAL[status] as ChildTurnOutcome)
    : null;

const tagOf = (error: unknown): string => String((error as { _tag?: unknown } | null)?._tag ?? "");
/**
 * The typed failure inside an Effect `Cause`: the first `Fail` reason's `error`. A Cause has no `.error` of its own (it holds `reasons`), so reading `.error` off it gave `undefined` and
 * every detail read "the T3 call failed" (native sp3-fork-branch) and a not-found never read as one.
 */
const failureOf = (cause: unknown): unknown => {
  const reasons = (cause as { reasons?: unknown } | null)?.reasons;
  if (!Array.isArray(reasons)) return (cause as { error?: unknown } | null)?.error;
  const fail = reasons.find((reason) => (reason as { _tag?: unknown } | null)?._tag === "Fail");
  return (fail as { error?: unknown } | undefined)?.error;
};

// T3's dispatch errors (OrchestratorDispatchError and kin) keep their reason in a string `cause` and have an empty message; reading only `message` told the model "the T3 call failed".
const detailOf = (error: unknown): string => {
  const message = error instanceof Error && error.message.length > 0 ? error.message : "";
  const cause = (error as { cause?: unknown } | null)?.cause;
  const reason = typeof cause === "string" && cause.length > 0 ? cause : "";
  const text = [tagOf(error), message, reason]
    .filter((part, index, all) => part.length > 0 && all.indexOf(part) === index)
    .join(": ");
  return text.length > 0 ? text.slice(0, 300) : "the T3 call failed";
};
const isNotFound = (error: unknown): boolean => /NotFound/.test(tagOf(error));

const fail = <R extends string>(
  reason: R,
  detail?: string,
): { ok: false; reason: R; detail?: string } =>
  detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };

export const makeChildThreadPort = Effect.fn("makeChildThreadPort")(function* (
  services: ChildThreadPortServices,
) {
  const { threads, orchestrator, sessions, sink, ids } = services;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  /** The working folder given for a held child until it is bound: T3 gives a held child null branch and worktree, so the folder cannot be read back. */
  const heldFolders = new Map<string, string>();

  const projectionOf = (threadId: string) =>
    orchestrator.getThreadProjection(ThreadId.make(threadId));

  const port: ChildThreadPort = {
    createChildThread: (input: CreateChildThreadInput) =>
      runPromise(
        Effect.gen(function* () {
          const commandId = CommandId.make(input.commandId);
          const modelSelection = {
            instanceId: ProviderInstanceId.make(input.modelSelection.provider),
            model: input.modelSelection.model,
            ...(input.modelSelection.effort === undefined
              ? {}
              : { options: [{ id: "thinking", value: input.modelSelection.effort }] }),
          };
          yield* threads.dispatch({
            type: "delegated_task.request",
            commandId,
            parentThreadId: ThreadId.make(input.parentThreadId),
            parentRunId: RunId.make(input.parentRunId),
            parentNodeId: input.parentNodeId as never,
            task: input.task,
            ...(input.title === undefined ? {} : { title: input.title }),
            modelSelection: modelSelection as never,
            runtimeMode: input.runtimeMode as never,
            interactionMode: input.interactionMode as never,
            completionWake: input.completionWake,
            workspaceStrategy: { type: "root" },
            createdBy: "agent",
            creationSource: "server",
          });
          // T3 derives the child's ids from the command id; read them back from the projection rather than trust a local copy of that rule.
          const childId = ids.derive.delegatedTaskThread({ commandId });
          const messageId = ids.derive.delegatedTaskMessage({ commandId });
          const projection = yield* projectionOf(childId);
          const lineage = projection.thread.lineage;
          if (lineage.relationshipToParent !== "subagent" || lineage.parentThreadId === undefined)
            return fail("create-failed" as const, "the created thread is not a delegated child");
          heldFolders.set(childId, input.workingFolder);
          return {
            ok: true as const,
            threadId: childId as string,
            lineage: {
              parentThreadId: lineage.parentThreadId as string,
              rootThreadId: lineage.rootThreadId as string,
              relationshipToParent: "subagent" as const,
            },
            heldMessageId: messageId as string,
          };
        }).pipe(
          Effect.catchCause((cause) => {
            const error = failureOf(cause);
            return Effect.succeed(
              fail(
                /Parent|not active|stopping/.test(detailOf(error))
                  ? ("parent-unavailable" as const)
                  : ("create-failed" as const),
                detailOf(error),
              ),
            );
          }),
        ),
      ),

    bindChildSession: ({ threadId, piSessionId: requestedSessionId }) =>
      runPromise(
        Effect.gen(function* () {
          const projection = yield* projectionOf(threadId);
          const providerThread = projection.providerThreads[0];
          const run = projection.runs[0];
          if (providerThread === undefined || run === undefined)
            return fail("bind-failed" as const, "the held child has no provider thread or run");
          // Already bound (a repeat, or a persisted earlier attempt): the same session id, no second session.
          const existing = piSessionIdOf(providerThread.nativeThreadRef?.nativeId);
          if (existing !== undefined) return { ok: true as const, piSessionId: existing };
          const folder = heldFolders.get(threadId);
          if (folder === undefined || providerThread.providerSessionId === null)
            return fail(
              "session-unavailable" as const,
              "the held child's working folder or provider session is not known",
            );
          const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
            runtimeMode: projection.thread.runtimeMode,
            interactionMode: projection.thread.interactionMode,
            cwd: folder,
          });
          // Integration point IP-25 (marked in provider-pi's adapter.ts): ask the Pi adapter to launch this thread's Pi with the id the service already activated an identity under. The adapter takes it once, at
          // the launch inside `open`; whatever it did not take is withdrawn below, so no request outlives this call.
          requestPiSessionId(threadId, requestedSessionId);
          const runtime = yield* sessions.open({
            threadId: ThreadId.make(threadId),
            providerSessionId: providerThread.providerSessionId,
            modelSelection: run.modelSelection,
            runtimePolicy,
          });
          const ensured = yield* runtime.ensureThread({
            threadId: ThreadId.make(threadId),
            modelSelection: run.modelSelection,
            runtimePolicy,
            providerSessionId: providerThread.providerSessionId,
            existingProviderThread: providerThread,
          });
          const sessionId = piSessionIdOf(ensured.nativeThreadRef?.nativeId);
          if (sessionId === undefined)
            return fail("bind-failed" as const, "the provider thread names no Pi session");
          // Persist before release: without it T3's first turn calls ensureThread again and makes a second session.
          yield* sink.write({
            events: [
              {
                id: yield* ids.allocate.event({ threadId: ThreadId.make(threadId) }),
                type: "provider-thread.updated",
                threadId: ThreadId.make(threadId),
                driver: ensured.driver,
                providerInstanceId: ensured.providerInstanceId,
                occurredAt: yield* DateTime.now,
                payload: ensured,
              },
            ],
          });
          heldFolders.delete(threadId);
          return { ok: true as const, piSessionId: sessionId };
        }).pipe(
          Effect.ensuring(Effect.sync(() => withdrawPiSessionIdRequest(threadId))),
          Effect.catchCause((cause) =>
            Effect.succeed(fail("bind-failed" as const, detailOf(failureOf(cause)))),
          ),
        ),
      ),

    releaseFirstTurn: ({ threadId, heldMessageId }) =>
      runPromise(
        Effect.gen(function* () {
          const read = projectionOf(threadId);
          const heldRun = (
            projection: OrchestrationV2ThreadProjection,
          ): OrchestrationV2Run | undefined =>
            projection.runs.find((run) => run.userMessageId === heldMessageId) ??
            projection.runs[0];
          const before = heldRun(yield* read);
          if (before === undefined)
            return fail("delivery-unavailable" as const, "the held run is not found");
          // Past its hold already (an earlier release, or a repeat): accepted without a second command.
          if (before.status !== "preparing") return { ok: true as const, accepted: true as const };
          return yield* threads
            .dispatch({
              type: "prepared-run.release",
              commandId: CommandId.make(`m05-release:${heldMessageId}`),
              threadId: ThreadId.make(threadId),
              runId: before.id,
            })
            .pipe(
              Effect.as({ ok: true as const, accepted: true as const }),
              // T3 refuses a second release under another command id; accepted only when the run is truly past its hold.
              Effect.catchCause((cause) =>
                read.pipe(
                  Effect.map((projection) => heldRun(projection)),
                  Effect.map((after) =>
                    after !== undefined && after.status !== "preparing"
                      ? { ok: true as const, accepted: true as const }
                      : fail("delivery-unavailable" as const, detailOf(failureOf(cause))),
                  ),
                  Effect.catchCause(() =>
                    Effect.succeed(
                      fail("delivery-unavailable" as const, "the held run cannot be read"),
                    ),
                  ),
                ),
              ),
            );
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.succeed(fail("delivery-unavailable" as const, detailOf(failureOf(cause)))),
          ),
        ),
      ),

    // T3's `thread.fork` creates only the fork THREAD: the Pi session copy is made when its first turn starts (`PiAdapter.forkThread`, `pi --fork <file>`). The Backend's chosen session
    // id is asked for in the IP-25 slot under `fork:<threadId>` (not the plain thread id, which the thread's own open launch would consume), so the copy is made under that id and the
    // identity can be activated before it exists. The request is withdrawn when the fork fails or the thread is closed first.
    forkThread: ({ parentThreadId, sourcePoint, targetThreadId, piSessionId }) =>
      runPromise(
        Effect.gen(function* () {
          // A run prefix is accepted only at the parent's LATEST completed run (T3's own `latest_stable` rule: completed, with a checkpoint). Pi's copy at any earlier run opens a session
          // with an id of its own, which the identity cannot be activated under first, so an earlier run is refused here, before anything is made or requested.
          if (sourcePoint !== "latest_stable") {
            const latest = yield* projectionOf(parentThreadId).pipe(
              Effect.map((projection) => ({
                readable: true as const,
                id: projection.runs
                  .filter((run) => run.status === "completed" && run.checkpointId !== null)
                  .toSorted((left, right) => right.ordinal - left.ordinal)[0]?.id,
              })),
              Effect.catchCause(() => Effect.succeed({ readable: false as const })),
            );
            if (!latest.readable)
              return fail("unavailable" as const, "the parent's runs cannot be read");
            if (latest.id === undefined || String(latest.id) !== sourcePoint.run) {
              return fail(
                "prefix-unsupported" as const,
                "a fork works only from the latest finished turn of the conversation; that run is not it",
              );
            }
          }
          requestPiSessionId(forkSlotKey(targetThreadId), piSessionId);
          yield* threads.dispatch({
            type: "thread.fork",
            commandId: CommandId.make(`m05-fork:${targetThreadId}`),
            sourceThreadId: ThreadId.make(parentThreadId),
            targetThreadId: ThreadId.make(targetThreadId),
            sourcePoint:
              sourcePoint === "latest_stable"
                ? { type: "latest_stable" }
                : { type: "run", runId: RunId.make(sourcePoint.run) },
            createdBy: "agent",
            creationSource: "server",
          });
          return { ok: true as const, threadId: targetThreadId };
        }).pipe(
          Effect.catchCause((cause) => {
            withdrawPiSessionIdRequest(forkSlotKey(targetThreadId));
            return Effect.succeed(fail("fork-failed" as const, detailOf(failureOf(cause))));
          }),
        ),
      ),

    startTurn: ({ threadId, content, delivery, messageId }) =>
      runPromise(
        threads
          .dispatch({
            type: "message.dispatch",
            // T3 deduplicates by command id, so a repeated message id is a replay with no second effect.
            commandId: CommandId.make(`m05-turn:${messageId}`),
            threadId: ThreadId.make(threadId),
            messageId: MessageId.make(messageId),
            text: content,
            attachments: [],
            dispatchMode: { type: "queue_after_active" },
            deliveryIntent: delivery === "steer" ? "steer" : "auto",
            createdBy: "agent",
            creationSource: "server",
          })
          .pipe(
            Effect.as({ ok: true as const, accepted: true as const, messageId }),
            Effect.catchCause((cause) => {
              const error = failureOf(cause);
              return Effect.succeed(
                /SubagentThreadReadOnly|Closed|stopped/i.test(tagOf(error))
                  ? fail("not-resumable" as const, detailOf(error))
                  : fail("delivery-unavailable" as const, detailOf(error)),
              );
            }),
          ),
      ),

    interrupt: ({ threadId }) =>
      runPromise(
        Effect.gen(function* () {
          const projection = yield* projectionOf(threadId);
          yield* threads.interruptThread({
            projectId: projection.thread.projectId,
            commandId: CommandId.make(`m05-interrupt:${threadId}:${projection.runs.length}`),
            threadId: ThreadId.make(threadId),
            reason: "managed-work interrupt",
          });
          return { ok: true as const, accepted: true as const };
        }).pipe(
          Effect.catchCause((cause) => {
            const error = failureOf(cause);
            return Effect.succeed(
              isNotFound(error)
                ? { ok: true as const, accepted: true as const }
                : fail("unavailable" as const, detailOf(error)),
            );
          }),
        ),
      ),

    status: ({ threadId }) =>
      runPromise(
        Effect.gen(function* () {
          const projection = yield* projectionOf(threadId);
          const active = projection.runs.filter((run) => terminalOutcomeOf(run.status) === null);
          const providerSessionId = projection.providerThreads.at(-1)?.providerSessionId ?? null;
          const resident =
            providerSessionId === null
              ? ("unknown" as const)
              : yield* sessions.isLive(providerSessionId);
          return {
            ok: true as const,
            status: {
              activity: active.length > 0 ? ("running" as const) : ("idle" as const),
              queued: projection.runs.filter((run) => run.status === "queued").length,
              resident,
            },
          };
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.succeed(fail("unavailable" as const, detailOf(failureOf(cause)))),
          ),
        ),
      ),

    subscribeTurnCompleted: (scope, handler) => {
      const rootCache = new Map<string, string | undefined>();
      const matches = (threadId: string) =>
        "threadId" in scope
          ? Effect.succeed(threadId === scope.threadId)
          : rootCache.has(threadId)
            ? Effect.succeed(rootCache.get(threadId) === scope.rootThreadId)
            : projectionOf(threadId).pipe(
                Effect.map((projection) => projection.thread.lineage.rootThreadId as string),
                Effect.catchCause(() => Effect.undefined),
                Effect.tap((root) => Effect.sync(() => void rootCache.set(threadId, root))),
                Effect.map((root) => root === scope.rootThreadId),
              );
      const fiber = runFork(
        orchestrator.streamDomainEvents.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (event.type !== "run.updated") return;
              const run = event.payload as OrchestrationV2Run;
              const outcome = terminalOutcomeOf(run.status);
              if (outcome === null) return;
              if (!(yield* matches(String(run.threadId)))) return;
              const completed: ChildTurnCompletedEvent = {
                threadId: String(run.threadId),
                turnId: String(run.id),
                outcome,
                settledAt:
                  run.completedAt === null
                    ? DateTime.formatIso(yield* DateTime.now)
                    : DateTime.formatIso(run.completedAt),
              };
              yield* Effect.sync(() => handler(completed)).pipe(Effect.ignore);
            }),
          ),
          Effect.ignore,
        ),
      );
      return {
        unsubscribe: () => {
          void runPromise(Fiber.interrupt(fiber)).catch(() => undefined);
        },
      };
    },

    readDelegatedCompletion: ({ threadId }) =>
      runPromise(
        Effect.gen(function* () {
          const child = yield* projectionOf(threadId);
          const parentId = child.thread.lineage.parentThreadId;
          if (parentId === undefined || parentId === null)
            return fail("unavailable" as const, "the thread has no parent");
          const parent = yield* projectionOf(parentId);
          const task = parent.subagents.find(
            (subagent) => String(subagent.childThreadId) === threadId,
          );
          const state = task?.completionDelivery?.state;
          if (task === undefined || state === undefined)
            return fail("unavailable" as const, "no delegated-completion state is recorded");
          const cohort = parent.runs.find((run) => run.id === task.runId)?.delegatedCompletion
            ?.delivery;
          const delivery =
            cohort?.taskIds.some((id) => id === task.id) === true ? cohort : undefined;
          return {
            ok: true as const,
            state: state as DelegatedCompletionState,
            ...(delivery === undefined
              ? {}
              : {
                  generation: delivery.generation as number,
                  messageId: delivery.messageId as string,
                }),
          };
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.succeed(fail("unavailable" as const, detailOf(failureOf(cause)))),
          ),
        ),
      ),

    // Record-only delivery (step 12): T3 skips a task whose completion delivery is `disposed` at the offer when the child completes AND at the parent-settle delivery
    // (Orchestrator.ts planDelegatedCompletionDelivery and its `pending` selection). The command is T3's own and public; the same command id replays harmlessly.
    suppressCompletionDelivery: ({ threadId, parentThreadId }) =>
      runPromise(
        Effect.gen(function* () {
          const parent = yield* projectionOf(parentThreadId);
          const task = parent.subagents.find(
            (subagent) =>
              subagent.origin === "app_owned" && String(subagent.childThreadId) === threadId,
          );
          if (task === undefined)
            return fail("unavailable" as const, "the parent holds no delegated task for the child");
          yield* threads.dispatch({
            type: "delegated_task.completion-delivery.dispose",
            commandId: CommandId.make(`m05-suppress:${task.id}`),
            parentThreadId: ThreadId.make(parentThreadId),
            taskId: task.id,
          });
          return { ok: true as const, suppressed: true as const };
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.succeed(fail("unavailable" as const, detailOf(failureOf(cause)))),
          ),
        ),
      ),

    // The child's final result as T3 recorded it on the parent's task when the child completed (`subagent.result`, the run's final text) and T3's own terminal status.
    readChildResult: ({ threadId }) =>
      runPromise(
        Effect.gen(function* () {
          const child = yield* projectionOf(threadId);
          const parentId = child.thread.lineage.parentThreadId;
          if (parentId === undefined || parentId === null)
            return fail("unavailable" as const, "the thread has no parent");
          const parent = yield* projectionOf(parentId);
          const task = parent.subagents.find(
            (subagent) => String(subagent.childThreadId) === threadId,
          );
          if (task === undefined)
            return fail("unavailable" as const, "the parent holds no delegated task for the child");
          const status = terminalOutcomeOf(task.status);
          if (status === null) return fail("not-terminal" as const);
          return { ok: true as const, status, text: task.result ?? "" };
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.succeed(fail("unavailable" as const, detailOf(failureOf(cause)))),
          ),
        ),
      ),

    // Step 13: T3's newest run (by ordinal) with its terminal status mapped as for a settle; a run that has not ended is `active`. After a restart T3 has cut a running child's run
    // and, with the R2 seam (IP-24), has not re-run it, so a cut run reads terminal here.
    readLastRun: ({ threadId }) =>
      runPromise(
        projectionOf(threadId).pipe(
          Effect.map((projection) => {
            const last = [...projection.runs].sort((a, b) => b.ordinal - a.ordinal)[0];
            if (last === undefined) return { ok: true as const, run: null };
            const outcome = terminalOutcomeOf(last.status);
            return {
              ok: true as const,
              run: {
                runId: String(last.id),
                outcome: outcome ?? ("active" as const),
                settledAt:
                  outcome === null || last.completedAt === null
                    ? null
                    : DateTime.formatIso(last.completedAt),
                errorText: null,
              },
            };
          }),
          Effect.catchCause((cause) =>
            Effect.succeed(fail("unavailable" as const, detailOf(failureOf(cause)))),
          ),
        ),
      ),

    readRestartNotes: ({ threadId }) =>
      runPromise(
        projectionOf(threadId).pipe(
          Effect.map((projection) => {
            const last = [...projection.runs].sort((a, b) => b.ordinal - a.ordinal)[0];
            const notes: ChildRestartNote[] = (last?.restartCancelledBackgroundWork ?? []).map(
              (note) => ({
                kind: note.kind,
                label: note.label,
                ...(note.id === undefined ? {} : { id: note.id }),
                ...(note.awaited === undefined ? {} : { awaited: note.awaited }),
              }),
            );
            return { ok: true as const, notes };
          }),
          Effect.catchCause((cause) =>
            Effect.succeed(fail("unavailable" as const, detailOf(failureOf(cause)))),
          ),
        ),
      ),

    close: ({ threadId }) => {
      // A fork thread closed before its first turn must not leave its requested session id for a later launch.
      withdrawPiSessionIdRequest(forkSlotKey(threadId));
      return runPromise(
        threads
          .dispatch({
            type: "thread.stop",
            commandId: CommandId.make(`m05-close:${threadId}`),
            threadId: ThreadId.make(threadId),
            reason: "managed-work close",
            // Never the child's own delegated tasks' walk here and never `thread.delete`: the history is kept.
            stopDelegatedTasks: false,
          })
          .pipe(
            Effect.as({ ok: true as const, closed: true as const }),
            Effect.catchCause((cause) => {
              const error = failureOf(cause);
              return Effect.succeed(
                isNotFound(error)
                  ? { ok: true as const, closed: true as const }
                  : fail("unavailable" as const, detailOf(error)),
              );
            }),
          ),
      );
    },
  };
  return port satisfies ChildThreadPort;
});

export type { PortResult };
