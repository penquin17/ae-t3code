// AETHERIA M05 step 6 (C2, C10): the ports the Backend gives the children service, declared structurally here until the archive (children/ports.ts) is declared.
// Child ids are T3 thread ids; XC-10 and the identity store use Pi session ids, translated through M04's thread index, never equated.
// The ThreadPort adapter is apps/server/src/aetheria/threadPort.ts, because only the server package has T3's services.

export type PortResult<V, R extends string> =
  | ({ readonly ok: true } & V)
  | { readonly ok: false; readonly reason: R; readonly detail?: string };

export const THREAD_PORT_CALLS = [
  "createChildThread",
  "bindChildSession",
  "releaseFirstTurn",
  "forkThread",
  "startTurn",
  "interrupt",
  "status",
  "subscribeTurnCompleted",
  "readDelegatedCompletion",
  "readRestartNotes",
  "suppressCompletionDelivery",
  "readChildResult",
  "close",
] as const;

export type CompletionWake = "always" | "settled_only";

export interface ChildModelSelection {
  readonly provider: string;
  readonly model: string;
  readonly effort?: string | undefined;
}
export interface ChildThreadLineage {
  readonly parentThreadId: string;
  readonly rootThreadId: string;
  readonly relationshipToParent: "subagent" | "fork";
}

export interface CreateChildThreadInput {
  /** Derived from the spawn attempt id, so a repeated create is the same command. */
  readonly commandId: string;
  readonly parentThreadId: string;
  /** The parent's active run and node, taken from trusted T3 context, never from model arguments. */
  readonly parentRunId: string;
  readonly parentNodeId: string;
  readonly task: string;
  readonly title?: string | undefined;
  readonly modelSelection: ChildModelSelection;
  readonly runtimeMode: string;
  readonly interactionMode: string;
  /** The held child's working folder, passed explicitly: T3 gives a held (root-strategy) child null branch and worktree. An absolute path. */
  readonly workingFolder: string;
  readonly completionWake: CompletionWake;
}

export interface ChildThreadStatus {
  readonly activity: "running" | "idle" | "unknown";
  readonly queued: number | "unknown";
  readonly resident: boolean | "unknown";
  readonly settleSeqHint?: number | undefined;
}

export type ChildTurnOutcome = "completed" | "failed" | "interrupted";
export interface ChildTurnCompletedEvent {
  readonly threadId: string;
  /** The run id. */
  readonly turnId: string;
  readonly outcome: ChildTurnOutcome;
  readonly settledAt: string;
  /** Redacted, from the run's error item. */
  readonly errorText?: string | undefined;
}

export type DelegatedCompletionState =
  | "pending"
  | "claimed"
  | "acknowledged"
  | "delivered"
  | "disposed";
export interface ChildRestartNote {
  readonly kind: string;
  readonly label: string;
  readonly id?: string | undefined;
  readonly awaited?: boolean | undefined;
}

