// AETHERIA M06 step 4: the human-control contracts (XC-6 operations, record and events, XC-17 origin, XC-8 evidence, codes, XC-18 client).
// No Agent argument or client payload names a caller, actor, root or repository; decode with `onExcessProperty: "error"` to refuse them.
// There is no decision operation over XC-6. Imports nothing from `@t3tools/contracts` (see rpc.ts).
import * as Schema from "effect/Schema";

export const INTERACTION_CREATE_OPERATION = "interaction.create";
export const INTERACTION_AWAIT_OPERATION = "interaction.await";
export const INTERACTION_RELEASE_OPERATION = "interaction.release";
export const TASKS_PUBLISH_OPERATION = "tasks.publish";
export const PLAN_MODE_GET_OPERATION = "plan-mode.get";
export const AUDIT_HISTORY_OPERATION = "audit.history";
export const ORIGIN_VERIFY_OPERATION = "origin.verify";

/** The canonical code list with M12's class per code. M03's `AUTH_*` apply to Agent calls and are not repeated. */
export const INTERACTION_CODE_CLASSES = {
  INTERACTION_ORIGIN_NOT_HUMAN: "refusal",
  INTERACTION_REVIEW_NOT_PERMITTED: "refusal",
  INTERACTION_NOT_IN_PLAN_MODE: "refusal",
  INTERACTION_ANSWER_INVALID: "refusal",
  INTERACTION_GRANT_INVALID: "refusal",
  INTERACTION_ALREADY_SETTLED: "conflict",
  INTERACTION_STALE_REVISION: "conflict",
  ORIGIN_STALE: "conflict",
  INTERACTION_NOT_FOUND: "absence",
  ORIGIN_NOT_FOUND: "absence",
  ORIGIN_MISMATCH: "absence",
  INTERACTION_UNAVAILABLE: "failure",
  INTERACTION_DELIVERY_FAILED: "failure",
  INTERACTION_FORMAT_UNSUPPORTED: "failure",
} as const;
export type InteractionCode = keyof typeof INTERACTION_CODE_CLASSES;
export type InteractionCodeClass = (typeof INTERACTION_CODE_CLASSES)[InteractionCode];
export const INTERACTION_CODES = Object.keys(INTERACTION_CODE_CLASSES) as InteractionCode[];

/** The four causes a wait can end: `abort` only from `interaction.release`, the rest from the Backend. */
export const WAIT_LOST_CAUSES = ["abort", "process-exit", "backend-restart", "host-stop"] as const;
export type WaitLostCause = (typeof WAIT_LOST_CAUSES)[number];

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Text = Schema.String.check(Schema.isMinLength(1));
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const Nat = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const PositiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
/** The Backend clock, ISO-8601 UTC. */
const IsoUtc = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/),
);

const uniqueBy = <T>(key: (item: T) => string, message: string) =>
  Schema.makeFilter<ReadonlyArray<T>>(
    (items) => new Set(items.map(key)).size === items.length || message,
  );

const Subject = Schema.Struct({ type: Id, id: Id, revision: Sha256 });
export type InteractionSubject = typeof Subject.Type;

/** D7: Markdown detail and context are stored raw and are never an answer. */
const QuestionOption = Schema.Struct({
  label: Text,
  description: Schema.optionalKey(Schema.String),
  context: Schema.optionalKey(Schema.String),
});
const Question = Schema.Struct({
  id: Id,
  question: Text,
  header: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  options: Schema.optionalKey(
    Schema.Array(QuestionOption).check(
      Schema.isMinLength(1),
      uniqueBy(
        (option: typeof QuestionOption.Type) => option.label,
        "option labels must be unique",
      ),
    ),
  ),
  multiSelect: Schema.optionalKey(Schema.Boolean),
});
const QuestionList = Schema.Array(Question).check(
  Schema.isMinLength(1),
  uniqueBy((question: typeof Question.Type) => question.id, "question ids must be unique"),
);
export const QuestionBatch = Schema.Struct({ questions: QuestionList });
export type QuestionBatch = typeof QuestionBatch.Type;

