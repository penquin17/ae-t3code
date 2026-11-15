// AETHERIA M07 Plan step 17 (D24, C8, XC-23): the strict client contracts of `aetheria.goal.*` and `aetheria.workflow.*`. A payload names a root session (and a goal reference, a proposal's fields, or the one
// grant's origin id) and never an actor, caller, scope, authority or user flag; the goal view never carries an origin id; every method is in the joined group and carries the strict wire option.
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcSchema from "effect/rpc/RpcSchema";
import { describe, expect, it } from "vite-plus/test";

import {
  AETHERIA_WS_METHODS,
  AetheriaRpcGroup,
  GOALS_CODE_CLASSES,
  GOAL_PASSTHROUGH_CODES,
  GoalChangeEvent,
  GoalChangesPayload,
  GoalClearPayload,
  GoalClearResult,
  GoalPausePayload,
  GoalPauseResult,
  GoalProposePayload,
  GoalProposeResult,
  GoalRearmPayload,
  GoalRearmResult,
  GoalSnapshotPayload,
  GoalSnapshotResult,
  GoalView,
  WORKFLOWS_CODE_CLASSES,
  WorkflowCancelPayload,
  WorkflowCancelResult,
  WorkflowRunsPayload,
  WorkflowRunsResult,
} from "./index.ts";

const strict = { onExcessProperty: "error" } as const;
const decode = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(schema as never, strict) as (input: unknown) => S["Type"];
const refuses = <S extends Schema.Top>(schema: S, input: unknown) =>
  expect(() => decode(schema)(input)).toThrow();

const VIEW = {
  goalId: "goal-1",
  revision: 2,
  objective: "ship the slice",
  phase: "active",
  roundsStarted: 1,
  maxRounds: 256,
  armed: false,
  needsRearm: true,
  rearm: {
    subject: { type: "goal-mutation", id: "goal-1:2:rearm", revision: "a".repeat(64) },
    text: "Re-arm goal goal-1",
  },
} as const;
const RUN = {
  runId: "run-1",
  name: "fan-out",
  state: "running",
  agentsStarted: 2,
  members: {
    pending: 0,
    started: 2,
    completed: 0,
    failed: 0,
    interrupted: 0,
    cancelled: 0,
    closed: 0,
  },
  startedAt: "2026-11-15T10:00:00Z",
} as const;

const METHODS = [
  [AETHERIA_WS_METHODS.goalSnapshot, "aetheria.goal.snapshot", GoalSnapshotPayload],
  [AETHERIA_WS_METHODS.goalChanges, "aetheria.goal.changes", GoalChangesPayload],
  [AETHERIA_WS_METHODS.goalPropose, "aetheria.goal.propose", GoalProposePayload],
  [AETHERIA_WS_METHODS.goalPause, "aetheria.goal.pause", GoalPausePayload],
  [AETHERIA_WS_METHODS.goalClear, "aetheria.goal.clear", GoalClearPayload],
  [AETHERIA_WS_METHODS.goalRearm, "aetheria.goal.rearm", GoalRearmPayload],
  [AETHERIA_WS_METHODS.workflowRuns, "aetheria.workflow.runs", WorkflowRunsPayload],
  [AETHERIA_WS_METHODS.workflowCancel, "aetheria.workflow.cancel", WorkflowCancelPayload],
] as const;

describe("the goal and workflow methods are methods of the Aetheria group", () => {
  it("names the eight namespaced methods and joins each to the group once, with the strict wire option", () => {
    for (const [actual, expected] of METHODS) {
      expect(actual).toBe(expected);
      const rpc = AetheriaRpcGroup.requests.get(actual);
      expect(rpc).toBeDefined();
      expect(Context.get(rpc!.annotations, Rpc.ParseOptions).onExcessProperty).toBe("error");
    }
    expect(new Set(AetheriaRpcGroup.requests.keys())).toEqual(
      new Set(Object.values(AETHERIA_WS_METHODS)),
    );
  });

  it("serves the change feed as a stream and every other method as one reply", () => {
    for (const [method] of METHODS) {
      const rpc = AetheriaRpcGroup.requests.get(method);
      expect(RpcSchema.isStreamSchema(rpc!.successSchema as Schema.Constraint)).toBe(
        method === AETHERIA_WS_METHODS.goalChanges,
      );
    }
  });
});

