// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
/* oxlint-disable t3code/no-low-value-comments, t3code/no-manual-effect-runtime-in-tests, t3code/no-real-time-wait-in-tests -- The change stream polls on the real clock through a 10 ms test seam, and its cases start the stream, change the goal, then await the push. */
// AETHERIA M07 Plan step 17 (D4, D5, D24, C8, XC-23; IP-63 to IP-65) — the handlers behind `aetheria.goal.*` and `aetheria.workflow.*`.
//
// Boundary: `goalsRpc.ts` over the REAL goal service and store of the installed `@aetheria/goals` archive (a real temporary state root; goals/testkit.ts), with the connection's REAL per-call device check (a fake
// `auth_sessions` row store) and a FAKE host access rule and identity kind. SCRIPTED: the session resolver, M06's card and grant (the verification compares the full subject; an origin id is only ever made by the test's
// own `grant` or `approve`), M05's admission and settles, T3's receipt and the notices. It shows: the checks run in order on every call (device session, scope, root identity and access) before the service is touched; a
// refused call changes nothing (no card, no state change, no admission); a proposal writes one card and arms nothing; a person's own complete and block run the same card (DV6); pause and clear need no origin; re-arm
// verifies the whole expectation at the commit, consumes the origin once, arms once and admits no turn by itself; a stale reference gets the current view; a throwing, `unavailable` or non-conforming service answer to an
// action is an unknown outcome, never "nothing changed"; the version rises with each change; the stream re-checks the connection at every poll and ends when any check fails; the workflow methods run the same checks, then
// call the run service (the archive's REAL ledger and run service through the REAL workflows registration, over a scripted M05 direct API): not running is unavailable, a run of another root is not found, an unfinished
// cancel is an unknown outcome, and a read-scope connection cannot cancel. It does NOT show T3's real session store (the `standingOf` chain), the real WebSocket decode (the contract test shows the strict wire option), the real thread index or M03 identity files, or the web.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import type { GoalView, Xc6OperationContext } from "@t3tools/aetheria-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { afterEach } from "vite-plus/test";

import type { GoalsRuntime } from "../../../../packages/aetheria-server/src/goals/factory.ts";
import {
  CHILD,
  MAIN,
  approveLast,
  runtimeOf,
  world,
} from "../../../../packages/aetheria-server/src/goals/testkit.ts";
import type { OrchestrationDirectApi } from "../../../../packages/aetheria-server/src/orchestration.ts";
import { createWorkflowRunsPorts } from "../../../../packages/aetheria-server/src/workflows/ports.ts";
import { createWorkflowsBackendRegistration } from "../../../../packages/aetheria-server/src/workflows/registration.ts";
import { AuthSessionRepository } from "../persistence/AuthSessions.ts";
import {
  goalChanges,
  goalClear,
  goalPause,
  goalPropose,
  goalRearm,
  goalSnapshot,
  workflowCancel,
  workflowRuns,
} from "./goalsRpc.ts";
import { connectionActor } from "./humanControlRpc.ts";

type Session = { sessionId: string; scopes: ReadonlyArray<string> };
const BOTH: Session = {
  sessionId: "device-1",
  scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
};
const READ_ONLY: Session = { sessionId: "device-1", scopes: [AuthOrchestrationReadScope] };
const OPERATE_ONLY: Session = { sessionId: "device-1", scopes: [AuthOrchestrationOperateScope] };
const DENIED = "session-denied";

type Row = { revokedAt: unknown; expiresAt: DateTime.Utc };
interface Device {
  state: "live" | "revoked" | "unreadable";
}
const rowRepo = (device: Device) =>
  Layer.succeed(AuthSessionRepository, {
    getById: () =>
      device.state === "unreadable"
        ? Effect.fail("unreadable")
        : Effect.succeedSome<Row>({
            revokedAt: device.state === "revoked" ? "2026-11-15T00:00:00Z" : null,
            expiresAt: DateTime.makeUnsafe("2099-01-01T00:00:00.000Z"),
          }),
  } as never);

const live: Array<{ runtime: GoalsRuntime; release: () => void }> = [];
afterEach(async () => {
  for (const { runtime, release } of live.splice(0)) {
    release();
    runtime.service.stop();
    await runtime.service.idle();
  }
});

interface Options {
  readonly kinds?: Record<string, "not-child" | "child" | "unavailable">;
  readonly noInteractions?: boolean;
  readonly noGoals?: boolean;
  readonly noBackend?: boolean;
  /** A stand-in for the goal service (the fault cases); absent: the real one. */
  readonly goals?: unknown;
  /** The workflow run service the Backend hands out; absent: `workflows()` answers undefined (the module is not running). */
  readonly workflows?: unknown;
  readonly blockedAfter?: number;
}

/** The real goal runtime, started, behind the Backend facts the handlers read. */
const setup = async (options: Options = {}) => {
  const w = world();
  const runtime = runtimeOf(w, {
    defaultMaxRounds: 5,
    blockedAfterConsecutiveRounds: options.blockedAfter ?? 1,
  });
  live.push({ runtime, release: w.release });
  await runtime.service.start();
  const calls: string[] = [];
  const device: Device = { state: "live" };
  const interactions = {
    canAccess: async (_actor: unknown, target: { rootSessionId: string }) => {
      calls.push("canAccess");
      return target.rootSessionId !== DENIED;
    },
  };
  const backend = options.noBackend
    ? Option.none()
    : Option.some({
        identityKind: (sessionId: string) => {
          calls.push("identityKind");
          return options.kinds?.[sessionId] ?? (sessionId === CHILD ? "child" : "not-child");
        },
        interactions: () => (options.noInteractions ? undefined : interactions),
        goals: () => (options.noGoals ? undefined : (options.goals ?? runtime.service)),
        workflows: () => options.workflows,
      });
  return { w, runtime, device, calls, backend: backend as never };
};
type Setup = Awaited<ReturnType<typeof setup>>;