const Answer = Schema.Struct({
  id: Id,
  selected: Schema.Array(Text),
  custom: Schema.optionalKey(Schema.String),
  skipped: Schema.Boolean,
});
const AnswerList = Schema.Array(Answer).check(
  Schema.isMinLength(1),
  uniqueBy((answer: typeof Answer.Type) => answer.id, "answer ids must be unique"),
);
export const AnswerBatch = Schema.Struct({ answers: AnswerList });
export type AnswerBatch = typeof AnswerBatch.Type;

const INTERACTION_KINDS = ["question", "plan-review", "authorization"] as const;
const INTERACTION_STATES = ["pending", "continued", "answered", "cancelled", "superseded"] as const;
export type InteractionState = (typeof INTERACTION_STATES)[number];
const InteractionState = Schema.Literals(INTERACTION_STATES);

/** A wait ended because of one of the four causes, or because the Backend's deadline passed. */
const ContinuedCause = Schema.Literals([...WAIT_LOST_CAUSES, "timed_out"]);

const Resolution = Schema.Union([
  Schema.Struct({ type: Schema.Literal("answers"), answers: AnswerList, originId: Id }),
  Schema.Struct({
    type: Schema.Literal("decision"),
    decision: Schema.Literals(["approved", "changes_requested"]),
    feedback: Schema.optionalKey(Schema.String),
    originId: Id,
  }),
  Schema.Struct({
    type: Schema.Literal("cancelled"),
    feedback: Schema.optionalKey(Schema.String),
    originId: Schema.optionalKey(Id),
    cause: Schema.optionalKey(Schema.Literal("mode-off")),
  }),
  Schema.Struct({ type: Schema.Literal("superseded"), by: Id }),
]);

/** Delivery of a late answer (D5): journalled `delivered{commandId}` or `delivery_failed{code}`; the state stays `answered`. */
const Delivery = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({ status: Schema.Literal("delivered"), commandId: Id }),
  Schema.Struct({ status: Schema.Literal("failed"), code: Text }),
]);

const recordBase = {
  interactionId: Id,
  state: InteractionState,
  /** The content revision a decision must carry: SHA-256 of the exact content the human sees (D6, D9). */
  revision: Sha256,
  rootSessionId: Id,
  /** The asker's session. */
  sessionId: Id,
  /** The asker's tool call id; absent only for an `authorization` a Backend service created. */
  askCallId: Schema.optionalKey(Id),
  createdAt: IsoUtc,
  held: Schema.Boolean,
  /** The asker's optional wait in milliseconds; absent means no expiry (D4). */
  waitMs: Schema.optionalKey(PositiveInt),
  /** The Backend-owned deadline of a timed wait; absent when untimed or held. */
  deadlineAt: Schema.optionalKey(IsoUtc),
  continuedCause: Schema.optionalKey(ContinuedCause),
  resolution: Schema.optionalKey(Resolution),
  delivery: Schema.optionalKey(Delivery),
} as const;

const InteractionRecordShape = Schema.Union([
  Schema.Struct({ ...recordBase, kind: Schema.Literal("question"), content: QuestionBatch }),
  Schema.Struct({
    ...recordBase,
    kind: Schema.Literal("plan-review"),
    content: Schema.Struct({ plan: Text, reviewNumber: PositiveInt }),
  }),
  Schema.Struct({
    ...recordBase,
    kind: Schema.Literal("authorization"),
    content: Schema.Struct({ text: Text, subject: Subject }),
  }),
]);

const RESOLUTION_FOR_STATE: Readonly<Record<string, string>> = {
  cancelled: "cancelled",
  superseded: "superseded",
};

/** A state and the record around it agree: the resolution, delivery and continued cause belong to exactly the states that carry them. */
const recordIsConsistent = Schema.makeFilter<typeof InteractionRecordShape.Type>((record) => {
  const open = record.state === "pending" || record.state === "continued";
  if (open && record.resolution !== undefined) return "an open interaction has no resolution";
  if (!open && record.resolution === undefined)
    return "a settled interaction carries its resolution";
  if (record.delivery !== undefined && record.state !== "answered") {
    return "only an answered interaction has a delivery";
  }
  if ((record.continuedCause !== undefined) !== (record.state === "continued")) {
    return "a continued cause belongs to the continued state only";
  }
  if (record.kind !== "authorization" && record.askCallId === undefined) {
    return "an asked interaction names its ask call";
  }
  if (record.resolution !== undefined) {
    const wanted =
      record.state === "answered"
        ? record.kind === "plan-review"
          ? "decision"
          : "answers"
        : RESOLUTION_FOR_STATE[record.state];
    if (record.resolution.type !== wanted) return `the resolution for ${record.state} is ${wanted}`;
  }
  return true;
});

