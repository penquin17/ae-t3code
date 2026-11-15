/* oxlint-disable t3code/no-low-value-comments -- The header states what this test shows and what it does not. */
// AETHERIA M07 Plan step 17 (DV10; D4, D12, D13) — the goals module's three XC-6 operations `goals.get`, `goals.create` and `goals.update`, through the module's REAL registration over the INSTALLED `@aetheria/goals`
// archive's real goal service, store (a real temporary state root) and strict reply codec. SCRIPTED (goals/testkit.ts): the session resolver, M06's card (a deferred answer a test settles), M05's admission and settles,
// T3's receipt and the notice outbox. It shows: arguments are strict and decoded before anything runs; the operations answer `unavailable` before start and after drain; `create`, `edit` and `resume` only propose a
// card (nothing is armed until a person's verified answer commits); a stale reference is refused; `wrapUp: true` appears ONLY on a `complete` or `blocked` the service accepted under the live running round, never on a
// refusal, a pause, a read or a proposal; a child and an unreadable session are refused or unavailable; every reply decodes through the archive's strict codec and carries no origin id. It does NOT show the real thread
// index, M03 identity files, T3's carrier that maps a tool call to these operations, or the Agent's turn ending after `wrapUp` (installed-Pi tests).
import type { Xc6OperationContext } from "@t3tools/aetheria-contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { GoalsRuntime } from "./goals/factory.ts";
import {
  decodeGoalToolReply,
  type GoalResult,
  type GoalService,
  type GoalToolReply,
} from "./goals/goalsEntry.ts";
import { goalEnvelopeVectors } from "./goals/goalEnvelope.vectors.ts";
import { createGoalOperations } from "./goals/operations.ts";
import { createGoalsBackendRegistration } from "./goals/registration.ts";
import {
  CHILD,
  MAIN,
  MODULE,
  UNREADABLE,
  approveLast,
  runtimeOf,
  world,
  type World,
} from "./goals/testkit.ts";

const live: Array<{ runtime: GoalsRuntime; release: () => void }> = [];
afterEach(async () => {
  for (const { runtime, release } of live.splice(0)) {
    release();
    runtime.service.stop();
    await runtime.service.idle();
  }
});

/** The module's registration over a real runtime, started: parameters let a goal be blocked after one round. */
const started = async (blockedAfter = 1) => {
  const w = world();
  const runtime = runtimeOf(w, {
    defaultMaxRounds: 5,
    blockedAfterConsecutiveRounds: blockedAfter,
  });
  const registration = createGoalsBackendRegistration({ create: () => runtime });
  live.push({ runtime, release: w.release });
  await registration.activation.start(MODULE);
  return { w, runtime, registration };
};

const context = (sessionId: string, args: Record<string, unknown> = {}): Xc6OperationContext => ({
  caller: { threadId: "thread-1", providerSessionId: "runtime-1", providerInstanceId: "pi" },
  sessionId,
  kind: "main",
  rootSessionId: sessionId,
  args,
});

type Done = { readonly status: "done"; readonly result: GoalToolReply };
const call = async (
  registration: { operations?: Readonly<Record<string, (c: Xc6OperationContext) => unknown>> },
  name: string,
  sessionId: string,
  args: Record<string, unknown> = {},
) => (await registration.operations![name]!(context(sessionId, args))) as Done;

/** Every reply that reaches the model decodes through the archive's strict codec and names no origin, session or root. */
const reply = (answer: Done): GoalToolReply => {
  expect(answer.status).toBe("done");
  expect(decodeGoalToolReply(answer.result).ok).toBe(true);
  expect(JSON.stringify(answer.result)).not.toMatch(/origin|rootSession|sessionId/i);
  return answer.result;
};

/** A goal armed by an approved card. */
const created = async (
  w: World,
  runtime: GoalsRuntime,
  registration: Parameters<typeof call>[0],
) => {
  await call(registration, "goals.create", MAIN, { objective: "ship it" });
  await approveLast(w, runtime);
  const got = reply(await call(registration, "goals.get", MAIN));
  if (got.outcome !== "ok" || got.goal === null) throw new Error("no goal");
  return { goal_id: got.goal.id, revision: got.goal.revision };
};

