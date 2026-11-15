// @effect-diagnostics globalTimers:off globalRandom:off globalDate:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
/* oxlint-disable t3code/no-low-value-comments -- The header and dividers state the authority order, the unknown-outcome rule and the version rule of the goal handlers. */
// AETHERIA M07 Plan step 17 (D4, D5, D24, C8, XC-23; IP-63 to IP-65) — the handlers behind `aetheria.goal.snapshot`, `.changes`, `.propose`, `.pause`, `.clear` and `.rearm`, and `aetheria.workflow.runs` and `.cancel`: the
// goal strip's reads and a person's actions over the Backend's goal service (`goals()`, in process, never an XC-6 bridge and never model input).
//
// Authority, in the order the checks run, on EVERY call: T3 authorizes the method's scope before a handler runs (reads and the change stream `orchestration:read`, the four actions `orchestration:operate`); the actor is
// built only from the connection (`connectionActor`); the device session is re-read from T3's persistent rows (a revoked, missing or expired one is refused, one that cannot be read is unavailable, never a pass); the
// scope is checked again; the named root session must not be a child (M03's identity record) and the host's one access rule (`interactions().canAccess`) must let the connection reach it. A root the connection may not
// reach reads as absent and reveals nothing. Only then does the goal service run, and it decides the rest: that the session is a main root (a child is `GOAL_NOT_ROOT`), the full M06 expectation of a grant, the approved
// decision, the derived root, the current revision and the unconsumed origin, all at the commit. The root is a Pi session id, never a T3 thread id.
//
// What a reply says. `goal.propose` only asks the service to write the card; the reply names the proposal and nothing about arming. `goal.pause` and `goal.clear` need no origin (U3). `goal.rearm` is the one action
// that carries an origin id, the client's own grant for the snapshot's exact subject; the service consumes it once and arms in the same line. A refusal passes the service's code and detail through; a stale reference carries
// the CURRENT view so a client never needs a second call to see it. A read that cannot be answered is `GOALS_UNAVAILABLE` (nothing was read). An action whose service answered `unavailable`, threw or answered a value that
// does not fit the contract is `GOALS_OUTCOME_UNKNOWN`: the service's own `unavailable` can follow a write that may have landed (a journal write that did not complete), so it is never read as "nothing changed" and the
// client reads the snapshot and never resends. Only a failure BEFORE the service (the Backend, the device check, the access rule) is `GOALS_UNAVAILABLE` for an action, and says nothing was done.
//
// The version. The goal service has no change feed, so the version is the handler's: per service instance and root, a counter that rises each time the snapshot's view differs from the last one this process saw (every
// snapshot read, every action's answer, and the stream's poll observe it), starting from the process start time so it also rises across a restart. It only prompts a re-read: a push carries the root and the version and no
// record. The stream polls the service at `GOAL_POLL_MS`, re-checks the device session, the scope and the root access at every poll, and ends when any of them fails, when the service is replaced (a restart) or when the
// Backend drains. A client that wants no gap subscribes first and then reads the snapshot: the baseline is taken at subscription, and any change after it arrives as a higher version.
//
// Workflow runs. The workflow Backend has not landed (M07 sub-phase 5), so both workflow methods run the same checks and then answer `WORKFLOWS_UNAVAILABLE`, naming that; the codec is final.
import {
  GoalChangeEvent,
  GoalClearResult,
  GoalPauseResult,
  GoalProposeResult,
  GoalRearmResult,
  GoalSnapshotResult,
  WorkflowCancelResult,
  WorkflowRunsResult,
  type GoalChangesPayload,
  type GoalClearPayload,
  type GoalPausePayload,
  type GoalProposePayload,
  type GoalRearmPayload,
  type GoalSnapshotPayload,
  type GoalView,
  type WorkflowCancelPayload,
  type WorkflowRunsPayload,
} from "@t3tools/aetheria-contracts";
import type { AetheriaBackendService, ClientActor } from "@t3tools/aetheria-server";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { standingOf } from "./humanControlRpc.ts";
import { OPERATE_SCOPE, READ_SCOPE, type GateScope } from "./rootGate.ts";

type Service = Pick<AetheriaBackendService, "interactions" | "identityKind" | "goals">;
export type Backend = Option.Option<Service>;
type GoalService = NonNullable<ReturnType<AetheriaBackendService["goals"]>>;