describe("the payloads name a root session and the goal reference, and nothing else", () => {
  it("decodes each valid payload and keeps exactly its fields", () => {
    expect(decode(GoalSnapshotPayload)({ rootSessionId: "root-1" })).toEqual({
      rootSessionId: "root-1",
    });
    expect(decode(GoalChangesPayload)({ rootSessionId: "root-1" })).toEqual({
      rootSessionId: "root-1",
    });
    const ref = { rootSessionId: "root-1", goalId: "goal-1", revision: 2 };
    expect(decode(GoalPausePayload)(ref)).toEqual(ref);
    expect(decode(GoalClearPayload)(ref)).toEqual(ref);
    expect(decode(GoalRearmPayload)({ ...ref, originId: "origin-1" })).toEqual({
      ...ref,
      originId: "origin-1",
    });
    expect(decode(WorkflowRunsPayload)({ rootSessionId: "root-1" })).toEqual({
      rootSessionId: "root-1",
    });
    expect(decode(WorkflowCancelPayload)({ rootSessionId: "root-1", runId: "run-1" })).toEqual({
      rootSessionId: "root-1",
      runId: "run-1",
    });
  });

  it("decodes every proposal operation, including a person's own complete and block (DV6)", () => {
    const base = { rootSessionId: "root-1" };
    expect(decode(GoalProposePayload)({ ...base, op: "create", objective: "do it" })).toMatchObject(
      { op: "create" },
    );
    expect(
      decode(GoalProposePayload)({ ...base, op: "create", objective: "do it", maxRounds: 5 }),
    ).toMatchObject({ maxRounds: 5 });
    const baseRef = { goalId: "goal-1", revision: 2 };
    for (const op of ["edit", "resume", "complete"] as const)
      expect(decode(GoalProposePayload)({ ...base, op, baseRef })).toMatchObject({ op });
    expect(
      decode(GoalProposePayload)({ ...base, op: "block", baseRef, reason: "no access" }),
    ).toMatchObject({ op: "block", reason: "no access" });
    refuses(GoalProposePayload, { ...base, op: "arm", baseRef });
    refuses(GoalProposePayload, { ...base, op: "pause", baseRef });
  });

  it("refuses an actor, caller, scope, authority, user, session or origin claim on every payload except the one re-arm origin", () => {
    const claims = [
      { actor: { clientSessionId: "x" } },
      { caller: { user: true } },
      { user: true },
      { scope: "orchestration:operate" },
      { authority: "trusted" },
      { sessionId: "pi-1" },
      { armed: true },
      { originId: "origin-1" },
    ];
    const valid: Array<readonly [Schema.Top, Record<string, unknown>]> = [
      [GoalSnapshotPayload, { rootSessionId: "root-1" }],
      [GoalChangesPayload, { rootSessionId: "root-1" }],
      [GoalProposePayload, { rootSessionId: "root-1", op: "create", objective: "x" }],
      [GoalPausePayload, { rootSessionId: "root-1", goalId: "g", revision: 1 }],
      [GoalClearPayload, { rootSessionId: "root-1", goalId: "g", revision: 1 }],
      [GoalRearmPayload, { rootSessionId: "root-1", goalId: "g", revision: 1, originId: "o" }],
      [WorkflowRunsPayload, { rootSessionId: "root-1" }],
      [WorkflowCancelPayload, { rootSessionId: "root-1", runId: "r" }],
    ];
    for (const [schema, payload] of valid)
      for (const claim of claims) {
        // the re-arm's own origin id is the one field a payload may carry
        if (schema === GoalRearmPayload && "originId" in claim) continue;
        refuses(schema, { ...payload, ...claim });
      }
  });

  it("refuses a missing field, an empty or non-integer value, a revision below one and a non-object", () => {
    refuses(GoalSnapshotPayload, {});
    refuses(GoalSnapshotPayload, { rootSessionId: "" });
    refuses(GoalPausePayload, { rootSessionId: "r", goalId: "g" });
    refuses(GoalPausePayload, { rootSessionId: "r", goalId: "g", revision: 0 });
    refuses(GoalPausePayload, { rootSessionId: "r", goalId: "g", revision: 1.5 });
    refuses(GoalRearmPayload, { rootSessionId: "r", goalId: "g", revision: 1 });
    refuses(GoalRearmPayload, { rootSessionId: "r", goalId: "g", revision: 1, originId: "" });
    refuses(GoalProposePayload, { rootSessionId: "r", op: "create", maxRounds: 0 });
    refuses(GoalProposePayload, { rootSessionId: "r", op: "edit", baseRef: { goalId: "g" } });
    refuses(WorkflowCancelPayload, { rootSessionId: "r" });
    for (const notAnObject of [null, "x", 1, []]) refuses(GoalSnapshotPayload, notAnObject);
  });
});

