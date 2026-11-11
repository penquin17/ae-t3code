// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M05 Plan step 9 — the caller context of a spawn. Boundary: the pure resolver over scripted sources (an index binding and a run list), and the
// production wrapper over a scripted `getThreadProjection`. Shows: the caller is the bound thread, its working folder and its ONE live run's root node; an
// unbound session, a relative folder, no live run, two live runs, a run without a root node and an unreadable projection are each unavailable with a cause.
// Does NOT show T3's real projection (the native slice does) or that the node it names is accepted by T3's delegation (the adapter test does).
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createCallerContext, makeCallerContext, type ActiveRunFact } from "./callerContext.ts";

const run = (
  id: string,
  status: string,
  rootNodeId: string | null = `${id}-root`,
): ActiveRunFact => ({
  id,
  status,
  rootNodeId,
});
const BOUND = { threadId: "thread-main", workingFolder: "/work/project" };
const port = (runs: readonly ActiveRunFact[] | Error, binding: typeof BOUND | undefined = BOUND) =>
  createCallerContext({
    bindingOfSession: (sessionId) => (sessionId === "s1" ? binding : undefined),
    runsOf: async () => {
      if (runs instanceof Error) throw runs;
      return runs;
    },
  });

describe("the caller context of a spawn", () => {
  it("is the bound thread, its working folder and the live run's root node", async () => {
    const found = await port([run("run-1", "completed"), run("run-2", "running")])("s1");
    assert.deepEqual(found, {
      ok: true,
      threadId: "thread-main",
      runId: "run-2",
      nodeId: "run-2-root",
      workingFolder: "/work/project",
    });
    for (const status of ["starting", "waiting"])
      assert.equal((await port([run("r", status)])("s1")).ok, true, status);
  });

  it("is unavailable, with a cause, when the caller cannot be named exactly", async () => {
    const refused = async (p: ReturnType<typeof port>, session = "s1") => {
      const found = await p(session);
      assert.equal(found.ok, false);
      return found.ok ? "" : found.detail;
    };
    assert.match(await refused(port([run("r", "running")]), "unbound"), /not bound/);
    assert.match(await refused(port([run("r", "running")]), ""), /no session/);
    assert.match(
      await refused(port([run("r", "running")], { threadId: "t", workingFolder: "work" })),
      /not absolute/,
    );
    assert.match(await refused(port([run("r", "completed"), run("q", "queued")])), /no active run/);
    assert.match(await refused(port([run("r", "preparing")])), /no active run/);
    assert.match(await refused(port([run("a", "running"), run("b", "waiting")])), /more than one/);
    assert.match(await refused(port([run("r", "running", null)])), /no root node/);
    assert.match(await refused(port(new Error("boom"))), /could not be read/);
  });

  it.effect("the production wrapper reads T3's thread projection for the bound thread", () =>
    Effect.gen(function* () {
      const asked: string[] = [];
      const orchestrator = {
        getThreadProjection: (threadId: string) => {
          asked.push(String(threadId));
          return Effect.succeed({
            runs: [{ id: "run-9", status: "running", rootNodeId: "node-9" }],
          });
        },
      };
      const resolve = yield* makeCallerContext(orchestrator as never, (sessionId) =>
        sessionId === "s1" ? BOUND : undefined,
      );
      const found = yield* Effect.promise(() => resolve("s1"));
      assert.deepEqual(found, {
        ok: true,
        threadId: "thread-main",
        runId: "run-9",
        nodeId: "node-9",
        workingFolder: "/work/project",
      });
      assert.deepEqual(asked, ["thread-main"]);
      const failing = yield* makeCallerContext(
        { getThreadProjection: () => Effect.die(new Error("gone")) } as never,
        () => BOUND,
      );
      const unreadable = yield* Effect.promise(() => failing("s1"));
      assert.equal(unreadable.ok, false);
    }),
  );
});