/** How often the change stream asks the goal service whether anything changed. */
const GOAL_POLL_MS = 1000;

interface Codes<C extends string> {
  readonly notAuthorized: C;
  readonly deviceRevoked: C;
  readonly notFound: C;
  readonly unavailable: C;
  readonly unknown: C;
}
const GOAL_CODES: Codes<
  | "GOALS_NOT_AUTHORIZED"
  | "GOALS_DEVICE_REVOKED"
  | "GOALS_NOT_FOUND"
  | "GOALS_UNAVAILABLE"
  | "GOALS_OUTCOME_UNKNOWN"
> = {
  notAuthorized: "GOALS_NOT_AUTHORIZED",
  deviceRevoked: "GOALS_DEVICE_REVOKED",
  notFound: "GOALS_NOT_FOUND",
  unavailable: "GOALS_UNAVAILABLE",
  unknown: "GOALS_OUTCOME_UNKNOWN",
};
const WORKFLOW_CODES: Codes<
  | "WORKFLOWS_NOT_AUTHORIZED"
  | "WORKFLOWS_DEVICE_REVOKED"
  | "WORKFLOWS_NOT_FOUND"
  | "WORKFLOWS_UNAVAILABLE"
  | "WORKFLOWS_OUTCOME_UNKNOWN"
> = {
  notAuthorized: "WORKFLOWS_NOT_AUTHORIZED",
  deviceRevoked: "WORKFLOWS_DEVICE_REVOKED",
  notFound: "WORKFLOWS_NOT_FOUND",
  unavailable: "WORKFLOWS_UNAVAILABLE",
  unknown: "WORKFLOWS_OUTCOME_UNKNOWN",
};

interface Failure<C extends string> {
  readonly ok: false;
  readonly code: C;
  readonly detail?: string;
  readonly field?: string;
  readonly current?: GoalView | null;
}
const fail = <C extends string>(code: C, detail: string): Failure<C> => ({
  ok: false,
  code,
  detail,
});

/** What the gate hands the work: the running service and the root, which the connection may reach. */
interface Opened {
  readonly service: Service;
  readonly root: string;
}

/**
 * The checks every call runs before the work: the device session, the scope, the Backend, the root's identity and the host's access rule. `nothing` finishes an `unavailable` detail so an action's refusal says it changed
 * nothing and a read's says it read nothing. `onThrow` is the reply when the work throws past its own handling.
 */
const guarded = <C extends string, A>(
  backend: Backend,
  actor: ClientActor,
  scope: GateScope,
  root: string,
  codes: Codes<C>,
  work: (opened: Opened) => Promise<A | Failure<C>>,
  onThrow: () => Failure<C>,
): Effect.Effect<A | Failure<C>> => {
  const nothing = scope === OPERATE_SCOPE ? "nothing was done" : "nothing was read";
  const unavailable = (detail: string) => fail(codes.unavailable, `${detail}; ${nothing}`);
  return standingOf(actor).pipe(
    Effect.flatMap((standing): Effect.Effect<A | Failure<C>> => {
      if (standing === "revoked")
        return Effect.succeed(
          fail(codes.deviceRevoked, "this connection's device session is revoked or expired"),
        );
      if (standing === "unreadable")
        return Effect.succeed(unavailable("the device session could not be checked"));
      if (!actor.grantedScopes.includes(scope))
        return Effect.succeed(fail(codes.notAuthorized, `this connection lacks ${scope}`));
      return Effect.promise(async (): Promise<A | Failure<C>> => {
        try {
          if (Option.isNone(backend)) return unavailable("the Backend is not running");
          const service = backend.value;
          const interactions = service.interactions();
          if (interactions === undefined)
            return unavailable("the host's access rule is not running");
          const kind = service.identityKind(root);
          if (kind === "child") return fail(codes.notFound, "not available to this connection");
          if (kind === "unavailable")
            return unavailable(
              "the root's identity record cannot be read, so it cannot be told from a child",
            );
          let reachable: boolean;
          try {
            reachable = await interactions.canAccess(actor, {
              sessionId: root,
              rootSessionId: root,
            });
          } catch {
            return unavailable("the host's access rule could not be asked");
          }
          if (!reachable) return fail(codes.notFound, "not available to this connection");
          return await work({ service, root });
        } catch {
          return onThrow();
        }
      });
    }),
  );
};