export const InteractionRecord = InteractionRecordShape.check(recordIsConsistent);
export type InteractionRecord = typeof InteractionRecord.Type;

const eventBase = { at: IsoUtc, rootSessionId: Id, sessionId: Id } as const;
const interactionEventBase = { ...eventBase, interactionId: Id } as const;

/** `closed` and `held` change no state; each ending stays distinguishable for audit. */
export const InteractionEvent = Schema.Union([
  Schema.Struct({
    ...interactionEventBase,
    type: Schema.Literal("created"),
    kind: Schema.Literals(INTERACTION_KINDS),
    revision: Sha256,
  }),
  Schema.Struct({ ...interactionEventBase, type: Schema.Literal("closed") }),
  Schema.Struct({ ...interactionEventBase, type: Schema.Literal("held") }),
  Schema.Struct({ ...interactionEventBase, type: Schema.Literal("timed_out") }),
  Schema.Struct({
    ...interactionEventBase,
    type: Schema.Literal("wait_lost"),
    cause: Schema.Literals(WAIT_LOST_CAUSES),
  }),
  Schema.Struct({ ...interactionEventBase, type: Schema.Literal("answered"), originId: Id }),
  Schema.Struct({
    ...interactionEventBase,
    type: Schema.Literal("cancelled"),
    originId: Schema.optionalKey(Id),
    cause: Schema.optionalKey(Schema.Literal("mode-off")),
  }),
  Schema.Struct({ ...interactionEventBase, type: Schema.Literal("superseded"), by: Id }),
  Schema.Struct({ ...interactionEventBase, type: Schema.Literal("delivered"), commandId: Id }),
  Schema.Struct({ ...interactionEventBase, type: Schema.Literal("delivery_failed"), code: Text }),
  Schema.Struct({
    ...eventBase,
    type: Schema.Literal("mode_set"),
    active: Schema.Boolean,
    modeRevision: PositiveInt,
    originId: Id,
  }),
  Schema.Struct({ ...eventBase, type: Schema.Literal("granted"), originId: Id, subject: Subject }),
]);
export type InteractionEvent = typeof InteractionEvent.Type;

const Actor = Schema.Struct({
  clientSessionId: Id,
  grantedScopes: Schema.Array(Id),
  authenticatedAt: IsoUtc,
});
const originBase = {
  originId: Id,
  subject: Subject,
  payloadDigest: Schema.NullOr(Sha256),
  actor: Actor,
  sessionId: Id,
  rootSessionId: Id,
  at: IsoUtc,
} as const;

/** Only these kind/decision pairs exist; `interactionId` is null for a mode change and a one-step grant, and there is no direct-message kind. */
export const HumanOrigin = Schema.Union([
  Schema.Struct({
    ...originBase,
    kind: Schema.Literal("answer"),
    interactionId: Id,
    decision: Schema.Literals(["answered", "cancelled"]),
  }),
  Schema.Struct({
    ...originBase,
    kind: Schema.Literal("plan-decision"),
    interactionId: Id,
    decision: Schema.Literals(["approved", "changes_requested"]),
  }),
  Schema.Struct({
    ...originBase,
    kind: Schema.Literal("authorization"),
    interactionId: Id,
    decision: Schema.Literals(["approved", "declined"]),
  }),
  Schema.Struct({
    ...originBase,
    kind: Schema.Literal("authorization"),
    interactionId: Schema.Null,
    decision: Schema.Literal("approved"),
  }),
  Schema.Struct({
    ...originBase,
    kind: Schema.Literal("mode-change"),
    interactionId: Schema.Null,
    decision: Schema.Literals(["set-active", "set-inactive"]),
  }),
]);
export type HumanOrigin = typeof HumanOrigin.Type;

export const PlanMode = Schema.Struct({ sessionId: Id, active: Schema.Boolean, modeRevision: Nat });
export type PlanMode = typeof PlanMode.Type;

const Todo = Schema.Struct({
  content: Text,
  status: Schema.Literals(["pending", "in_progress", "completed"]),
});
const Todos = Schema.Array(Todo).check(
  uniqueBy((todo: typeof Todo.Type) => todo.content, "todo contents must be unique"),
);

