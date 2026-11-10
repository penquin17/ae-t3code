// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M06 Plan step 6 (D5) — the late-answer delivery adapter: T3's own message dispatch and command receipts, in process, behind the
// interaction core's by-thread `ThreadTurnDispatch` port.
//
// What it sends. One `message.dispatch` to the asker's thread: automatic delivery intent (steer a running turn, start an idle one, queue after Stop),
// provenance `createdBy: "user"`, `creationSource: "server"`, and the caller's stable `commandId`, so T3's receipt refuses a repeat (sub-phase 1's
// dispatch probe). It goes through `ThreadManagementService.dispatch` — the same service the intake calls — and never touches a provider adapter's
// `startTurn`. The receipt, not the message text, proves acceptance; the human origin stays the only proof of a human act.
//
// Outcomes. `accepted`: T3 committed the command (a replay of the same command id is accepted too and adds no second effect). `rejected`: a failure
// T3 raises BEFORE it commits (the same set `ThreadMessageIntake` treats as "not accepted"), so no message exists. `unknown`: any other failure or
// defect, which may follow a commit — never a definite non-execution; the core reads the receipt before it dispatches again.
import { CommandId, MessageId, ThreadId, type OrchestrationV2Command } from "@t3tools/contracts";
import type { ThreadTurnDispatch } from "@t3tools/aetheria-server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

/**
 * Errors T3 raises before `commitCommand` (ThreadMessageIntake's own "not accepted" set); a failure outside it may follow a commit. A COPY, because the
 * intake's function is not exported and the fork does not edit it: `humanControlDeliveryTags.aetheria.test.ts` fails when the two lists differ.
 */
export const NOT_ACCEPTED_TAGS: ReadonlySet<string> = new Set([
  "OrchestratorCommandRejectedError",
  "OrchestratorThreadAlreadyExistsError",
  "OrchestratorProjectionError",
  "OrchestratorProviderAdapterError",
  "OrchestratorCommandPreviouslyRejectedError",
  "OrchestratorCommandIdConflictError",
  "OrchestratorSubagentThreadReadOnlyError",
  "OrchestratorThreadAboveModeLimitError",
  "OrchestratorRuntimeModeAboveCeilingError",
  "ThreadManagementProviderInstanceDisabledError",
]);

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message.length > 0
    ? error.message.slice(0, 300)
    : typeof error === "object" && error !== null && "_tag" in error
      ? String((error as { _tag: unknown })._tag)
      : "the dispatch failed";

/** The late answer as a T3 command. The message id follows the command id, so it is as stable as the command. */
export const lateAnswerCommand = (input: {
  readonly commandId: string;
  readonly threadId: string;
  readonly text: string;
}): OrchestrationV2Command => ({
  type: "message.dispatch",
  commandId: CommandId.make(input.commandId),
  threadId: ThreadId.make(input.threadId),
  messageId: MessageId.make(`message:${input.commandId}`),
  text: input.text,
  attachments: [],
  // Required by the contract; deliveryIntent "auto" overrides it from the thread's state.
  dispatchMode: { type: "queue_after_active" },
  deliveryIntent: "auto",
  createdBy: "user",
  creationSource: "server",
});

/**
 * Builds the by-thread port from T3's services and the captured runtime, the way `McpProviderSessions` becomes `credentialOf` in the Backend wrapper.
 * Requires the services the runtime layer already provides, not the provider adapter.
 */
export const makeThreadTurnDispatch = Effect.fn("makeThreadTurnDispatch")(function* (
  threads: ThreadManagementService.ThreadManagementService["Service"],
  receipts: CommandReceiptStore.CommandReceiptStoreV2["Service"],
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const port: ThreadTurnDispatch = {
    dispatch: (request) =>
      runPromise(
        threads.dispatch(lateAnswerCommand(request)).pipe(
          Effect.match({
            onSuccess: () => ({ kind: "accepted" as const }),
            onFailure: (error) =>
              NOT_ACCEPTED_TAGS.has((error as { _tag?: string })._tag ?? "")
                ? { kind: "rejected" as const, error: messageOf(error) }
                : { kind: "unknown" as const, reason: messageOf(error) },
          }),
        ),
      ).catch((cause: unknown) => ({ kind: "unknown" as const, reason: messageOf(cause) })),
    receipt: (commandId) =>
      runPromise(
        receipts.getByCommandId(CommandId.make(commandId)).pipe(
          Effect.match({
            onSuccess: (found) =>
              Option.match(found, {
                onNone: () => ({ kind: "absent" as const }),
                onSome: (receipt) =>
                  receipt.status === "accepted"
                    ? { kind: "accepted" as const }
                    : { kind: "rejected" as const, error: receipt.error ?? "rejected by T3" },
              }),
            onFailure: (error) => ({
              kind: "unavailable" as const,
              reason: messageOf(error),
            }),
          }),
        ),
      ).catch((cause: unknown) => ({ kind: "unavailable" as const, reason: messageOf(cause) })),
  };
  return port;
});