// ---------------------------------------------------------------------------------------------- reply decode and the version

const strict = { onExcessProperty: "error" } as const;
const decoder =
  <S extends Schema.Top>(schema: S) =>
  (input: unknown): S["Type"] =>
    Schema.decodeUnknownSync(schema as never, strict)(input) as S["Type"];
const asSnapshot = decoder(GoalSnapshotResult);
const asPropose = decoder(GoalProposeResult);
const asPause = decoder(GoalPauseResult);
const asClear = decoder(GoalClearResult);
const asRearm = decoder(GoalRearmResult);
const asRuns = decoder(WorkflowRunsResult);
const asCancel = decoder(WorkflowCancelResult);
const asEvent = decoder(GoalChangeEvent);

/** Where versions start: the process start, so a restarted Backend never repeats an old version. */
const VERSION_BASE = Date.now();
interface Tracker {
  fingerprint: string;
  version: number;
}
const trackers = new WeakMap<GoalService, Map<string, Tracker>>();

/** The version after observing this root's view now: unchanged when the view is the one seen last, else one higher. */
const observe = (service: GoalService, root: string, view: GoalView | null): number => {
  let roots = trackers.get(service);
  if (roots === undefined) {
    roots = new Map();
    trackers.set(service, roots);
  }
  const fingerprint = JSON.stringify(view);
  const seen = roots.get(root);
  if (seen === undefined) {
    roots.set(root, { fingerprint, version: VERSION_BASE });
    return VERSION_BASE;
  }
  if (seen.fingerprint !== fingerprint) {
    seen.fingerprint = fingerprint;
    seen.version += 1;
  }
  return seen.version;
};

// ---------------------------------------------------------------------------------------------- goal reads

/** The service's four outcomes, as every call returns them (none is thrown). */
type GoalServiceResult<V> =
  | { readonly status: "ok"; readonly value: V }
  | {
      readonly status: "refused";
      readonly code: string;
      readonly detail?: string;
      readonly field?: string;
    }
  | { readonly status: "awaiting-human"; readonly proposalId: string }
  | { readonly status: "unavailable"; readonly detail: string };

const goalsOf = (opened: Opened): GoalService | undefined => opened.service.goals();
const NOT_RUNNING = "the goal service is not running";

export const goalSnapshot = (
  backend: Backend,
  actor: ClientActor,
  payload: GoalSnapshotPayload,
): Effect.Effect<GoalSnapshotResult> =>
  guarded(
    backend,
    actor,
    READ_SCOPE,
    payload.rootSessionId,
    GOAL_CODES,
    async (opened): Promise<GoalSnapshotResult | Failure<"GOALS_UNAVAILABLE">> => {
      const goals = goalsOf(opened);
      if (goals === undefined) return fail("GOALS_UNAVAILABLE", `${NOT_RUNNING}; nothing was read`);
      const answered = (await goals.snapshot(opened.root)) as GoalServiceResult<{
        goal: GoalView | null;
      }>;
      if (answered.status === "ok")
        return asSnapshot({
          ok: true,
          value: {
            goal: answered.value.goal,
            version: observe(goals, opened.root, answered.value.goal),
          },
        });
      if (answered.status === "refused") return refusal(answered);
      return fail(
        "GOALS_UNAVAILABLE",
        `${answered.status === "unavailable" ? answered.detail : "the goal service gave no snapshot"}; nothing was read`,
      );
    },
    () => fail("GOALS_UNAVAILABLE", "the goal read failed; nothing was read"),
  ) as Effect.Effect<GoalSnapshotResult>;

/** The service's refusal as the contract's failure. The code is the service's, passed through whole. */
const refusal = (answered: {
  readonly code: string;
  readonly detail?: string;
  readonly field?: string;
}): Failure<string> => ({
  ok: false,
  code: answered.code,
  ...(answered.detail === undefined ? {} : { detail: answered.detail }),
  ...(answered.field === undefined ? {} : { field: answered.field }),
});

// ---------------------------------------------------------------------------------------------- goal actions

type Action = (goals: GoalService, root: string) => Promise<GoalServiceResult<unknown>>;

/**
 * One action: the gate, then exactly ONE service call. `onOk` shapes the committed value into the success reply; a stale-revision refusal carries the current view; a service `unavailable` is an unknown outcome (see
 * the header); a throw, or a value that does not fit, is an unknown outcome too. Nothing here retries.
 */