const withDevice = <A, E>(s: Setup, effect: Effect.Effect<A, E, AuthSessionRepository>) =>
  effect.pipe(Effect.provide(rowRepo(s.device)));
const actorOf = (session: Session = BOTH) => connectionActor(session as never);

interface Ok {
  readonly ok: true;
  readonly value: any;
}
interface Bad {
  readonly ok: false;
  readonly code: string;
  readonly detail?: string;
  readonly field?: string;
  readonly current?: GoalView | null;
}
const okOf = (reply: unknown): Ok => {
  expect(reply).toMatchObject({ ok: true });
  return reply as Ok;
};
const badOf = (reply: unknown, code: string): Bad => {
  expect(reply).toMatchObject({ ok: false, code });
  return reply as Bad;
};

/** The snapshot's goal view (a real read through the handler). */
const viewOf = (s: Setup) =>
  Effect.gen(function* () {
    const reply = okOf(yield* goalSnapshot(s.backend, yield* actorOf(), { rootSessionId: MAIN }));
    return reply.value as { goal: GoalView | null; version: number };
  });

/** A goal made through a card a person approved. */
const armed = (s: Setup) =>
  Effect.gen(function* () {
    const proposed = okOf(
      yield* goalPropose(s.backend, yield* actorOf(), {
        rootSessionId: MAIN,
        op: "create",
        objective: "ship it",
        maxRounds: 3,
      }),
    );
    expect(proposed.value).toEqual({ proposalId: expect.any(String) });
    yield* Effect.promise(() => approveLast(s.w, s.runtime));
    const { goal } = yield* viewOf(s);
    if (goal === null) throw new Error("no goal");
    return goal;
  });

/** What the state looks like to a test that wants to know nothing changed. */
const picture = (s: Setup) => ({ cards: s.w.cards.size, admits: s.w.admits.length });