describe("the goal view", () => {
  it("decodes an exact view, with and without its optional parts", () => {
    expect(decode(GoalView)(VIEW)).toEqual(VIEW);
    const { rearm: _rearm, ...bare } = VIEW;
    expect(decode(GoalView)(bare)).toEqual(bare);
    const waiting = { ...bare, awaitingHuman: { proposalId: "p-1", interactionId: "i-1" } };
    expect(decode(GoalView)(waiting)).toEqual(waiting);
    const cut = { ...bare, interrupted: "backend-restarted" };
    expect(decode(GoalView)(cut)).toEqual(cut);
    const blocked = { ...bare, phase: "blocked", blocker: { code: "model-blocked", message: "x" } };
    expect(decode(GoalView)(blocked)).toEqual(blocked);
  });

  it("never carries an origin id, and refuses any other unknown key, at the top and inside the offer", () => {
    refuses(GoalView, { ...VIEW, originId: "origin-1" });
    refuses(GoalView, { ...VIEW, rearm: { ...VIEW.rearm, originId: "origin-1" } });
    refuses(GoalView, {
      ...VIEW,
      rearm: { ...VIEW.rearm, subject: { ...VIEW.rearm.subject, x: 1 } },
    });
    refuses(GoalView, { ...VIEW, extra: true });
  });

  it("refuses a malformed view: an unknown phase, a short digest, a zero revision, a negative round count", () => {
    refuses(GoalView, { ...VIEW, phase: "arming" });
    refuses(GoalView, {
      ...VIEW,
      rearm: { ...VIEW.rearm, subject: { ...VIEW.rearm.subject, revision: "abc" } },
    });
    refuses(GoalView, { ...VIEW, revision: 0 });
    refuses(GoalView, { ...VIEW, roundsStarted: -1 });
    refuses(GoalView, { ...VIEW, armed: "yes" });
  });
});