const act = <A>(
  backend: Backend,
  actor: ClientActor,
  root: string,
  run: Action,
  onOk: (value: unknown) => A,
): Effect.Effect<A | Failure<string>> =>
  guarded<string, A>(
    backend,
    actor,
    OPERATE_SCOPE,
    root,
    GOAL_CODES,
    async (opened) => {
      const goals = goalsOf(opened);
      if (goals === undefined) return fail("GOALS_UNAVAILABLE", `${NOT_RUNNING}; nothing was done`);
      const answered = await run(goals, opened.root);
      if (answered.status === "ok") {
        const shaped = onOk(answered.value);
        // the committed change is observed so the version rises for every client
        const after = await goals.snapshot(opened.root);
        if (after.status === "ok") observe(goals, opened.root, after.value.goal);
        return shaped;
      }
      if (answered.status === "refused") {
        const failure = refusal(answered);
        if (answered.code !== "GOAL_STALE_REVISION") return failure;
        const current = await goals.snapshot(opened.root);
        return current.status === "ok" ? { ...failure, current: current.value.goal } : failure;
      }
      return fail(
        "GOALS_OUTCOME_UNKNOWN",
        `${answered.status === "unavailable" ? answered.detail : "the goal service gave no outcome"}; the change may or may not have landed, so read the snapshot and do not resend`,
      );
    },
    () =>
      fail(
        "GOALS_OUTCOME_UNKNOWN",
        "the goal service failed while the change may have been written, so read the snapshot and do not resend",
      ),
  );

export const goalPropose = (
  backend: Backend,
  actor: ClientActor,
  payload: GoalProposePayload,
): Effect.Effect<GoalProposeResult> =>
  act(
    backend,
    actor,
    payload.rootSessionId,
    async (goals, root) => {
      const answered = await goals.propose(root, {
        op: payload.op,
        ...(payload.objective === undefined ? {} : { objective: payload.objective }),
        ...(payload.maxRounds === undefined ? {} : { maxRounds: payload.maxRounds }),
        ...(payload.reason === undefined ? {} : { reason: payload.reason }),
        ...(payload.baseRef === undefined ? {} : { baseRef: payload.baseRef }),
      });
      // A proposal answers `awaiting-human`: the card is written and nothing is armed. Any other `ok` would be a service contract break.
      return answered.status === "awaiting-human"
        ? { status: "ok", value: { proposalId: answered.proposalId } }
        : (answered as GoalServiceResult<unknown>);
    },
    (value) => asPropose({ ok: true, value }),
  ).pipe(Effect.map((reply) => reply as GoalProposeResult));

export const goalPause = (
  backend: Backend,
  actor: ClientActor,
  payload: GoalPausePayload,
): Effect.Effect<GoalPauseResult> =>
  act(
    backend,
    actor,
    payload.rootSessionId,
    (goals, root) =>
      goals.pause(root, { goalId: payload.goalId, revision: payload.revision }) as Promise<
        GoalServiceResult<unknown>
      >,
    (goal) => asPause({ ok: true, value: { goal } }),
  ).pipe(Effect.map((reply) => reply as GoalPauseResult));

export const goalClear = (
  backend: Backend,
  actor: ClientActor,
  payload: GoalClearPayload,
): Effect.Effect<GoalClearResult> =>
  act(
    backend,
    actor,
    payload.rootSessionId,
    (goals, root) =>
      goals.clear(root, { goalId: payload.goalId, revision: payload.revision }) as Promise<
        GoalServiceResult<unknown>
      >,
    () => asClear({ ok: true, value: { goal: null } }),
  ).pipe(Effect.map((reply) => reply as GoalClearResult));

/** The client's own grant for the snapshot's exact subject: the origin id goes to the service only, which verifies the whole expectation and consumes it once. */
export const goalRearm = (
  backend: Backend,
  actor: ClientActor,
  payload: GoalRearmPayload,
): Effect.Effect<GoalRearmResult> =>
  act(
    backend,
    actor,
    payload.rootSessionId,
    (goals, root) =>
      goals.rearm(root, {
        goalId: payload.goalId,
        revision: payload.revision,
        originId: payload.originId,
      }) as Promise<GoalServiceResult<unknown>>,
    (goal) => asRearm({ ok: true, value: { goal } }),
  ).pipe(Effect.map((reply) => reply as GoalRearmResult));