describe("every call is checked before the goal service is touched", () => {
  it.effect(
    "a revoked device session is refused with its own code for every goal method, and nothing is written",
    () =>
      Effect.gen(function* () {
        const s = yield* Effect.promise(() => setup());
        const actor = yield* withDevice(s, actorOf());
        const goal = yield* withDevice(s, armed(s));
        s.device.state = "revoked";
        const before = picture(s);
        const verifiedBefore = s.w.verified.length;
        const ref = { rootSessionId: MAIN, goalId: goal.goalId, revision: goal.revision };
        for (const reply of [
          yield* withDevice(s, goalSnapshot(s.backend, actor, { rootSessionId: MAIN })),
          yield* withDevice(
            s,
            goalPropose(s.backend, actor, { rootSessionId: MAIN, op: "create", objective: "x" }),
          ),
          yield* withDevice(s, goalPause(s.backend, actor, ref)),
          yield* withDevice(s, goalClear(s.backend, actor, ref)),
          yield* withDevice(s, goalRearm(s.backend, actor, { ...ref, originId: "origin-1" })),
        ])
          badOf(reply, "GOALS_DEVICE_REVOKED");
        expect(picture(s)).toEqual(before);
        expect(s.w.verified).toHaveLength(verifiedBefore);
        s.device.state = "live";
        expect((yield* withDevice(s, viewOf(s))).goal).toMatchObject({
          phase: "active",
          armed: true,
        });
      }),
  );

  it.effect(
    "a device session that cannot be read is unavailable and says nothing was done; it is never a pass",
    () =>
      Effect.gen(function* () {
        const s = yield* Effect.promise(() => setup());
        s.device.state = "unreadable";
        const actor = yield* withDevice(s, actorOf());
        const action = badOf(
          yield* withDevice(
            s,
            goalPropose(s.backend, actor, { rootSessionId: MAIN, op: "create", objective: "x" }),
          ),
          "GOALS_UNAVAILABLE",
        );
        expect(action.detail).toContain("nothing was done");
        expect(
          badOf(
            yield* withDevice(s, goalSnapshot(s.backend, actor, { rootSessionId: MAIN })),
            "GOALS_UNAVAILABLE",
          ).detail,
        ).toContain("nothing was read");
        expect(s.w.cards.size).toBe(0);
      }),
  );

  it.effect(
    "the scope is checked again: a read needs orchestration:read and an action orchestration:operate",
    () =>
      Effect.gen(function* () {
        const s = yield* Effect.promise(() => setup());
        const readOnly = yield* withDevice(s, actorOf(READ_ONLY));
        const operateOnly = yield* withDevice(s, actorOf(OPERATE_ONLY));
        const ref = { rootSessionId: MAIN, goalId: "g", revision: 1 };
        badOf(
          yield* withDevice(
            s,
            goalPropose(s.backend, readOnly, { rootSessionId: MAIN, op: "create", objective: "x" }),
          ),
          "GOALS_NOT_AUTHORIZED",
        );
        badOf(yield* withDevice(s, goalPause(s.backend, readOnly, ref)), "GOALS_NOT_AUTHORIZED");
        badOf(yield* withDevice(s, goalClear(s.backend, readOnly, ref)), "GOALS_NOT_AUTHORIZED");
        badOf(
          yield* withDevice(s, goalRearm(s.backend, readOnly, { ...ref, originId: "o" })),
          "GOALS_NOT_AUTHORIZED",
        );
        badOf(
          yield* withDevice(s, goalSnapshot(s.backend, operateOnly, { rootSessionId: MAIN })),
          "GOALS_NOT_AUTHORIZED",
        );
        badOf(
          yield* withDevice(s, workflowRuns(s.backend, operateOnly, { rootSessionId: MAIN })),
          "WORKFLOWS_NOT_AUTHORIZED",
        );
        badOf(
          yield* withDevice(
            s,
            workflowCancel(s.backend, readOnly, { rootSessionId: MAIN, runId: "r" }),
          ),
          "WORKFLOWS_NOT_AUTHORIZED",
        );
        expect(s.w.cards.size).toBe(0);
        expect(s.calls).toEqual([]);
      }),
  );

  it.effect(
    "a root the connection may not reach, and a child, read as absent; an unreadable identity and a missing Backend are unavailable",
    () =>
      Effect.gen(function* () {
        const s = yield* Effect.promise(() => setup({ kinds: { "session-weird": "unavailable" } }));
        const actor = yield* withDevice(s, actorOf());
        for (const root of [DENIED, CHILD]) {
          badOf(
            yield* withDevice(s, goalSnapshot(s.backend, actor, { rootSessionId: root })),
            "GOALS_NOT_FOUND",
          );
          badOf(
            yield* withDevice(
              s,
              goalPropose(s.backend, actor, { rootSessionId: root, op: "create", objective: "x" }),
            ),
            "GOALS_NOT_FOUND",
          );
          badOf(
            yield* withDevice(s, workflowRuns(s.backend, actor, { rootSessionId: root })),
            "WORKFLOWS_NOT_FOUND",
          );
        }
        expect(
          badOf(
            yield* withDevice(
              s,
              goalSnapshot(s.backend, actor, { rootSessionId: "session-weird" }),
            ),
            "GOALS_UNAVAILABLE",
          ).detail,
        ).toContain("cannot be told from a child");
        expect(s.w.cards.size).toBe(0);

        for (const options of [
          { noBackend: true },
          { noInteractions: true },
          { noGoals: true },
        ] as const) {
          const broken = yield* Effect.promise(() => setup(options));
          const reply = badOf(
            yield* withDevice(
              broken,
              goalPropose(broken.backend, actor, {
                rootSessionId: MAIN,
                op: "create",
                objective: "x",
              }),
            ),
            "GOALS_UNAVAILABLE",
          );
          expect(reply.detail).toContain("nothing was done");
          expect(broken.w.cards.size).toBe(0);
        }
      }),
  );

  it.effect("the order is device, scope, then identity and access, then the service", () =>
    Effect.gen(function* () {
      const s = yield* Effect.promise(() => setup());
      const actor = yield* withDevice(s, actorOf());
      okOf(yield* withDevice(s, goalSnapshot(s.backend, actor, { rootSessionId: MAIN })));
      expect(s.calls).toEqual(["identityKind", "canAccess"]);
    }),
  );
});

describe("the snapshot and its version", () => {
  it.effect(
    "is no goal before one exists and the goal's view after, with a version that rises only when the view changes",
    () =>
      Effect.gen(function* () {
        const s = yield* Effect.promise(() => setup());
        const empty = yield* withDevice(s, viewOf(s));
        expect(empty.goal).toBeNull();
        expect((yield* withDevice(s, viewOf(s))).version).toBe(empty.version);
        const goal = yield* withDevice(s, armed(s));
        expect(goal).toMatchObject({
          revision: 1,
          objective: "ship it",
          phase: "active",
          armed: true,
          needsRearm: false,
          maxRounds: 3,
        });
        expect(JSON.stringify(goal)).not.toContain("origin-");
        const after = yield* withDevice(s, viewOf(s));
        expect(after.version).toBeGreaterThan(empty.version);
        expect((yield* withDevice(s, viewOf(s))).version).toBe(after.version);
      }),
  );

  it.effect(
    "a service that cannot answer is unavailable and a view that does not fit the contract is unavailable, never 'no goal'",
    () =>
      Effect.gen(function* () {
        const down = yield* Effect.promise(() =>
          setup({
            goals: { snapshot: async () => ({ status: "unavailable", detail: "corrupt journal" }) },
          }),
        );
        const actor = yield* withDevice(down, actorOf());
        const reply = badOf(
          yield* withDevice(down, goalSnapshot(down.backend, actor, { rootSessionId: MAIN })),
          "GOALS_UNAVAILABLE",
        );
        expect(reply.detail).toContain("corrupt journal");
        expect(reply.detail).toContain("nothing was read");
        const leaking = yield* Effect.promise(() =>
          setup({
            goals: {
              snapshot: async () => ({
                status: "ok",
                value: {
                  goal: {
                    goalId: "g",
                    revision: 1,
                    objective: "x",
                    phase: "active",
                    roundsStarted: 0,
                    maxRounds: 3,
                    armed: true,
                    needsRearm: false,
                    originId: "origin-leak",
                  },
                },
              }),
            },
          }),
        );
        const leak = badOf(
          yield* withDevice(leaking, goalSnapshot(leaking.backend, actor, { rootSessionId: MAIN })),
          "GOALS_UNAVAILABLE",
        );
        expect(JSON.stringify(leak)).not.toContain("origin-leak");
      }),
  );
});