describe("the three operations", () => {
  it("are exactly goals.get, goals.create and goals.update, and answer unavailable before start and after drain", async () => {
    const w = world();
    const runtime = runtimeOf(w);
    live.push({ runtime, release: w.release });
    const registration = createGoalsBackendRegistration({ create: () => runtime });
    const sample: Record<string, Record<string, unknown>> = {
      "goals.get": {},
      "goals.create": { objective: "x" },
      "goals.update": { goal_id: "g", revision: 1, action: "pause" },
    };
    expect(Object.keys(registration.operations!).sort()).toEqual(Object.keys(sample).sort());
    for (const [name, args] of Object.entries(sample))
      expect(await call(registration, name, MAIN, args)).toEqual({
        status: "unavailable",
        code: "GOALS_NOT_RUNNING",
      });
    await registration.activation.start(MODULE);
    expect(reply(await call(registration, "goals.get", MAIN))).toEqual({
      outcome: "ok",
      goal: null,
    });
    await registration.activation.drain("test");
    expect(await call(registration, "goals.get", MAIN)).toEqual({
      status: "unavailable",
      code: "GOALS_NOT_RUNNING",
    });
  });

  it("decode their arguments strictly before anything runs, even while the module is not running", () => {
    const w = world();
    const idle = createGoalsBackendRegistration({ create: () => runtimeOf(w) });
    const bad: Array<[string, Record<string, unknown>]> = [
      ["goals.get", { sessionId: "other" }],
      ["goals.create", {}],
      ["goals.create", { objective: "x", originId: "origin-1" }],
      ["goals.create", { objective: "x", caller: { user: true } }],
      ["goals.create", { objective: "x", max_goal_rounds: 0 }],
      ["goals.update", { goal_id: "g", revision: 1, action: "arm" }],
      ["goals.update", { goal_id: "g", revision: 1, action: "pause", rootSessionId: "r" }],
      ["goals.update", { goal_id: "g", revision: 0, action: "pause" }],
      ["goals.update", { revision: 1, action: "pause" }],
    ];
    for (const [name, args] of bad)
      expect(() => idle.operations![name]!(context(MAIN, args))).toThrow();
  });
});

describe("create, edit and resume only propose", () => {
  it("create writes a card and arms nothing until a person's verified answer commits; the reply names only the proposal", async () => {
    const { w, runtime, registration } = await started();
    const proposed = reply(
      await call(registration, "goals.create", MAIN, { objective: "ship it", max_goal_rounds: 3 }),
    );
    expect(proposed).toEqual({ outcome: "awaiting-human", proposalId: expect.any(String) });
    expect(w.cards.size).toBe(1);
    expect(runtime.service.isArmed(MAIN)).toBe(false);
    expect(reply(await call(registration, "goals.get", MAIN))).toEqual({
      outcome: "ok",
      goal: null,
    });
    expect(w.admits).toEqual([]);

    await approveLast(w, runtime);
    const goal = reply(await call(registration, "goals.get", MAIN));
    expect(goal).toMatchObject({
      outcome: "ok",
      activation: "armed",
      goal: {
        revision: 1,
        objective: "ship it",
        phase: "active",
        roundsStarted: 0,
        maxGoalRounds: 3,
      },
    });
    expect("wrapUp" in goal).toBe(false);
  });

  it("a second create is refused while a goal exists, and an edit is a card again, with a stale reference refused", async () => {
    const { w, runtime, registration } = await started();
    const ref = await created(w, runtime, registration);

    expect(
      reply(await call(registration, "goals.create", MAIN, { objective: "again" })),
    ).toMatchObject({ outcome: "refused", code: "GOAL_ALREADY_EXISTS" });
    expect(
      reply(
        await call(registration, "goals.update", MAIN, {
          ...ref,
          revision: ref.revision + 1,
          action: "edit",
          objective: "other",
        }),
      ),
    ).toMatchObject({ outcome: "refused", code: "GOAL_STALE_REVISION" });
    const cardsBefore = w.cards.size;
    expect(
      reply(
        await call(registration, "goals.update", MAIN, {
          ...ref,
          action: "edit",
          objective: "other",
        }),
      ),
    ).toMatchObject({ outcome: "awaiting-human" });
    expect(w.cards.size).toBe(cardsBefore + 1);
    // the objective only changes when the card is approved
    expect(reply(await call(registration, "goals.get", MAIN))).toMatchObject({
      goal: { objective: "ship it", revision: ref.revision },
    });
    await approveLast(w, runtime);
    expect(reply(await call(registration, "goals.get", MAIN))).toMatchObject({
      goal: { objective: "other", revision: ref.revision + 1 },
    });
  });

  it("a paused goal is resumed only through a card; the resume arms it after the approval and not before", async () => {
    const { w, runtime, registration } = await started();
    const ref = await created(w, runtime, registration);
    const paused = reply(
      await call(registration, "goals.update", MAIN, { ...ref, action: "pause" }),
    );
    expect(paused).toMatchObject({
      outcome: "ok",
      activation: "disarmed",
      goal: { phase: "paused" },
    });
    expect("wrapUp" in paused).toBe(false);
    if (paused.outcome !== "ok" || paused.goal === null) throw new Error("no goal");
    expect(
      reply(
        await call(registration, "goals.update", MAIN, {
          goal_id: paused.goal.id,
          revision: paused.goal.revision,
          action: "resume",
        }),
      ),
    ).toMatchObject({ outcome: "awaiting-human" });
    expect(runtime.service.isArmed(MAIN)).toBe(false);
    await approveLast(w, runtime);
    expect(runtime.service.isArmed(MAIN)).toBe(true);
  });
});