export const TaskView = Schema.Struct({
  sessionId: Id,
  entryId: Id,
  seq: Nat,
  todos: Todos,
  publishedAt: IsoUtc,
});
export type TaskView = typeof TaskView.Type;

const RECORD_CARRYING_CODES: readonly InteractionCode[] = [
  "INTERACTION_ALREADY_SETTLED",
  "INTERACTION_DELIVERY_FAILED",
];

/**
 * `{ok: true, value}` or `{ok: false, code}`. A failure may use only the codes the operation can raise; already-settled and
 * delivery-failed also carry the record (the settled one, and the one that stays `answered`).
 */
const reply = <S extends Schema.Top>(value: S, codes: readonly InteractionCode[]) => {
  const plain = codes.filter((code) => !RECORD_CARRYING_CODES.includes(code));
  const withRecord = codes.filter((code) => RECORD_CARRYING_CODES.includes(code));
  return Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value }),
    Schema.Struct({
      ok: Schema.Literal(false),
      code: Schema.Literals(plain),
      detail: Schema.optionalKey(Schema.String),
    }),
    ...withRecord.map((code) =>
      Schema.Struct({
        ok: Schema.Literal(false),
        code: Schema.Literal(code),
        record: InteractionRecord,
        detail: Schema.optionalKey(Schema.String),
      }),
    ),
  ]);
};

const strict = { onExcessProperty: "error" } as const;

/** `callId` is the asker's tool call id; the Backend derives the session, root and revision. `authorization` cannot be created by an Agent. */
export const InteractionCreateArgs = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("question"),
    callId: Id,
    questions: QuestionList,
    waitMs: Schema.optionalKey(PositiveInt),
  }),
  Schema.Struct({ kind: Schema.Literal("plan-review"), callId: Id, plan: Text }),
]);
export type InteractionCreateArgs = typeof InteractionCreateArgs.Type;
export const InteractionCreateResult = reply(InteractionRecord, [
  "INTERACTION_REVIEW_NOT_PERMITTED",
  "INTERACTION_NOT_IN_PLAN_MODE",
  "INTERACTION_ANSWER_INVALID",
  "INTERACTION_UNAVAILABLE",
]);
export type InteractionCreateResult = typeof InteractionCreateResult.Type;

export const InteractionAwaitArgs = Schema.Struct({ interactionId: Id });
export type InteractionAwaitArgs = typeof InteractionAwaitArgs.Type;
/** One segment: the record as it stands when the bound passes or the state leaves `pending`. */
export const InteractionAwaitResult = reply(InteractionRecord, [
  "INTERACTION_NOT_FOUND",
  "INTERACTION_UNAVAILABLE",
]);
export type InteractionAwaitResult = typeof InteractionAwaitResult.Type;

export const InteractionReleaseArgs = Schema.Struct({
  interactionId: Id,
  cause: Schema.Literal("abort"),
});
export type InteractionReleaseArgs = typeof InteractionReleaseArgs.Type;
export const InteractionReleaseResult = reply(InteractionRecord, [
  "INTERACTION_NOT_FOUND",
  "INTERACTION_UNAVAILABLE",
]);
export type InteractionReleaseResult = typeof InteractionReleaseResult.Type;

export const TasksPublishArgs = Schema.Struct({ entryId: Id, seq: Nat, list: Todos });
export type TasksPublishArgs = typeof TasksPublishArgs.Type;
export const TasksPublishResult = reply(TaskView, ["INTERACTION_UNAVAILABLE"]);
export type TasksPublishResult = typeof TasksPublishResult.Type;

/** The session is the caller's, taken from identity: no argument. */
export const PlanModeGetArgs = Schema.Record(Schema.String, Schema.Never);
export type PlanModeGetArgs = typeof PlanModeGetArgs.Type;
/** Shared with the client read; a session never set reads inactive at revision 0. */
export const PlanModeGetResult = reply(PlanMode, [
  "INTERACTION_NOT_FOUND",
  "INTERACTION_UNAVAILABLE",
]);
export type PlanModeGetResult = typeof PlanModeGetResult.Type;