export interface ChildThreadPort {
  /** Records the child thread and its task with the first turn held (T3 `delegated_task.request` with `workspaceStrategy {type:"root"}`); no turn starts. */
  createChildThread(input: CreateChildThreadInput): Promise<
    PortResult<
      {
        readonly threadId: string;
        readonly lineage: ChildThreadLineage;
        readonly heldMessageId: string;
      },
      "parent-unavailable" | "create-failed"
    >
  >;
  /**
   * R1 as decided 2026-11-12: opens the child's provider session WITH the Pi session id the service chose (`piSessionId`; IP-25 asks the Pi adapter for Pi's
   * `--session-id`), ensures the thread on the held row and persists that binding BEFORE release, so no provider request exists. The answer names the session
   * actually bound; the service rolls back when it is not the requested one. Idempotent: a repeat returns the same session id and never makes a second one. Never starts a turn.
   */
  bindChildSession(input: {
    readonly threadId: string;
    readonly heldMessageId: string;
    readonly piSessionId: string;
  }): Promise<
    PortResult<
      { readonly piSessionId: string },
      "parent-unavailable" | "session-unavailable" | "bind-failed"
    >
  >;
  /** Derives T3's command id from the held message id and reads the run state first; a repeat is accepted only when the run is truly past its hold. */
  releaseFirstTurn(input: {
    readonly threadId: string;
    readonly heldMessageId: string;
  }): Promise<PortResult<{ readonly accepted: true }, "delivery-unavailable">>;
  forkThread(input: {
    readonly parentThreadId: string;
    readonly sourcePoint: "latest_stable" | { readonly run: string };
    readonly targetThreadId: string;
  }): Promise<
    PortResult<
      { readonly threadId: string; readonly forkSessionId: string },
      "fork-failed" | "prefix-unsupported"
    >
  >;
  /** The adapter derives T3's command id from the message id, so a repeated message id counts as accepted. */
  startTurn(input: {
    readonly threadId: string;
    readonly content: string;
    readonly delivery: "queue" | "steer";
    readonly messageId: string;
  }): Promise<
    PortResult<
      { readonly accepted: true; readonly messageId: string },
      "not-resumable" | "delivery-unavailable"
    >
  >;
  /** An absent target is an accepted no-op. */
  interrupt(input: {
    readonly threadId: string;
  }): Promise<PortResult<{ readonly accepted: true }, "unavailable">>;
  status(input: {
    readonly threadId: string;
  }): Promise<PortResult<{ readonly status: ChildThreadStatus }, "unavailable">>;
  /** Terminal `run.updated` events mapped by run id; a non-terminal status, including `waiting`, is ignored. */
  subscribeTurnCompleted(
    scope: { readonly threadId: string } | { readonly rootThreadId: string },
    handler: (event: ChildTurnCompletedEvent) => void,
  ): { unsubscribe(): void };
  readDelegatedCompletion(input: { readonly threadId: string }): Promise<
    PortResult<
      {
        readonly state: DelegatedCompletionState;
        readonly generation?: number | undefined;
        readonly messageId?: string | undefined;
      },
      "unavailable"
    >
  >;
  readRestartNotes(input: {
    readonly threadId: string;
  }): Promise<PortResult<{ readonly notes: readonly ChildRestartNote[] }, "unavailable">>;
  /**
   * Record-only delivery (Plan step 12): T3's own `delegated_task.completion-delivery.dispose` on the child's task, dispatched while the child is still held. T3 skips a disposed
   * task at both points it delivers a completion. Idempotent. A failure is the service's to roll back.
   */
  suppressCompletionDelivery(input: {
    readonly threadId: string;
    readonly parentThreadId: string;
  }): Promise<PortResult<{ readonly suppressed: true }, "unavailable">>;
  /** The child's final text and T3's terminal status, as T3 recorded them on the parent's task. `not-terminal` is a completion T3 has not recorded; never a guess. */
  readChildResult(input: {
    readonly threadId: string;
  }): Promise<
    PortResult<
      { readonly status: ChildTurnOutcome; readonly text: string },
      "not-terminal" | "unavailable"
    >
  >;
  /** T3 `thread.stop` with `stopDelegatedTasks: false`, never `thread.delete`. A not-found error is treated as closed. */
  close(input: {
    readonly threadId: string;
  }): Promise<PortResult<{ readonly closed: true }, "unavailable">>;
}

export interface ChildLineageThread {
  readonly threadId: string;
  readonly parentThreadId: string;
  readonly rootThreadId: string;
  readonly relationshipToParent: "subagent" | "fork";
  /** The Pi session M04's thread index bound to the thread; null when none is bound; "unknown" when the index could not be read. */
  readonly sessionId: string | null | "unknown";
  readonly closed: boolean;
}
/** The children service's boot reads lineage here (the archive's `LineageReaderPort`): unavailable is never an empty list. */
export interface ChildLineageReader {
  listChildThreads(): Promise<
    | { readonly ok: true; readonly threads: readonly ChildLineageThread[] }
    | { readonly ok: false; readonly reason: "unavailable" }
  >;
}

/** M06's `inheritPlanMode`, a direct Backend call that needs the child already in the session tree (so it runs after activation). */
export interface PlanModeInheritPort {
  inheritPlanMode(
    parentSessionId: string,
    childSessionId: string,
    kind: "spawn" | "fork",
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly code: "INTERACTION_UNAVAILABLE" }
  >;
}

/** Completes once M06's own resume handling (`reconcileWaits`, then redeliver) has finished for a session; M05 makes no second reconcile call. */
export interface ResumeBarrierPort {
  resumed(sessionId: string): Promise<void>;
}
