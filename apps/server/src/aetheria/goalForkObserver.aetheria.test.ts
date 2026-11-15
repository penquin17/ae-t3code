// @effect-diagnostics globalErrorInEffectFailure:off
/* oxlint-disable t3code/no-low-value-comments -- The header states the boundary this evidence covers and what it does not show. */
// AETHERIA M07 Plan step 19 (D10, B6) — the fork observer over T3's REAL lineage reader (`makeLineageReader`) with scripted thread shells and a scripted goal-service port.
//
// Boundary: `goalForkObserver.ts` and the lineage reader it pulls from. It shows: forks listed by the first pull are fenced and never copied (a restart or a replay cannot copy a later goal);
// a fork that appears afterwards is offered to `onSessionForked` once, with the parent's and the fork's Pi sessions; a repeated or overlapping observation calls nothing twice; a fork whose session
// is not yet bound, or whose parent session or identity cannot be read, waits and is retried (never copied from a guess); an M05-style child answered `GOAL_NOT_ROOT` is fenced and never retried;
// a subagent, a closed thread and a new main root are never offered; an unreadable listing decides nothing. It does NOT show the goal service's copy itself (the outer test
// tests/goals-workflows/fork/observer.test.mjs runs the real service), M03's real identity, or a native restart.
import { assert, it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import { makeGoalForkObserver, type ForkCopyAnswer } from "./goalForkObserver.ts";
import { makeLineageReader } from "./lineageReader.ts";

type Shell = {
  id: string;
  archivedAt: string | null;
  lineage: {
    relationshipToParent: "fork" | "subagent" | null;
    parentThreadId: string | null;
    rootThreadId: string;
  };
};
const shell = (
  id: string,
  relationship: "fork" | "subagent" | null,
  parent: string | null,
  archived = false,
): Shell => ({
  id,
  archivedAt: archived ? "2026-11-15T00:00:00.000Z" : null,
  lineage: {
    relationshipToParent: relationship,
    parentThreadId: parent,
    rootThreadId: parent ?? id,
  },
});

function harness(initial: Shell[]) {
  const state = {
    shells: initial,
    sessions: new Map<string, string | null | "unknown">(),
    listing: "ok" as "ok" | "fail",
    answer: (): ForkCopyAnswer => ({ status: "ok", value: { copy: "created" } }),
    calls: [] as { parentSessionId: string; childSessionId: string }[],
  };
  return state;
}

const build = (state: ReturnType<typeof harness>) =>
  Effect.gen(function* () {
    const sessionOf = (id: string) => state.sessions.get(id) ?? null;
    const reader = yield* makeLineageReader(
      {
        listProjectThreads: () =>
          state.listing === "fail" ? Effect.fail(new Error("db")) : Effect.succeed(state.shells),
      } as never,
      sessionOf,
    );
    return makeGoalForkObserver({
      reader,
      sessionOf,
      goals: {
        onSessionForked: async (fork) => {
          state.calls.push(fork);
          return state.answer();
        },
      },
    });
  });

describe("goal fork observer (B6): lineage pull, replay fence, one call per new fork", () => {
  effectIt.effect(
    "fences every fork the first pull lists and copies only forks that appear afterwards, once",
    () =>
      Effect.gen(function* () {
        const s = harness([shell("t-root", null, null), shell("t-old-fork", "fork", "t-root")]);
        s.sessions.set("t-root", "pi-root").set("t-old-fork", "pi-old");
        const observer = yield* build(s);
        const first = yield* Effect.promise(() => observer.observe());
        assert.deepEqual(first, { ok: true, fenced: true, forks: [] });
        assert.deepEqual(s.calls, [], "history at the first pull is never copied");

        s.shells = [...s.shells, shell("t-new-fork", "fork", "t-root")];
        s.sessions.set("t-new-fork", "pi-new");
        const second = yield* Effect.promise(() => observer.observe());
        assert.deepEqual(second.forks, [{ threadId: "t-new-fork", outcome: "created" }]);
        assert.deepEqual(s.calls, [{ parentSessionId: "pi-root", childSessionId: "pi-new" }]);

        yield* Effect.promise(() => observer.observe());
        yield* Effect.promise(() => observer.observe());
        assert.equal(
          s.calls.length,
          1,
          "a repeated observation (a replayed feed) offers nothing twice",
        );
      }),
  );

  effectIt.effect(
    "a fork whose session is not bound yet waits, then is offered once when it binds; the parent's unreadable session waits too",
    () =>
      Effect.gen(function* () {
        const s = harness([shell("t-root", null, null)]);
        s.sessions.set("t-root", "pi-root");
        const observer = yield* build(s);
        yield* Effect.promise(() => observer.observe());
        s.shells = [...s.shells, shell("t-fork", "fork", "t-root")];
        const unbound = yield* Effect.promise(() => observer.observe());
        assert.deepEqual(unbound.forks, [{ threadId: "t-fork", outcome: "waiting" }]);
        s.sessions.set("t-fork", "unknown");
        assert.equal(
          (yield* Effect.promise(() => observer.observe())).forks[0]?.outcome,
          "waiting",
        );
        s.sessions.set("t-fork", "pi-fork");
        s.sessions.set("t-root", "unknown");
        assert.equal(
          (yield* Effect.promise(() => observer.observe())).forks[0]?.outcome,
          "waiting",
        );
        assert.deepEqual(s.calls, [], "nothing is offered while either session is unreadable");
        s.sessions.set("t-root", "pi-root");
        assert.equal(
          (yield* Effect.promise(() => observer.observe())).forks[0]?.outcome,
          "created",
        );
        assert.equal(s.calls.length, 1);
      }),
  );

  effectIt.effect(
    "an unavailable service answer is retried; a child (GOAL_NOT_ROOT) and another refusal are fenced and never retried",
    () =>
      Effect.gen(function* () {
        const s = harness([shell("t-root", null, null)]);
        s.sessions.set("t-root", "pi-root");
        const observer = yield* build(s);
        yield* Effect.promise(() => observer.observe());
        s.shells = [
          ...s.shells,
          shell("t-a", "fork", "t-root"),
          shell("t-b", "fork", "t-root"),
          shell("t-c", "fork", "t-root"),
        ];
        s.sessions.set("t-a", "pi-a").set("t-b", "pi-b").set("t-c", "pi-c");
        const answers: Record<string, ForkCopyAnswer> = {
          "pi-a": { status: "unavailable" },
          "pi-b": { status: "refused", code: "GOAL_NOT_ROOT" },
          "pi-c": { status: "refused", code: "GOAL_INVALID_TRANSITION" },
        };
        s.answer = () => answers[s.calls.at(-1)?.childSessionId ?? ""] ?? { status: "unavailable" };
        const report = yield* Effect.promise(() => observer.observe());
        assert.deepEqual(report.forks, [
          { threadId: "t-a", outcome: "waiting" },
          { threadId: "t-b", outcome: "child" },
          { threadId: "t-c", outcome: "refused" },
        ]);
        answers["pi-a"] = { status: "ok", value: { copy: "none" } };
        const again = yield* Effect.promise(() => observer.observe());
        assert.deepEqual(
          again.forks,
          [{ threadId: "t-a", outcome: "none" }],
          "only the waiting one is tried again",
        );
        assert.deepEqual(
          s.calls.map((c) => c.childSessionId),
          ["pi-a", "pi-b", "pi-c", "pi-a"],
        );
      }),
  );

  effectIt.effect("a subagent, a closed fork and a new main root are never offered", () =>
    Effect.gen(function* () {
      const s = harness([shell("t-root", null, null)]);
      s.sessions.set("t-root", "pi-root");
      const observer = yield* build(s);
      yield* Effect.promise(() => observer.observe());
      s.shells = [
        ...s.shells,
        shell("t-sub", "subagent", "t-root"),
        shell("t-closed", "fork", "t-root", true),
        shell("t-main", null, null),
      ];
      s.sessions.set("t-sub", "pi-sub").set("t-closed", "pi-closed").set("t-main", "pi-main");
      const report = yield* Effect.promise(() => observer.observe());
      assert.deepEqual(report.forks, [{ threadId: "t-closed", outcome: "closed" }]);
      assert.deepEqual(s.calls, []);
    }),
  );

  effectIt.effect(
    "an unreadable listing decides nothing and does not take the fence: the first readable pull does",
    () =>
      Effect.gen(function* () {
        const s = harness([shell("t-root", null, null), shell("t-fork", "fork", "t-root")]);
        s.sessions.set("t-root", "pi-root").set("t-fork", "pi-fork");
        s.listing = "fail";
        const observer = yield* build(s);
        assert.deepEqual(yield* Effect.promise(() => observer.observe()), {
          ok: false,
          fenced: false,
          forks: [],
        });
        s.listing = "ok";
        const first = yield* Effect.promise(() => observer.observe());
        assert.deepEqual([first.ok, first.fenced], [true, true]);
        assert.deepEqual(s.calls, [], "the fork that was already there is history, not a new fork");
      }),
  );

  effectIt.effect("overlapping observations share one serial loop: one fork, one call", () =>
    Effect.gen(function* () {
      const s = harness([shell("t-root", null, null)]);
      s.sessions.set("t-root", "pi-root");
      const observer = yield* build(s);
      yield* Effect.promise(() => observer.observe());
      s.shells = [...s.shells, shell("t-fork", "fork", "t-root")];
      s.sessions.set("t-fork", "pi-fork");
      const reports = yield* Effect.promise(() =>
        Promise.all([observer.observe(), observer.observe(), observer.observe()]),
      );
      assert.equal(s.calls.length, 1);
      assert.deepEqual(reports[0]?.forks, [{ threadId: "t-fork", outcome: "created" }]);
    }),
  );

  it("a service that throws leaves the fork waiting, never fenced as handled", async () => {
    let throwing = true;
    const calls: string[] = [];
    let forkIds: string[] = [];
    const thread = (threadId: string) => ({
      threadId,
      parentThreadId: "t-root",
      rootThreadId: "t-root",
      relationshipToParent: "fork" as const,
      sessionId: `pi-${threadId}`,
      closed: false,
    });
    const observer = makeGoalForkObserver({
      reader: {
        listChildThreads: async () => ({ ok: true as const, threads: forkIds.map(thread) }),
      },
      sessionOf: () => "pi-root",
      goals: {
        onSessionForked: async (fork) => {
          calls.push(fork.childSessionId);
          if (throwing) throw new Error("service down");
          return { status: "ok", value: { copy: "created" } };
        },
      },
    });
    await observer.observe();
    forkIds = ["t-fork"];
    expect((await observer.observe()).forks).toEqual([{ threadId: "t-fork", outcome: "waiting" }]);
    throwing = false;
    expect((await observer.observe()).forks).toEqual([{ threadId: "t-fork", outcome: "created" }]);
    expect(calls).toEqual(["pi-t-fork", "pi-t-fork"]);
  });
});