// ---------------------------------------------------------------------------------------------- the change stream

interface Live {
  readonly kind: "live";
  readonly goals: GoalService;
  readonly version: number;
}
type Sighting = Live | { readonly kind: "skip" } | { readonly kind: "end" };
const END: Sighting = { kind: "end" };

/** One observation: the standing, the scope, the root access and the goal service now. `end` stops the stream; `skip` is a poll that could not read and says nothing. */
const sight = (backend: Backend, actor: ClientActor, root: string): Effect.Effect<Sighting> =>
  standingOf(actor).pipe(
    Effect.flatMap((standing): Effect.Effect<Sighting> => {
      if (standing !== "active" || !actor.grantedScopes.includes(READ_SCOPE))
        return Effect.succeed(END);
      return Effect.promise(async (): Promise<Sighting> => {
        try {
          if (Option.isNone(backend)) return END;
          const service = backend.value;
          const interactions = service.interactions();
          const goals = service.goals();
          if (interactions === undefined || goals === undefined) return END;
          if (service.identityKind(root) !== "not-child") return END;
          if (!(await interactions.canAccess(actor, { sessionId: root, rootSessionId: root })))
            return END;
          const answered = await goals.snapshot(root);
          if (answered.status !== "ok") return { kind: "skip" };
          return { kind: "live", goals, version: observe(goals, root, answered.value.goal) };
        } catch {
          return END;
        }
      });
    }),
  );

/** The change stream: `{rootSessionId, version}` and nothing else, for a connection that may read the root; it ends the moment any check fails. */
export const goalChanges = (
  backend: Backend,
  actor: ClientActor,
  payload: GoalChangesPayload,
  pollMs: number = GOAL_POLL_MS,
): Stream.Stream<GoalChangeEvent> =>
  Stream.unwrap(
    sight(backend, actor, payload.rootSessionId).pipe(
      Effect.map((baseline): Stream.Stream<GoalChangeEvent> => {
        if (baseline.kind !== "live") return Stream.empty;
        const instance = baseline.goals;
        let emitted = baseline.version;
        const poll = Effect.sleep(Duration.millis(pollMs)).pipe(
          Effect.andThen(sight(backend, actor, payload.rootSessionId)),
        );
        return Stream.fromEffectRepeat(poll).pipe(
          // a different service is a restarted Backend: its versions are not comparable, so the client resubscribes
          Stream.takeWhile(
            (seen) => seen.kind !== "end" && (seen.kind !== "live" || seen.goals === instance),
          ),
          Stream.filter((seen): seen is Live => seen.kind === "live" && seen.version > emitted),
          Stream.map((seen) => {
            emitted = seen.version;
            return asEvent({ rootSessionId: payload.rootSessionId, version: seen.version });
          }),
        );
      }),
    ),
  );

// ---------------------------------------------------------------------------------------------- workflow runs (the workflow Backend has not landed)

const WORKFLOWS_NOT_CONNECTED =
  "the workflow runs are not connected yet (M07 sub-phase 5); the contract is final";

export const workflowRuns = (
  backend: Backend,
  actor: ClientActor,
  payload: WorkflowRunsPayload,
): Effect.Effect<WorkflowRunsResult> =>
  guarded(
    backend,
    actor,
    READ_SCOPE,
    payload.rootSessionId,
    WORKFLOW_CODES,
    async () => fail("WORKFLOWS_UNAVAILABLE", `${WORKFLOWS_NOT_CONNECTED}; nothing was read`),
    () => fail("WORKFLOWS_UNAVAILABLE", "the workflow read failed; nothing was read"),
  ).pipe(Effect.map((reply) => asRuns(reply)));

export const workflowCancel = (
  backend: Backend,
  actor: ClientActor,
  payload: WorkflowCancelPayload,
): Effect.Effect<WorkflowCancelResult> =>
  guarded(
    backend,
    actor,
    OPERATE_SCOPE,
    payload.rootSessionId,
    WORKFLOW_CODES,
    async () => fail("WORKFLOWS_UNAVAILABLE", `${WORKFLOWS_NOT_CONNECTED}; nothing was done`),
    () => fail("WORKFLOWS_OUTCOME_UNKNOWN", "the cancel failed; read the runs and do not resend"),
  ).pipe(Effect.map((reply) => asCancel(reply)));