describe("propose: a card, never an arming; a person's own complete and block take the same card (DV6)", () => {
  it.effect(
    "create writes one card, names the proposal, and the goal waits for a person (awaitingHuman) until the approval commits",
    () =>
      Effect.gen(function* () {
        const s = yield* Effect.promise(() => setup());
        const actor = yield* withDevice(s, actorOf());
        const reply = okOf(
          yield* withDevice(
            s,
            goalPropose(s.backend, actor, {
              rootSessionId: MAIN,
              op: "create",
              objective: "ship it",
            }),
          ),
        );
        expect(reply.value).toEqual({ proposalId: expect.any(String) });
        expect(s.w.cards.size).toBe(1);
        expect(s.runtime.service.isArmed(MAIN)).toBe(false);
        expect(s.w.admits).toEqual([]);
        expect((yield* withDevice(s, viewOf(s))).goal).toBeNull();
        yield* Effect.promise(() => approveLast(s.w, s.runtime));
        expect((yield* withDevice(s, viewOf(s))).goal).toMatchObject({
          armed: true,
          phase: "active",
        });
      }),
  );

  it.effect(
    "a refusal passes the service's code through, and a stale base reference carries the current view",
    () =>
      Effect.gen(function* () {
        const s = yield* Effect.promise(() => setup());
        const actor = yield* withDevice(s, actorOf());
        const goal = yield* withDevice(s, armed(s));
        badOf(
          yield* withDevice(
            s,
            goalPropose(s.backend, actor, {
              rootSessionId: MAIN,
              op: "create",
              objective: "again",
            }),
          ),
          "GOAL_ALREADY_EXISTS",
        );
        const cards = s.w.cards.size;
        const stale = badOf(
          yield* withDevice(
            s,
            goalPropose(s.backend, actor, {
              rootSessionId: MAIN,
              op: "edit",
              objective: "other",
              baseRef: { goalId: goal.goalId, revision: goal.revision + 3 },
            }),
          ),
          "GOAL_STALE_REVISION",
        );
        expect(stale.current).toEqual(goal);
        expect(s.w.cards.size).toBe(cards);
      }),
  );

  it.effect("a person's own complete is a card, and only the approval completes the goal", () =>
    Effect.gen(function* () {
      const s = yield* Effect.promise(() => setup());
      const actor = yield* withDevice(s, actorOf());
      const goal = yield* withDevice(s, armed(s));
      const proposed = okOf(
        yield* withDevice(
          s,
          goalPropose(s.backend, actor, {
            rootSessionId: MAIN,
            op: "complete",
            baseRef: { goalId: goal.goalId, revision: goal.revision },
          }),
        ),
      );
      expect(proposed.value.proposalId).toEqual(expect.any(String));
      expect((yield* withDevice(s, viewOf(s))).goal).toMatchObject({ phase: "active" });
      yield* Effect.promise(() => approveLast(s.w, s.runtime));
      expect((yield* withDevice(s, viewOf(s))).goal).toMatchObject({
        phase: "complete",
        armed: false,
        revision: goal.revision + 1,
      });
    }),
  );

  it.effect(
    "a person's own block needs its reason, runs the card, and records the reason as the blocker",
    () =>
      Effect.gen(function* () {
        const s = yield* Effect.promise(() => setup());
        const actor = yield* withDevice(s, actorOf());
        const goal = yield* withDevice(s, armed(s));
        const baseRef = { goalId: goal.goalId, revision: goal.revision };
        const cards = s.w.cards.size;
        badOf(
          yield* withDevice(
            s,
            goalPropose(s.backend, actor, { rootSessionId: MAIN, op: "block", baseRef }),
          ),
          "GOAL_INVALID_TRANSITION",
        );
        expect(s.w.cards.size).toBe(cards);
        okOf(
          yield* withDevice(
            s,
            goalPropose(s.backend, actor, {
              rootSessionId: MAIN,
              op: "block",
              baseRef,
              reason: "waiting on legal",
            }),
          ),
        );
        yield* Effect.promise(() => approveLast(s.w, s.runtime));
        expect((yield* withDevice(s, viewOf(s))).goal).toMatchObject({
          phase: "blocked",
          blocker: { code: "user-blocked", message: "waiting on legal" },
        });
      }),
  );
});

describe("pause and clear need no origin and enforce the reference at the commit", () => {
  it.effect(
    "pause stops and disarms, a stale pause changes nothing and shows the current view, clear removes the goal",
    () =>
      Effect.gen(function* () {
        const s = yield* Effect.promise(() => setup());
        const actor = yield* withDevice(s, actorOf());
        const goal = yield* withDevice(s, armed(s));
        const ref = { rootSessionId: MAIN, goalId: goal.goalId, revision: goal.revision };
        const stale = badOf(
          yield* withDevice(s, goalPause(s.backend, actor, { ...ref, revision: ref.revision + 1 })),
          "GOAL_STALE_REVISION",
        );
        expect(stale.current).toEqual(goal);
        expect(s.runtime.service.isArmed(MAIN)).toBe(true);
        const paused = okOf(yield* withDevice(s, goalPause(s.backend, actor, ref)));
        expect(paused.value.goal).toMatchObject({
          phase: "paused",
          armed: false,
          revision: goal.revision + 1,
        });
        expect(s.runtime.service.isArmed(MAIN)).toBe(false);
        // the old reference is stale now: a repeated pause (a lost-reply resend) changes nothing
        badOf(yield* withDevice(s, goalPause(s.backend, actor, ref)), "GOAL_STALE_REVISION");
        const cleared = okOf(
          yield* withDevice(
            s,
            goalClear(s.backend, actor, { ...ref, revision: goal.revision + 1 }),
          ),
        );
        expect(cleared.value).toEqual({ goal: null });
        expect((yield* withDevice(s, viewOf(s))).goal).toBeNull();
        badOf(yield* withDevice(s, goalClear(s.backend, actor, ref)), "GOAL_NOT_FOUND");
      }),
  );
});