/** `cycle` is the only argument; a malformed slug is answered `invalid`, not refused here. */
export const AuditHistoryArgs = Schema.Struct({ cycle: Schema.String });
export type AuditHistoryArgs = typeof AuditHistoryArgs.Type;

const OptionalText = Schema.optionalKey(Schema.String);
const OptionalLines = Schema.optionalKey(Schema.Array(Schema.String));
/** The ported helper's fields; `settingsProblems` is replaced by the project facts' own problems. */
export const AuditHistoryResult = Schema.Union([
  Schema.Struct({ verdict: Schema.Literal("invalid"), reason: Text }),
  Schema.Struct({
    verdict: Schema.Literal("unverified"),
    reason: Text,
    cycle: OptionalText,
    record: OptionalText,
    planPath: OptionalText,
    role: Schema.optionalKey(Schema.NullOr(Schema.String)),
    suppliedBy: OptionalText,
    history: OptionalLines,
    baselinePointerChanges: OptionalLines,
    currentPlan: Schema.optionalKey(Schema.NullOr(Schema.String)),
    currentPlanSha256: Schema.optionalKey(Schema.NullOr(Sha256)),
    baseline: OptionalText,
    baselineCommit: OptionalText,
    baselinePlanPath: Schema.optionalKey(Schema.NullOr(Schema.String)),
    baselinePlan: Schema.optionalKey(Schema.NullOr(Schema.String)),
    baselinePlanSha256: Schema.optionalKey(Schema.NullOr(Sha256)),
    baselineGateHistory: Schema.optionalKey(Schema.NullOr(Schema.String)),
    planApprovalRecorded: Schema.optionalKey(Schema.Boolean),
    comparison: OptionalText,
    baselinePointerVerified: Schema.optionalKey(Schema.Boolean),
    projectProblems: OptionalLines,
  }),
  Schema.Struct({
    verdict: Schema.Literals(["plan-unchanged", "plan-changed"]),
    cycle: Schema.String,
    record: Schema.String,
    planPath: Schema.String,
    role: Schema.optionalKey(Schema.NullOr(Schema.String)),
    suppliedBy: OptionalText,
    history: Schema.Array(Schema.String),
    baselinePointerChanges: Schema.Array(Schema.String),
    currentPlan: Schema.String,
    currentPlanSha256: Sha256,
    baseline: Schema.String,
    baselineCommit: Schema.String,
    baselinePlanPath: Schema.String,
    baselinePlan: Schema.String,
    baselinePlanSha256: Sha256,
    baselineGateHistory: Schema.String,
    planApprovalRecorded: Schema.Literal(true),
    comparison: Schema.String,
    approvalCommit: Schema.String,
    approvalGateEntry: Schema.String,
    baselinePointerVerified: Schema.Literal(true),
    firstBaselinePointerCommit: Schema.String,
    historyHead: Schema.String,
    projectProblems: OptionalLines,
  }),
]);
export type AuditHistoryResult = typeof AuditHistoryResult.Type;

const OriginExpectation = Schema.Struct({
  kind: Schema.optionalKey(
    Schema.Literals(["answer", "plan-decision", "authorization", "mode-change"]),
  ),
  subject: Schema.optionalKey(
    Schema.Struct({
      type: Schema.optionalKey(Id),
      id: Schema.optionalKey(Id),
      revision: Schema.optionalKey(Sha256),
    }),
  ),
  sessionId: Schema.optionalKey(Id),
});
/** Read-only. `expect.sessionId` states what the origin must carry; it does not name the caller. */
export const OriginVerifyArgs = Schema.Struct({
  originId: Id,
  expect: Schema.optionalKey(OriginExpectation),
});
export type OriginVerifyArgs = typeof OriginVerifyArgs.Type;
/**
 * `ORIGIN_STALE` is a `subject.revision` that differs from the expected one; `ORIGIN_MISMATCH` names any other differing field.
 * `unavailable` is the XC-6 reply `INTERACTION_UNAVAILABLE`, never a result here: a caller treats it as "not a human decision".
 */