describe("the replies", () => {
  it("states the class of each Backend code and keeps the goal service's refusals as passthrough", () => {
    expect(GOALS_CODE_CLASSES).toEqual({
      GOALS_NOT_AUTHORIZED: "refusal",
      GOALS_DEVICE_REVOKED: "refusal",
      GOALS_NOT_FOUND: "absence",
      GOALS_UNAVAILABLE: "failure",
      GOALS_OUTCOME_UNKNOWN: "failure",
    });
    expect(Object.keys(WORKFLOWS_CODE_CLASSES)).toEqual([
      "WORKFLOWS_NOT_AUTHORIZED",
      "WORKFLOWS_DEVICE_REVOKED",
      "WORKFLOWS_NOT_FOUND",
      "WORKFLOWS_UNAVAILABLE",
      "WORKFLOWS_OUTCOME_UNKNOWN",
    ]);
    expect(GOAL_PASSTHROUGH_CODES).toContain("GOAL_STALE_REVISION");
    expect(GOAL_PASSTHROUGH_CODES).toContain("GOAL_ORIGIN_CONSUMED");
  });

  it("decodes each success shape", () => {
    expect(decode(GoalSnapshotResult)({ ok: true, value: { goal: VIEW, version: 5 } })).toEqual({
      ok: true,
      value: { goal: VIEW, version: 5 },
    });
    expect(decode(GoalSnapshotResult)({ ok: true, value: { goal: null, version: 0 } })).toEqual({
      ok: true,
      value: { goal: null, version: 0 },
    });
    expect(decode(GoalProposeResult)({ ok: true, value: { proposalId: "p-1" } })).toEqual({
      ok: true,
      value: { proposalId: "p-1" },
    });
    expect(decode(GoalPauseResult)({ ok: true, value: { goal: VIEW } })).toMatchObject({
      ok: true,
    });
    expect(decode(GoalRearmResult)({ ok: true, value: { goal: VIEW } })).toMatchObject({
      ok: true,
    });
    expect(decode(GoalClearResult)({ ok: true, value: { goal: null } })).toMatchObject({
      ok: true,
    });
    expect(
      decode(WorkflowRunsResult)({ ok: true, value: { runs: [RUN], version: 1 } }),
    ).toMatchObject({ ok: true });
    expect(decode(WorkflowCancelResult)({ ok: true, value: { run: RUN } })).toMatchObject({
      ok: true,
    });
  });

  it("a failure carries a code, and a stale refusal carries the current view or none", () => {
    expect(decode(GoalPauseResult)({ ok: false, code: "GOALS_OUTCOME_UNKNOWN" })).toEqual({
      ok: false,
      code: "GOALS_OUTCOME_UNKNOWN",
    });
    const stale = { ok: false, code: "GOAL_STALE_REVISION", detail: "at 3", current: VIEW };
    expect(decode(GoalPauseResult)(stale)).toEqual(stale);
    expect(
      decode(GoalPauseResult)({ ok: false, code: "GOAL_STALE_REVISION", current: null }),
    ).toMatchObject({ current: null });
    expect(
      decode(GoalRearmResult)({ ok: false, code: "ORIGIN_MISMATCH", field: "root" }),
    ).toMatchObject({
      field: "root",
    });
    expect(decode(GoalRearmResult)({ ok: false, code: "AUTH_NOT_MAIN" })).toMatchObject({
      ok: false,
    });
    expect(decode(WorkflowRunsResult)({ ok: false, code: "WORKFLOWS_UNAVAILABLE" })).toMatchObject({
      ok: false,
    });
  });

  it("refuses an invented code, a workflow code on a goal reply, a failure with a value, and a snapshot with unknown keys", () => {
    refuses(GoalSnapshotResult, { ok: false, code: "SOMETHING_ELSE" });
    refuses(GoalSnapshotResult, { ok: false, code: "WORKFLOWS_UNAVAILABLE" });
    refuses(GoalSnapshotResult, { ok: false, code: "AUTH_lower" });
    refuses(GoalSnapshotResult, { ok: false, code: "GOALS_UNAVAILABLE", value: {} });
    refuses(GoalSnapshotResult, { ok: true, value: { goal: null, version: 1, extra: 1 } });
    refuses(GoalSnapshotResult, { ok: true, value: { goal: null, version: -1 } });
    refuses(GoalClearResult, { ok: true, value: { goal: VIEW } });
    refuses(WorkflowRunsResult, { ok: false, code: "GOALS_UNAVAILABLE" });
    refuses(WorkflowRunsResult, {
      ok: true,
      value: { runs: [{ ...RUN, state: "paused" }], version: 1 },
    });
  });

  it("a push carries the root and a version and nothing else", () => {
    expect(decode(GoalChangeEvent)({ rootSessionId: "root-1", version: 3 })).toEqual({
      rootSessionId: "root-1",
      version: 3,
    });
    refuses(GoalChangeEvent, { rootSessionId: "root-1", version: 3, goal: VIEW });
    refuses(GoalChangeEvent, { rootSessionId: "root-1" });
  });
});