describe("re-arm: one person's grant reaches exactly one mutation", () => {
  /** A goal paused, so a re-arm is offered; the view's exact subject and text. */
  const paused = (s: Setup) =>
    Effect.gen(function* () {
      const goal = yield* armed(s);
      const actor = yield* actorOf();
      okOf(
        yield* goalPause(s.backend, actor, {
          rootSessionId: MAIN,
          goalId: goal.goalId,
          revision: goal.revision,
        }),
      );
      const view = (yield* viewOf(s)).goal!;
      expect(view.rearm).toBeDefined();
      return view;
    });

  it.effect(
    "verifies the whole expectation, arms once, consumes the origin, and admits no turn by itself",
    () =>
      Effect.gen(function* () {
        const s = yield* Effect.promise(() => setup());
        const actor = yield* withDevice(s, actorOf());
        const view = yield* withDevice(s, paused(s));
        const originId = s.w.grant(view.rearm!.subject);
        const reply = okOf(
          yield* withDevice(
            s,
            goalRearm(s.backend, actor, {
              rootSessionId: MAIN,
              goalId: view.goalId,
              revision: view.revision,
              originId,
            }),
          ),
        );
        expect(reply.value.goal).toMatchObject({
          phase: "active",
          armed: true,
          revision: view.revision + 1,
        });
        expect(JSON.stringify(reply)).not.toContain(originId);
        expect(s.runtime.service.isArmed(MAIN)).toBe(true);
        expect(s.w.admits).toEqual([]);
        // the service verified this origin for the snapshot's own subject and the root's session
        expect(s.w.verified.at(-1)).toEqual({
          originId,
          subjectId: view.rearm!.subject.id,
          sessionId: MAIN,
        });
        // the same origin cannot arm again: stop the goal anew and replay it
        const again = (yield* withDevice(s, viewOf(s))).goal!;
        okOf(
          yield* withDevice(
            s,
            goalPause(s.backend, actor, {
              rootSessionId: MAIN,
              goalId: again.goalId,
              revision: again.revision,
            }),
          ),
        );
        const next = (yield* withDevice(s, viewOf(s))).goal!;
        const replay = yield* withDevice(
          s,
          goalRearm(s.backend, actor, {
            rootSessionId: MAIN,
            goalId: next.goalId,
            revision: next.revision,
            originId,
          }),
        );
        expect(replay).toMatchObject({ ok: false });
        expect(s.runtime.service.isArmed(MAIN)).toBe(false);
      }),
  );

  it.effect(
    "a grant for another subject, an unknown origin and a stale revision arm nothing and change no state",
    () =>
      Effect.gen(function* () {
        const s = yield* Effect.promise(() => setup());
        const actor = yield* withDevice(s, actorOf());
        const view = yield* withDevice(s, paused(s));
        const ref = { rootSessionId: MAIN, goalId: view.goalId, revision: view.revision };
        const wrongSubject = s.w.grant({ ...view.rearm!.subject, id: "other-goal:9:rearm" });
        const wrongDigest = s.w.grant({ ...view.rearm!.subject, revision: "f".repeat(64) });
        const before = (yield* withDevice(s, viewOf(s))).goal;
        expect(
          badOf(
            yield* withDevice(s, goalRearm(s.backend, actor, { ...ref, originId: wrongSubject })),
            "ORIGIN_MISMATCH",
          ).field,
        ).toBe("subject");
        badOf(
          yield* withDevice(s, goalRearm(s.backend, actor, { ...ref, originId: wrongDigest })),
          "ORIGIN_MISMATCH",
        );
        badOf(
          yield* withDevice(s, goalRearm(s.backend, actor, { ...ref, originId: "origin-forged" })),
          "ORIGIN_NOT_FOUND",
        );
        const good = s.w.grant(view.rearm!.subject);
        const stale = badOf(
          yield* withDevice(
            s,
            goalRearm(s.backend, actor, { ...ref, revision: ref.revision + 2, originId: good }),
          ),
          "GOAL_STALE_REVISION",
        );
        expect(stale.current).toEqual(before);
        expect(s.runtime.service.isArmed(MAIN)).toBe(false);
        expect((yield* withDevice(s, viewOf(s))).goal).toEqual(before);
        expect(s.w.admits).toEqual([]);
        // and the one valid grant still works afterwards, once
        okOf(yield* withDevice(s, goalRearm(s.backend, actor, { ...ref, originId: good })));
      }),
  );

  it.effect("two clients racing on one grant: exactly one arms, the other is refused", () =>
    Effect.gen(function* () {
      const s = yield* Effect.promise(() => setup());
      const actor = yield* withDevice(s, actorOf());
      const view = yield* withDevice(s, paused(s));
      const originId = s.w.grant(view.rearm!.subject);
      const call = goalRearm(s.backend, actor, {
        rootSessionId: MAIN,
        goalId: view.goalId,
        revision: view.revision,
        originId,
      });
      const replies = yield* withDevice(s, Effect.all([call, call], { concurrency: "unbounded" }));
      expect(replies.filter((r) => r.ok)).toHaveLength(1);
      expect(replies.filter((r) => !r.ok)).toHaveLength(1);
      expect((yield* withDevice(s, viewOf(s))).goal).toMatchObject({
        armed: true,
        revision: view.revision + 1,
      });
    }),
  );

  it.effect("a completed goal offers no re-arm and refuses one", () =>
    Effect.gen(function* () {
      const s = yield* Effect.promise(() => setup());
      const actor = yield* withDevice(s, actorOf());
      const goal = yield* withDevice(s, armed(s));
      okOf(
        yield* withDevice(
          s,
          goalPropose(s.backend, actor, {
            rootSessionId: MAIN,
            op: "complete",
            baseRef: { goalId: goal.goalId, revision: goal.revision },
          }),
        ),
      );
      yield* Effect.promise(() => approveLast(s.w, s.runtime));
      const view = (yield* withDevice(s, viewOf(s))).goal!;
      expect(view.phase).toBe("complete");
      expect(view.rearm).toBeUndefined();
      const originId = s.w.grant({
        type: "goal-mutation",
        id: `${view.goalId}:${view.revision}:rearm`,
        revision: "a".repeat(64),
      });
      badOf(
        yield* withDevice(
          s,
          goalRearm(s.backend, actor, {
            rootSessionId: MAIN,
            goalId: view.goalId,
            revision: view.revision,
            originId,
          }),
        ),
        "GOAL_INVALID_TRANSITION",
      );
      expect(s.runtime.service.isArmed(MAIN)).toBe(false);
    }),
  );
});