export const OriginVerifyResult = Schema.Union([
  Schema.Struct({ verified: Schema.Literal(true), origin: HumanOrigin }),
  Schema.Struct({ verified: Schema.Literal(false), code: Schema.Literal("ORIGIN_NOT_FOUND") }),
  Schema.Struct({
    verified: Schema.Literal(false),
    code: Schema.Literal("ORIGIN_MISMATCH"),
    field: Schema.Literals(["kind", "subject.type", "subject.id", "sessionId"]),
  }),
  Schema.Struct({ verified: Schema.Literal(false), code: Schema.Literal("ORIGIN_STALE") }),
]);
export type OriginVerifyResult = typeof OriginVerifyResult.Type;

const decodeCreate = Schema.decodeUnknownSync(InteractionCreateArgs, strict);
const decodeAwait = Schema.decodeUnknownSync(InteractionAwaitArgs, strict);
const decodeRelease = Schema.decodeUnknownSync(InteractionReleaseArgs, strict);
const decodeTasksPublish = Schema.decodeUnknownSync(TasksPublishArgs, strict);
const decodePlanModeGet = Schema.decodeUnknownSync(PlanModeGetArgs, strict);
const decodeAuditHistory = Schema.decodeUnknownSync(AuditHistoryArgs, strict);
const decodeOriginVerify = Schema.decodeUnknownSync(OriginVerifyArgs, strict);

/** Decode a request's untrusted arguments; any extra key (a caller, actor, root or repository among them) or wrong shape throws. */
export const decodeInteractionCreateArgs = (args: unknown): InteractionCreateArgs =>
  decodeCreate(args);
export const decodeInteractionAwaitArgs = (args: unknown): InteractionAwaitArgs =>
  decodeAwait(args);
export const decodeInteractionReleaseArgs = (args: unknown): InteractionReleaseArgs =>
  decodeRelease(args);
export const decodeTasksPublishArgs = (args: unknown): TasksPublishArgs => decodeTasksPublish(args);
export const decodePlanModeGetArgs = (args: unknown): PlanModeGetArgs => decodePlanModeGet(args);
export const decodeAuditHistoryArgs = (args: unknown): AuditHistoryArgs => decodeAuditHistory(args);
export const decodeOriginVerifyArgs = (args: unknown): OriginVerifyArgs => decodeOriginVerify(args);

export const QuestionEvidenceArgs = Schema.Struct({
  rootSessionId: Id,
  askCallId: Id,
  askerSessionId: Schema.optionalKey(Id),
});
export type QuestionEvidenceArgs = typeof QuestionEvidenceArgs.Type;

const QuestionEvidence = Schema.Struct({
  state: InteractionState,
  /** True only for state `answered` with a verified human origin; an agent's report never sets it. */
  answered: Schema.Boolean,
  startedAt: IsoUtc,
  answeredAt: Schema.optionalKey(IsoUtc),
  answers: Schema.optionalKey(AnswerList),
  originId: Schema.optionalKey(Id),
  interactionId: Id,
  /** Several children asked with this call id and no asker was named: nothing is answered. */
  ambiguous: Schema.optionalKey(Schema.Boolean),
}).check(
  Schema.makeFilter((evidence) => {
    if (evidence.answered) {
      if (evidence.state !== "answered") return "answered is true only for state answered";
      if (
        evidence.originId === undefined ||
        evidence.answers === undefined ||
        evidence.answeredAt === undefined
      ) {
        return "an answered evidence names its origin, answers and time";
      }
    }
    if (evidence.ambiguous === true && evidence.answered)
      return "an ambiguous match is not answered";
    return true;
  }),
);
/** `unavailable` is first-class: a failure here is never read as "not answered". */
export const QuestionEvidenceResult = reply(QuestionEvidence, [
  "INTERACTION_NOT_FOUND",
  "INTERACTION_UNAVAILABLE",
]);
export type QuestionEvidenceResult = typeof QuestionEvidenceResult.Type;

/** XC-18 (C7): the actor, scopes and authentication time come from T3's connection, never from these payloads. */
export const InteractionsSnapshotPayload = Schema.Struct({ rootSessionId: Id });
export type InteractionsSnapshotPayload = typeof InteractionsSnapshotPayload.Type;
export const InteractionsSnapshotResult = reply(
  Schema.Struct({
    rootSessionId: Id,
    version: Nat,
    interactions: Schema.Array(InteractionRecord),
  }),
  ["INTERACTION_NOT_FOUND", "INTERACTION_UNAVAILABLE"],
);
export type InteractionsSnapshotResult = typeof InteractionsSnapshotResult.Type;

