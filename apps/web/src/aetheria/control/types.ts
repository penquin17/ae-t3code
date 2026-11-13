// Local mirrors of the XC-18 human-control shapes (M10 phase 2a). The web has no dependency on `@t3tools/aetheria-contracts` until phase 2b, so each type names the contract it mirrors:
// `apps/t3code/packages/aetheria-contracts/src/interactionOperations.ts` (IO) and `rpc.ts`. Plain TypeScript: no DOM, no T3 import. A drift from the contract is caught by the native run, not here.

/** IO `Subject` (line 62): what an authorization is for, with the revision the human saw. */
export interface InteractionSubject {
  readonly type: string;
  readonly id: string;
  readonly revision: string;
}

/** IO `QuestionOption` / `Question` (~70–95). `detail` and `context` are raw Markdown, never an answer. */
export interface QuestionOption {
  readonly label: string;
  readonly description?: string;
  readonly context?: string;
}
export interface Question {
  readonly id: string;
  readonly question: string;
  readonly header?: string;
  readonly detail?: string;
  readonly options?: readonly QuestionOption[];
  readonly multiSelect?: boolean;
}

/** IO `Answer` (~104): a skipped answer selects nothing and carries no `custom`. */
export interface Answer {
  readonly id: string;
  readonly selected: readonly string[];
  readonly custom?: string;
  readonly skipped: boolean;
}

/** IO `INTERACTION_STATES` (~119). */
export type InteractionState = "pending" | "continued" | "answered" | "cancelled" | "superseded";
export type ContinuedCause =
  | "abort"
  | "process-exit"
  | "backend-restart"
  | "host-stop"
  | "timed_out";

/** IO `Resolution` (~134). */
export type Resolution =
  | { readonly type: "answers"; readonly answers: readonly Answer[]; readonly originId: string }
  | {
      readonly type: "decision";
      readonly decision: "approved" | "changes_requested";
      readonly feedback?: string;
      readonly originId: string;
    }
  | {
      readonly type: "cancelled";
      readonly feedback?: string;
      readonly originId?: string;
      readonly cause?: "mode-off";
    }
  | { readonly type: "superseded"; readonly by: string };

/** IO `Delivery` (~156): a late answer's delivery; the state stays `answered`. */
export type Delivery =
  | { readonly status: "pending" }
  | { readonly status: "delivered"; readonly commandId: string }
  | { readonly status: "failed"; readonly code: string };

interface RecordBase {
  readonly interactionId: string;
  readonly state: InteractionState;
  /** The content revision a decision must carry (SHA-256 of the exact content shown). */
  readonly revision: string;
  readonly rootSessionId: string;
  /** The asker's session. */
  readonly sessionId: string;
  readonly createdAt: string;
  readonly held: boolean;
  readonly waitMs?: number;
  readonly deadlineAt?: string;
  readonly continuedCause?: ContinuedCause;
  readonly resolution?: Resolution;
  readonly delivery?: Delivery;
}

/** IO `InteractionRecord` (~190). */
export type InteractionRecord =
  | (RecordBase & {
      readonly kind: "question";
      readonly content: { readonly questions: readonly Question[] };
    })
  | (RecordBase & {
      readonly kind: "plan-review";
      readonly content: { readonly plan: string; readonly reviewNumber: number };
    })
  | (RecordBase & {
      readonly kind: "authorization";
      readonly content: { readonly text: string; readonly subject: InteractionSubject };
    });

/** IO `PlanMode` (~300). */
export interface PlanMode {
  readonly sessionId: string;
  readonly active: boolean;
  readonly modeRevision: number;
}

/** IO `TaskView` (~330): `stale` and `unknown` are shown as such, never as a current list. */
export type TaskState = "current" | "stale" | "unknown";
export interface TaskView {
  readonly sessionId: string;
  readonly rootSessionId: string;
  readonly entryId: string;
  readonly seq: number;
  readonly todos: readonly {
    readonly content: string;
    readonly status: "pending" | "in_progress" | "completed";
  }[];
  readonly publishedAt: string;
  readonly state: TaskState;
}

/** IO `InteractionsSnapshotResult` value (~591). */
export interface InteractionsSnapshot {
  readonly rootSessionId: string;
  readonly version: number;
  readonly interactions: readonly InteractionRecord[];
}

/** IO `InteractionsChangeEvent` (~616): a push carries no record; it only prompts a fresh snapshot. */
export interface InteractionsChange {
  readonly rootSessionId: string;
  readonly version: number;
}

/** IO `reply` (~380): `{ok:true,value}` or a coded failure; already-settled and delivery-failed also carry the record. */
export type ControlReply<V> =
  | { readonly ok: true; readonly value: V }
  | {
      readonly ok: false;
      readonly code: string;
      readonly detail?: string;
      readonly record?: InteractionRecord;
    };

/** IO client payloads (~620–660). */
export interface AnswerPayload {
  readonly interactionId: string;
  readonly revision: string;
  readonly answers: readonly Answer[];
}
export interface CancelPayload {
  readonly interactionId: string;
  readonly revision: string;
  readonly feedback?: string;
}
export interface RevisionPayload {
  readonly interactionId: string;
  readonly revision: string;
}
export interface PlanDecidePayload extends RevisionPayload {
  readonly decision: "approved" | "changes_requested";
  readonly feedback?: string;
}
export interface PlanModeSetPayload {
  readonly sessionId: string;
  readonly active: boolean;
  readonly expectedModeRevision: number;
}
export interface GrantPayload {
  readonly subject: InteractionSubject;
  readonly sessionId: string;
}

/** The one place a transport's answer is read: a reply the Backend gave, a reply that never came, or a T3-level failure (scope, socket) carrying T3's own message. */
export type TransportResult =
  | { readonly tag: "reply"; readonly reply: unknown }
  | { readonly tag: "lost" }
  | { readonly tag: "failed"; readonly message: string };

/** The seam between the cards and the Backend. Production implements it over T3's RPC commands (transport.ts); tests supply scripted ones. */
export interface ControlTransport {
  snapshot(environmentId: string, rootSessionId: string): Promise<TransportResult>;
  planModeGet(environmentId: string, sessionId: string): Promise<TransportResult>;
  tasksGet(environmentId: string, sessionId: string): Promise<TransportResult>;
  answer(environmentId: string, payload: AnswerPayload): Promise<TransportResult>;
  cancel(environmentId: string, payload: CancelPayload): Promise<TransportResult>;
  hold(environmentId: string, payload: RevisionPayload): Promise<TransportResult>;
  close(environmentId: string, payload: RevisionPayload): Promise<TransportResult>;
  planDecide(environmentId: string, payload: PlanDecidePayload): Promise<TransportResult>;
  planModeSet(environmentId: string, payload: PlanModeSetPayload): Promise<TransportResult>;
  authorizationGrant(environmentId: string, payload: GrantPayload): Promise<TransportResult>;
}
