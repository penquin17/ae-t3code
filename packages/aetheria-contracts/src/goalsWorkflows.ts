/* oxlint-disable t3code/no-low-value-comments -- The header and dividers state the wire contract: what a payload may name, what a reply says, and what an unknown outcome means. */
// AETHERIA M07 step 17 (D24, C8, XC-23) — `aetheria.goal.*` and `aetheria.workflow.*`: the goal strip's reads and human actions, and the workflow runs' read and cancel.
// A payload names a root session (and the goal reference, the proposal's fields, or the one grant's origin id) and never an actor, caller, scope, authority or user flag. The actor comes from the connection; the root's
// standing and the device session are re-checked on every call. A reply is `{ok:true,value}` or `{ok:false,code,detail?,field?,current?}`: `unavailable` codes mean nothing was done (a read found nothing),
// `GOALS_OUTCOME_UNKNOWN` (an action that threw) means the effect may have landed, so a client reads the snapshot and never resends. A stale reference answers `GOAL_STALE_REVISION` with the current view.
// The goal view never carries an origin id: only `goal.rearm` takes one, from the person's own grant, and no tool schema names it. `goal.propose` carries `complete` and `block` for a person's own stop (DV6) and
// returns the proposal id of the authorization card the goal service itself wrote; the view tells the client when it is awaiting a person. Imports nothing from `@t3tools/contracts` (see rpc.ts).
import * as Schema from "effect/Schema";

/** The Backend's own codes, with M12's class per code. */
export const GOALS_CODE_CLASSES = {
  GOALS_NOT_AUTHORIZED: "refusal",
  GOALS_DEVICE_REVOKED: "refusal",
  GOALS_NOT_FOUND: "absence",
  GOALS_UNAVAILABLE: "failure",
  GOALS_OUTCOME_UNKNOWN: "failure",
} as const;
export type GoalsCode = keyof typeof GOALS_CODE_CLASSES;

/** The goal service's refusals (C1/C2), passed through under their own names with the service's detail; M03's `AUTH_*` verdicts pass through by pattern. */
export const GOAL_PASSTHROUGH_CODES = [
  "GOAL_NOT_ROOT",
  "GOAL_NOT_FOUND",
  "GOAL_ALREADY_EXISTS",
  "GOAL_STALE_REVISION",
  "GOAL_INVALID_OBJECTIVE",
  "GOAL_INVALID_MAX_ROUNDS",
  "GOAL_INVALID_TRANSITION",
  "GOAL_ORIGIN_REQUIRED",
  "GOAL_ORIGIN_CONSUMED",
  "GOAL_NOT_AUTHORIZED",
  "ORIGIN_NOT_FOUND",
  "ORIGIN_STALE",
  "ORIGIN_MISMATCH",
] as const;
export type GoalPassthroughCode = (typeof GOAL_PASSTHROUGH_CODES)[number];

export const WORKFLOWS_CODE_CLASSES = {
  WORKFLOWS_NOT_AUTHORIZED: "refusal",
  WORKFLOWS_DEVICE_REVOKED: "refusal",
  WORKFLOWS_NOT_FOUND: "absence",
  WORKFLOWS_UNAVAILABLE: "failure",
  WORKFLOWS_OUTCOME_UNKNOWN: "failure",
} as const;
export type WorkflowsCode = keyof typeof WORKFLOWS_CODE_CLASSES;

/** The goal phases, the operations a person's card can carry, and the workflow states; the RPC method strings are in rpc.ts. */
const GOAL_PHASES = ["active", "paused", "blocked", "complete"] as const;
const GOAL_PROPOSAL_OPS = ["create", "edit", "resume", "complete", "block"] as const;
const WORKFLOW_RUN_STATES = ["running", "completed", "failed", "cancelled", "lost"] as const;

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Text = Schema.String.check(Schema.isMinLength(1));
const Nat = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const PositiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const Version = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

// ---------------------------------------------------------------------------------------------- the goal view (C8)