export const PlanModeGetPayload = Schema.Struct({ sessionId: Id });
export type PlanModeGetPayload = typeof PlanModeGetPayload.Type;

export const TasksGetPayload = Schema.Struct({ sessionId: Id });
export type TasksGetPayload = typeof TasksGetPayload.Type;
/** `null` is "nothing published yet"; an unreadable view is `INTERACTION_UNAVAILABLE`, never an empty list. */
export const TasksGetResult = reply(Schema.NullOr(TaskView), [
  "INTERACTION_NOT_FOUND",
  "INTERACTION_UNAVAILABLE",
]);
export type TasksGetResult = typeof TasksGetResult.Type;

export const InteractionsChangesPayload = Schema.Struct({ rootSessionId: Id });
export type InteractionsChangesPayload = typeof InteractionsChangesPayload.Type;
/** A push only prompts a fresh snapshot; a client that missed a version re-reads. Versions rise by one per recorded event. */
export const InteractionsChangeEvent = Schema.Struct({ rootSessionId: Id, version: PositiveInt });
export type InteractionsChangeEvent = typeof InteractionsChangeEvent.Type;

/** `revision` is the content revision the human saw (D6); a mismatch is `INTERACTION_STALE_REVISION`. */
export const InteractionsAnswerPayload = Schema.Struct({
  interactionId: Id,
  revision: Sha256,
  answers: AnswerList,
});
export type InteractionsAnswerPayload = typeof InteractionsAnswerPayload.Type;
export const InteractionsCancelPayload = Schema.Struct({
  interactionId: Id,
  revision: Sha256,
  feedback: Schema.optionalKey(Schema.String),
});
export type InteractionsCancelPayload = typeof InteractionsCancelPayload.Type;
export const InteractionsHoldPayload = Schema.Struct({ interactionId: Id, revision: Sha256 });
export type InteractionsHoldPayload = typeof InteractionsHoldPayload.Type;
export const InteractionsClosePayload = Schema.Struct({ interactionId: Id, revision: Sha256 });
export type InteractionsClosePayload = typeof InteractionsClosePayload.Type;
export const PlanDecidePayload = Schema.Struct({
  interactionId: Id,
  revision: Sha256,
  decision: Schema.Literals(["approved", "changes_requested"]),
  feedback: Schema.optionalKey(Schema.String),
});
export type PlanDecidePayload = typeof PlanDecidePayload.Type;
export const PlanModeSetPayload = Schema.Struct({
  sessionId: Id,
  active: Schema.Boolean,
  expectedModeRevision: Nat,
});
export type PlanModeSetPayload = typeof PlanModeSetPayload.Type;
/** The decision is always approval and M06 derives the root; the client names the subject it saw and the session it grants for. */
export const AuthorizationGrantPayload = Schema.Struct({ subject: Subject, sessionId: Id });
export type AuthorizationGrantPayload = typeof AuthorizationGrantPayload.Type;

/** The reply to answer, cancel, hold, close and plan.decide: the updated record, or a coded failure. */
export const InteractionActionResult = reply(InteractionRecord, [
  "INTERACTION_NOT_FOUND",
  "INTERACTION_ORIGIN_NOT_HUMAN",
  "INTERACTION_ALREADY_SETTLED",
  "INTERACTION_STALE_REVISION",
  "INTERACTION_ANSWER_INVALID",
  "INTERACTION_UNAVAILABLE",
  "INTERACTION_DELIVERY_FAILED",
]);
export type InteractionActionResult = typeof InteractionActionResult.Type;
export const PlanModeSetResult = reply(PlanMode, [
  "INTERACTION_STALE_REVISION",
  "INTERACTION_NOT_FOUND",
  "INTERACTION_ORIGIN_NOT_HUMAN",
  "INTERACTION_UNAVAILABLE",
]);
export type PlanModeSetResult = typeof PlanModeSetResult.Type;
/** The `originId` goes to the client to pass to M07, never to an Agent. */
export const AuthorizationGrantResult = reply(Schema.Struct({ originId: Id }), [
  "INTERACTION_GRANT_INVALID",
  "INTERACTION_ORIGIN_NOT_HUMAN",
  "INTERACTION_UNAVAILABLE",
]);
export type AuthorizationGrantResult = typeof AuthorizationGrantResult.Type;