describe("wrapUp follows the live running round and nothing else", () => {
  it("complete without a running round is refused and sets no wrapUp; with the running round it is accepted and sets wrapUp", async () => {
    const { w, runtime, registration } = await started();
    const ref = await created(w, runtime, registration);
    const refused = reply(
      await call(registration, "goals.update", MAIN, { ...ref, action: "complete" }),
    );
    expect(refused).toMatchObject({ outcome: "refused", code: "GOAL_NOT_AUTHORIZED" });
    expect("wrapUp" in refused).toBe(false);

    w.settle(1);
    await runtime.service.idle();
    expect(w.admits).toHaveLength(1);
    const wrong = reply(
      await call(registration, "goals.update", MAIN, {
        ...ref,
        revision: ref.revision + 7,
        action: "complete",
      }),
    );
    expect(wrong).toMatchObject({ outcome: "refused", code: "GOAL_STALE_REVISION" });
    expect("wrapUp" in wrong).toBe(false);

    const done = reply(
      await call(registration, "goals.update", MAIN, { ...ref, action: "complete" }),
    );
    expect(done).toMatchObject({
      outcome: "ok",
      wrapUp: true,
      activation: "disarmed",
      goal: { phase: "complete", revision: ref.revision + 1 },
    });
    // a second complete finds a complete goal at a later revision: stale, no wrapUp
    const again = reply(
      await call(registration, "goals.update", MAIN, { ...ref, action: "complete" }),
    );
    expect("wrapUp" in again).toBe(false);
  });

  it("blocked needs a reason; with one and the running round it is accepted, carries the reason and sets wrapUp", async () => {
    const { w, runtime, registration } = await started();
    const ref = await created(w, runtime, registration);
    w.settle(1);
    await runtime.service.idle();
    const noReason = reply(
      await call(registration, "goals.update", MAIN, { ...ref, action: "blocked" }),
    );
    expect(noReason).toMatchObject({ outcome: "refused", code: "GOAL_INVALID_TRANSITION" });
    expect("wrapUp" in noReason).toBe(false);

    const blocked = reply(
      await call(registration, "goals.update", MAIN, {
        ...ref,
        action: "blocked",
        blocked_reason: "needs a credential",
      }),
    );
    expect(blocked).toMatchObject({
      outcome: "ok",
      wrapUp: true,
      goal: { phase: "blocked", blockedReason: "needs a credential" },
    });
  });

  it("a blocked before the configured round minimum is refused with no wrapUp", async () => {
    const { w, runtime, registration } = await started(3);
    const ref = await created(w, runtime, registration);
    w.settle(1);
    await runtime.service.idle();
    const early = reply(
      await call(registration, "goals.update", MAIN, {
        ...ref,
        action: "blocked",
        blocked_reason: "stuck",
      }),
    );
    expect(early).toMatchObject({ outcome: "refused", code: "GOAL_INVALID_TRANSITION" });
    expect("wrapUp" in early).toBe(false);
  });

  it("a pause and a read never set wrapUp, even with a round running", async () => {
    const { w, runtime, registration } = await started();
    const ref = await created(w, runtime, registration);
    w.settle(1);
    await runtime.service.idle();
    expect("wrapUp" in reply(await call(registration, "goals.get", MAIN))).toBe(false);
    const paused = reply(
      await call(registration, "goals.update", MAIN, { ...ref, action: "pause" }),
    );
    expect(paused).toMatchObject({ outcome: "ok", goal: { phase: "paused" } });
    expect("wrapUp" in paused).toBe(false);
  });
});