/** The re-arm offer: the exact subject and text a person's own grant must name. Never an origin id. */
const RearmOffer = Schema.Struct({
  subject: Schema.Struct({
    type: Schema.Literal("goal-mutation"),
    id: Id,
    revision: Schema.String.check(Schema.isMinLength(64), Schema.isMaxLength(64)),
  }),
  text: Text,
});

export const GoalView = Schema.Struct({
  goalId: Id,
  revision: PositiveInt,
  objective: Text,
  phase: Schema.Literals(GOAL_PHASES),
  roundsStarted: Nat,
  maxRounds: PositiveInt,
  blocker: Schema.optionalKey(Schema.Struct({ code: Id, message: Schema.String })),
  armed: Schema.Boolean,
  needsRearm: Schema.Boolean,
  awaitingHuman: Schema.optionalKey(Schema.Struct({ proposalId: Id, interactionId: Id })),
  interrupted: Schema.optionalKey(Schema.Literal("backend-restarted")),
  rearm: Schema.optionalKey(RearmOffer),
});
export type GoalView = typeof GoalView.Type;

// ---------------------------------------------------------------------------------------------- payloads

/** A read or the change stream names the root session only. */
export const GoalSnapshotPayload = Schema.Struct({ rootSessionId: Id });
export type GoalSnapshotPayload = typeof GoalSnapshotPayload.Type;
export const GoalChangesPayload = Schema.Struct({ rootSessionId: Id });
export type GoalChangesPayload = typeof GoalChangesPayload.Type;

const GoalRef = Schema.Struct({ goalId: Id, revision: PositiveInt });

/**
 * A request for a person's card, never an arming: the goal service writes the card, and only an approved decision verified for exactly that proposal changes the goal. `baseRef` names the goal and revision the
 * request is about (required for every operation but `create`; the service refuses a missing or stale one). `reason` is the blocked message of a `block`.
 */
export const GoalProposePayload = Schema.Struct({
  rootSessionId: Id,
  op: Schema.Literals(GOAL_PROPOSAL_OPS),
  objective: Schema.optionalKey(Text),
  maxRounds: Schema.optionalKey(PositiveInt),
  reason: Schema.optionalKey(Text),
  baseRef: Schema.optionalKey(GoalRef),
});
export type GoalProposePayload = typeof GoalProposePayload.Type;

/** Pause and clear need no human origin (U3): the root session's own stop of the goal at the named revision. */
export const GoalPausePayload = Schema.Struct({
  rootSessionId: Id,
  goalId: Id,
  revision: PositiveInt,
});
export type GoalPausePayload = typeof GoalPausePayload.Type;
export const GoalClearPayload = Schema.Struct({
  rootSessionId: Id,
  goalId: Id,
  revision: PositiveInt,
});
export type GoalClearPayload = typeof GoalClearPayload.Type;

/** The one client-only action that carries an origin id: the grant a person's own Re-arm click made for the snapshot's exact subject. One mutation consumes it. */
export const GoalRearmPayload = Schema.Struct({
  rootSessionId: Id,
  goalId: Id,
  revision: PositiveInt,
  originId: Id,
});
export type GoalRearmPayload = typeof GoalRearmPayload.Type;

export const WorkflowRunsPayload = Schema.Struct({ rootSessionId: Id });
export type WorkflowRunsPayload = typeof WorkflowRunsPayload.Type;
export const WorkflowCancelPayload = Schema.Struct({ rootSessionId: Id, runId: Id });
export type WorkflowCancelPayload = typeof WorkflowCancelPayload.Type;

// ---------------------------------------------------------------------------------------------- workflow runs

const MemberCounts = Schema.Struct({
  pending: Nat,
  started: Nat,
  completed: Nat,
  failed: Nat,
  interrupted: Nat,
  cancelled: Nat,
  closed: Nat,
});