describe("an action's uncertain outcome stays unknown", () => {
  const view = {
    goalId: "g",
    revision: 2,
    objective: "x",
    phase: "paused",
    roundsStarted: 0,
    maxRounds: 3,
    armed: false,
    needsRearm: false,
  };
  const faulty = {
    pause: async () => {
      throw new Error("disk");
    },
    clear: async () => ({ status: "unavailable", detail: "the journal write did not complete" }),
    rearm: async () => ({ status: "ok", value: { ...view, originId: "origin-leak" } }),
    propose: async () => ({ status: "unavailable", detail: "the proposal could not be recorded" }),
    snapshot: async () => ({ status: "ok", value: { goal: view } }),
  };

  it.effect(
    "a throw, an unavailable answer and a value that does not fit are an unknown outcome, never 'nothing was done'",
    () =>
      Effect.gen(function* () {
        const s = yield* Effect.promise(() => setup({ goals: faulty }));
        const actor = yield* withDevice(s, actorOf());
        const ref = { rootSessionId: MAIN, goalId: "g", revision: 2 };
        for (const reply of [
          yield* withDevice(s, goalPause(s.backend, actor, ref)),
          yield* withDevice(s, goalClear(s.backend, actor, ref)),
          yield* withDevice(s, goalRearm(s.backend, actor, { ...ref, originId: "origin-1" })),
          yield* withDevice(
            s,
            goalPropose(s.backend, actor, { rootSessionId: MAIN, op: "create", objective: "x" }),
          ),
        ]) {
          const bad = badOf(reply, "GOALS_OUTCOME_UNKNOWN");
          expect(bad.detail).toMatch(/do not resend|may or may not/);
          expect(JSON.stringify(bad)).not.toContain("origin-leak");
        }
      }),
  );
});

describe("the change stream: a root and a version, re-checked at every poll", () => {
  const POLL = 10;
  const collect = (s: Setup, session: Session = BOTH, take = 1) =>
    Effect.runPromise(
      withDevice(
        s,
        Effect.gen(function* () {
          const actor = yield* actorOf(session);
          return yield* Stream.runCollect(
            goalChanges(s.backend, actor, { rootSessionId: MAIN }, POLL).pipe(Stream.take(take)),
          );
        }),
      ),
    );
  const pauseAfterBaseline = async (s: Setup) => {
    const goal = (await s.runtime.service.snapshot(MAIN)) as { value: { goal: GoalView } };
    await new Promise((resolve) => setTimeout(resolve, POLL * 4));
    return s.runtime.service.pause(MAIN, {
      goalId: goal.value.goal.goalId,
      revision: goal.value.goal.revision,
    });
  };

  it.live("pushes the root and a rising version when the goal changes, and nothing else", () =>
    Effect.gen(function* () {
      const s = yield* Effect.promise(() => setup());
      yield* withDevice(s, armed(s));
      const before = (yield* withDevice(s, viewOf(s))).version;
      const events = collect(s);
      yield* Effect.promise(() => pauseAfterBaseline(s));
      const received = Array.from(yield* Effect.promise(() => events));
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ rootSessionId: MAIN, version: expect.any(Number) });
      expect(received[0]!.version).toBeGreaterThan(before);
      expect(Object.keys(received[0]!).sort()).toEqual(["rootSessionId", "version"]);
    }),
  );

  it.live(
    "ends empty for a revoked device, a missing read scope, a root the connection may not reach, a child and a missing service",
    () =>
      Effect.gen(function* () {
        const revoked = yield* Effect.promise(() => setup());
        revoked.device.state = "revoked";
        expect(Array.from(yield* Effect.promise(() => collect(revoked)))).toEqual([]);
        const scoped = yield* Effect.promise(() => setup());
        expect(Array.from(yield* Effect.promise(() => collect(scoped, OPERATE_ONLY)))).toEqual([]);
        const none = yield* Effect.promise(() => setup({ noGoals: true }));
        expect(Array.from(yield* Effect.promise(() => collect(none)))).toEqual([]);
        const actor = yield* withDevice(scoped, actorOf());
        for (const root of [DENIED, CHILD])
          expect(
            Array.from(
              yield* withDevice(
                scoped,
                Stream.runCollect(
                  goalChanges(scoped.backend, actor, { rootSessionId: root }, POLL),
                ),
              ),
            ),
          ).toEqual([]);
      }),
  );

  it.live("ends when the device is revoked after it started, with no push", () =>
    Effect.gen(function* () {
      const s = yield* Effect.promise(() => setup());
      yield* withDevice(s, armed(s));
      const events = collect(s, BOTH, 5);
      yield* Effect.promise(async () => {
        await new Promise((resolve) => setTimeout(resolve, POLL * 3));
        s.device.state = "revoked";
      });
      expect(Array.from(yield* Effect.promise(() => events))).toEqual([]);
    }),
  );
});