describe("the caller", () => {
  it("a child session is refused and an unreadable session is unavailable, for every operation, and nothing is written", async () => {
    const { w, registration } = await started();
    for (const [session, expected] of [
      [CHILD, { outcome: "refused", code: "GOAL_NOT_ROOT" }],
      [UNREADABLE, { outcome: "unavailable" }],
    ] as const) {
      expect(reply(await call(registration, "goals.get", session))).toMatchObject(expected);
      expect(
        reply(await call(registration, "goals.create", session, { objective: "x" })),
      ).toMatchObject(expected);
      expect(
        reply(
          await call(registration, "goals.update", session, {
            goal_id: "g",
            revision: 1,
            action: "pause",
          }),
        ),
      ).toMatchObject(expected);
    }
    expect(w.cards.size).toBe(0);
  });
});

describe("the envelope the Agent's goal tools read (DV10)", () => {
  /** Ids differ per run; the shared vectors name them `proposal-1` and `goal-1`. */
  const normalized = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalized);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        key === "proposalId" ? "proposal-1" : key === "id" ? "goal-1" : normalized(inner),
      ]),
    );
  };

  /** The state a vector's scenario names, built through the real operations: a goal approved by a card, optionally with its round running. */
  const scenario = async (name: (typeof goalEnvelopeVectors)[number]["scenario"]) => {
    const { w, runtime, registration } = await started();
    const session = name === "child" ? CHILD : name === "unreadable" ? UNREADABLE : MAIN;
    let goalId = "goal-1";
    let revision = 1;
    if (name === "armed" || name === "running") {
      await call(registration, "goals.create", MAIN, { objective: "ship it", max_goal_rounds: 3 });
      await approveLast(w, runtime);
      const got = reply(await call(registration, "goals.get", MAIN));
      if (got.outcome !== "ok" || got.goal === null) throw new Error("no goal");
      goalId = got.goal.id;
      revision = got.goal.revision;
    }
    if (name === "running") {
      w.settle(1);
      await runtime.service.idle();
    }
    return { registration, session, goalId, revision };
  };

  it.each(goalEnvelopeVectors.map((vector) => [vector.name, vector] as const))(
    "%s: the real operation answers exactly the shared vector",
    async (_name, vector) => {
      const { registration, session, goalId, revision } = await scenario(vector.scenario);
      const args =
        vector.operation === "goals.update"
          ? { ...vector.params, goal_id: goalId, revision }
          : vector.params;
      const answer = await registration.operations![vector.operation]!(context(session, args));
      expect(normalized(answer)).toEqual(vector.settled);
      expect(decodeGoalToolReply((answer as Done).result).ok).toBe(true);
    },
  );
});

describe("a reply the codec refuses, and a service that throws", () => {
  const service = (over: Partial<GoalService>): GoalService => over as GoalService;
  const view = {
    goalId: "g",
    revision: 1,
    objective: "x",
    phase: "active",
    roundsStarted: 0,
    maxRounds: 3,
    armed: true,
    needsRearm: false,
  } as const;

  it("is unavailable when the goal does not fit the strict reply codec (nothing is passed to the model)", async () => {
    const operations = createGoalOperations(() =>
      service({
        snapshot: async () =>
          ({
            status: "ok",
            value: { goal: { ...view, objective: "" } },
          }) as GoalResult<never>,
      }),
    );
    expect(await operations["goals.get"]!(context(MAIN))).toEqual({
      status: "unavailable",
      code: "GOALS_REPLY_INVALID",
    });
  });

  it("says a mutation's outcome is unknown when it throws, and a read's nothing was read, never an ok or a wrapUp", async () => {
    const operations = createGoalOperations(() =>
      service({
        snapshot: async () => {
          throw new Error("disk");
        },
        complete: async () => {
          throw new Error("disk");
        },
      }),
    );
    const read = (await operations["goals.get"]!(context(MAIN))) as Done;
    expect(read.result).toMatchObject({
      outcome: "unavailable",
      detail: expect.stringContaining("nothing was read"),
    });
    const write = (await operations["goals.update"]!(
      context(MAIN, { goal_id: "g", revision: 1, action: "complete" }),
    )) as Done;
    expect(write.result).toMatchObject({
      outcome: "unavailable",
      detail: expect.stringContaining("outcome unknown"),
    });
    expect("wrapUp" in write.result).toBe(false);
  });
});