/** One run as the strip shows it: phase, state, counts of its members by state, and how it ended. No script text, argument or child output. */
export const WorkflowRunView = Schema.Struct({
  runId: Id,
  name: Id,
  state: Schema.Literals(WORKFLOW_RUN_STATES),
  phase: Schema.optionalKey(Schema.String),
  agentsStarted: Nat,
  members: MemberCounts,
  startedAt: Schema.String,
  endedAt: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.String),
  /** True while a cancel has been asked for and the run has not yet written its one terminal fact: the run is still `running`, and its children and job are being stopped. */
  cancelRequested: Schema.optionalKey(Schema.Literal(true)),
});
export type WorkflowRunView = typeof WorkflowRunView.Type;

// ---------------------------------------------------------------------------------------------- replies

const GoalFailureCode = Schema.Union([
  Schema.Literals([...(Object.keys(GOALS_CODE_CLASSES) as GoalsCode[]), ...GOAL_PASSTHROUGH_CODES]),
  Schema.String.check(Schema.isPattern(/^AUTH_[A-Z0-9_]{1,80}$/)),
]);

/** A failure. `current` is the goal's view now, present when a stale reference was refused; `field` names the part of an origin check that failed. */
const GoalFailure = Schema.Struct({
  ok: Schema.Literal(false),
  code: GoalFailureCode,
  detail: Schema.optionalKey(Schema.String),
  field: Schema.optionalKey(Schema.String),
  current: Schema.optionalKey(Schema.NullOr(GoalView)),
});
const WorkflowFailure = Schema.Struct({
  ok: Schema.Literal(false),
  code: Schema.Literals(Object.keys(WORKFLOWS_CODE_CLASSES) as [WorkflowsCode, ...WorkflowsCode[]]),
  detail: Schema.optionalKey(Schema.String),
});
const goalReply = <S extends Schema.Top>(value: S) =>
  Schema.Union([Schema.Struct({ ok: Schema.Literal(true), value }), GoalFailure]);
const workflowReply = <S extends Schema.Top>(value: S) =>
  Schema.Union([Schema.Struct({ ok: Schema.Literal(true), value }), WorkflowFailure]);

/** `goal` is null when the root has none; `unavailable` is a failure, never "no goal". `version` rises with every change and only prompts a re-read. */
export const GoalSnapshotResult = goalReply(
  Schema.Struct({ goal: Schema.NullOr(GoalView), version: Version }),
);
export type GoalSnapshotResult = typeof GoalSnapshotResult.Type;

/** A proposal is a request for a card: the reply names the proposal and nothing about arming. The client reads the snapshot for the card and the outcome. */
export const GoalProposeResult = goalReply(Schema.Struct({ proposalId: Id }));
export type GoalProposeResult = typeof GoalProposeResult.Type;
export const GoalPauseResult = goalReply(Schema.Struct({ goal: GoalView }));
export type GoalPauseResult = typeof GoalPauseResult.Type;
export const GoalClearResult = goalReply(Schema.Struct({ goal: Schema.Null }));
export type GoalClearResult = typeof GoalClearResult.Type;
export const GoalRearmResult = goalReply(Schema.Struct({ goal: GoalView }));
export type GoalRearmResult = typeof GoalRearmResult.Type;

export const WorkflowRunsResult = workflowReply(
  Schema.Struct({
    runs: Schema.Array(WorkflowRunView),
    version: Version,
    /** How many run records could not be read: they may belong to this root, so the list is not claimed complete while this is above zero. */
    unreadable: Schema.optionalKey(Nat),
  }),
);
export type WorkflowRunsResult = typeof WorkflowRunsResult.Type;
export const WorkflowCancelResult = workflowReply(Schema.Struct({ run: WorkflowRunView }));
export type WorkflowCancelResult = typeof WorkflowCancelResult.Type;

/** A push names the root and a rising version; it carries no record. */
export const GoalChangeEvent = Schema.Struct({ rootSessionId: Id, version: Version });
export type GoalChangeEvent = typeof GoalChangeEvent.Type;