// The REAL workflows registration (the installed archive's ledger and run service, in a temporary state root) over M05's direct API scripted as the drain test scripts it; its `runs()` is the service `workflows()` hands out.
const OTHER_ROOT = "s-other";
const RUN_MODULE = { id: "workflows-backend" };
const RUN_NOW = "2026-11-16T10:00:02.000Z";
const RUN_CAPS = {
  maxConcurrentAgents: 4,
  maxTotalAgents: 10,
  maxItemsPerCall: 20,
  syncTimeoutMs: 400,
};

const mountedRoots: string[] = [];
const mountedRegistrations: Array<ReturnType<typeof createWorkflowsBackendRegistration>> = [];
afterEach(async () => {
  for (const registration of mountedRegistrations.splice(0))
    await registration.activation.drain("test");
  for (const dir of mountedRoots.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

interface RunWorld {
  readonly calls: Array<{ op: string; id: string }>;
  /** A child close the test makes fail (by child id), so a cancel does not finish every step. */
  readonly failClose: Set<string>;
}

const runContext = (sessionId: string, args: Record<string, unknown>): Xc6OperationContext => ({
  caller: { threadId: "thread-1", providerSessionId: "runtime-1", providerInstanceId: "pi" },
  sessionId,
  kind: "main",
  rootSessionId: sessionId,
  args,
});

/** A started registration with one running run per root, each with one started child; returns its run service and the calls M05 saw. */
const liveRuns = async () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m07-rpc-runs-"));
  mountedRoots.push(dir);
  const w: RunWorld = { calls: [], failClose: new Set() };
  const direct = {
    listJobs: async () => ({
      ok: true,
      value: {
        jobs: [{ jobId: "job-1", label: "# workflow run-1 demo", state: "running" }],
        unreadable: 0,
      },
    }),
    killJob: async (input: { args: { jobId: string } }) => {
      w.calls.push({ op: "kill", id: input.args.jobId });
      return { ok: true, value: { state: "killed" } };
    },
    listChildren: async () => ({
      ok: true,
      value: { rows: [{ childId: "child-1" }, { childId: "child-2" }], diagnostics: [] },
    }),
    closeChild: async (input: { args: { target: string } }) => {
      w.calls.push({ op: "close", id: input.args.target });
      return w.failClose.has(input.args.target)
        ? { ok: false, code: "CHILD_CLOSE_UNCONFIRMED" }
        : { ok: true, value: { closed: true, killedJobs: [] } };
    },
  } as unknown as OrchestrationDirectApi;
  const registration = createWorkflowsBackendRegistration({
    stateRoot: dir,
    authorize: async () => ({ ok: true }),
    ports: createWorkflowRunsPorts({
      direct: () => direct,
      threadOfSession: (sessionId) => `thread-of-${sessionId}`,
    }),
    now: () => RUN_NOW,
  });
  mountedRegistrations.push(registration);
  await registration.activation.start(RUN_MODULE);
  const call = async (name: string, ctx: Xc6OperationContext) => {
    const operation = registration.operations?.[name];
    if (operation === undefined) throw new Error(`no operation ${name}`);
    return operation(ctx);
  };
  /** The controller's records for one run of one root: started, one member started with its child. */
  const seed = async (root: string, runId: string, childId: string) => {
    await call(
      "workflows.run-start",
      runContext(root, {
        runId,
        rootSessionId: root,
        ownerSessionId: root,
        name: "demo",
        caps: RUN_CAPS,
        startedAt: "2026-11-16T10:00:00.000Z",
      }),
    );
    await call(
      "workflows.member",
      runContext(root, { runId, seq: 1, childId: null, state: "pending" }),
    );
    await call("workflows.member", runContext(root, { runId, seq: 1, childId, state: "started" }));
  };
  const service = registration.runs();
  if (service === undefined) throw new Error("the run service is not running");
  return { w, service, seed };
};

describe("the workflow methods: the same checks, then the live run service", () => {
  it.effect(
    "a run service that is not running (workflows() is undefined) is unavailable after the gate: nothing was read, nothing was done",
    () =>
      Effect.gen(function* () {
        const s = yield* Effect.promise(() => setup());
        const actor = yield* withDevice(s, actorOf());
        expect(
          badOf(
            yield* withDevice(s, workflowRuns(s.backend, actor, { rootSessionId: MAIN })),
            "WORKFLOWS_UNAVAILABLE",
          ).detail,
        ).toContain("nothing was read");
        expect(
          badOf(
            yield* withDevice(
              s,
              workflowCancel(s.backend, actor, { rootSessionId: MAIN, runId: "run-1" }),
            ),
            "WORKFLOWS_UNAVAILABLE",
          ).detail,
        ).toContain("nothing was done");
        s.device.state = "revoked";
        badOf(
          yield* withDevice(
            s,
            workflowCancel(s.backend, actor, { rootSessionId: MAIN, runId: "run-1" }),
          ),
          "WORKFLOWS_DEVICE_REVOKED",
        );
      }),
  );

  it.effect("runs lists the caller's root's runs only, as the runs view, with a version", () =>
    Effect.gen(function* () {
      const live = yield* Effect.promise(() => liveRuns());
      yield* Effect.promise(async () => {
        await live.seed(MAIN, "run-1", "child-1");
        await live.seed(OTHER_ROOT, "run-2", "child-2");
      });
      const s = yield* Effect.promise(() => setup({ workflows: live.service }));
      const actor = yield* withDevice(s, actorOf());
      const reply = okOf(
        yield* withDevice(s, workflowRuns(s.backend, actor, { rootSessionId: MAIN })),
      );
      expect(reply.value.runs).toHaveLength(1);
      expect(reply.value.runs[0]).toMatchObject({ runId: "run-1", name: "demo", state: "running" });
      expect(reply.value.version).toEqual(expect.any(Number));
      expect(reply.value.unreadable).toBeUndefined();
      expect(live.w.calls).toEqual([]);
    }),
  );

  it.effect(
    "cancel of another root's run is WORKFLOWS_NOT_FOUND (RUN_UNKNOWN): it stops and closes nothing",
    () =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => liveRuns());
        yield* Effect.promise(() => live.seed(OTHER_ROOT, "run-2", "child-2"));
        const s = yield* Effect.promise(() => setup({ workflows: live.service }));
        const actor = yield* withDevice(s, actorOf());
        badOf(
          yield* withDevice(
            s,
            workflowCancel(s.backend, actor, { rootSessionId: MAIN, runId: "run-2" }),
          ),
          "WORKFLOWS_NOT_FOUND",
        );
        expect(live.w.calls).toEqual([]);
        expect(live.service.list(OTHER_ROOT)).toMatchObject({
          ok: true,
          runs: [{ runId: "run-2", state: "running" }],
        });
      }),
  );

  it.effect(
    "a cancel that did not finish every step is WORKFLOWS_OUTCOME_UNKNOWN and names what is left",
    () =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => liveRuns());
        yield* Effect.promise(() => live.seed(MAIN, "run-1", "child-1"));
        live.w.failClose.add("child-1");
        const s = yield* Effect.promise(() => setup({ workflows: live.service }));
        const actor = yield* withDevice(s, actorOf());
        const bad = badOf(
          yield* withDevice(
            s,
            workflowCancel(s.backend, actor, { rootSessionId: MAIN, runId: "run-1" }),
          ),
          "WORKFLOWS_OUTCOME_UNKNOWN",
        );
        expect(bad.detail).toContain("child-1");
        expect(bad.detail).toContain("read the runs");
      }),
  );

  it.effect(
    "the read-scope actor is refused by workflowCancel and nothing is stopped; the operate scope cancels exactly the named run",
    () =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => liveRuns());
        yield* Effect.promise(() => live.seed(MAIN, "run-1", "child-1"));
        const s = yield* Effect.promise(() => setup({ workflows: live.service }));
        const readOnly = yield* withDevice(s, actorOf(READ_ONLY));
        const operateOnly = yield* withDevice(s, actorOf(OPERATE_ONLY));
        badOf(
          yield* withDevice(
            s,
            workflowCancel(s.backend, readOnly, { rootSessionId: MAIN, runId: "run-1" }),
          ),
          "WORKFLOWS_NOT_AUTHORIZED",
        );
        expect(live.w.calls).toEqual([]);
        const done = okOf(
          yield* withDevice(
            s,
            workflowCancel(s.backend, operateOnly, { rootSessionId: MAIN, runId: "run-1" }),
          ),
        );
        expect(done.value.run).toMatchObject({ runId: "run-1" });
        expect(live.w.calls).toEqual([
          { op: "kill", id: "job-1" },
          { op: "close", id: "child-1" },
        ]);
      }),
  );

  it.effect("a revoked device is refused before the live run service is touched", () =>
    Effect.gen(function* () {
      const live = yield* Effect.promise(() => liveRuns());
      yield* Effect.promise(() => live.seed(MAIN, "run-1", "child-1"));
      const s = yield* Effect.promise(() => setup({ workflows: live.service }));
      const actor = yield* withDevice(s, actorOf());
      s.device.state = "revoked";
      badOf(
        yield* withDevice(s, workflowRuns(s.backend, actor, { rootSessionId: MAIN })),
        "WORKFLOWS_DEVICE_REVOKED",
      );
      badOf(
        yield* withDevice(
          s,
          workflowCancel(s.backend, actor, { rootSessionId: MAIN, runId: "run-1" }),
        ),
        "WORKFLOWS_DEVICE_REVOKED",
      );
      expect(live.w.calls).toEqual([]);
    }),
  );
});
