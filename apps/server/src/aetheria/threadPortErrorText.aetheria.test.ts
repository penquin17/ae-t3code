// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M05 step 24 (native round 3 finding) — the provider's error text reaches M05's settle record and the route fallback.
//
// T3 records a failed run's provider text only in the run's `error` turn item (`failure.message`); the run itself has no error field. The thread port built the settle event from the `run.updated` event
// alone and `readLastRun` answered `errorText: null`, so M05 never saw the text, classified every provider failure as `unknown` and could never fall back. Boundary: `makeChildThreadPort` over a FAKE
// orchestrator (projection reads and the domain-event stream), run live so the 250 ms retry elapses by itself (the tests await a Queue, never poll); the sink, sessions, threads and ids are not used by these two operations. It shows: `errorTextOf` picks the newest `error`
// item of THE RUN asked about and cuts it to 2000 characters; a failed `run.updated` reaches the handler WITH that text; an item that is not yet projected is waited for once (a bounded 250 ms) and then the
// event goes without text (never a guess); a completed run carries no text and reads no projection for it; `readLastRun` carries the text of a failed newest run. It does NOT show T3's real projection or a
// real failed run (the native run does).
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { errorTextOf, makeChildThreadPort } from "./threadPort.ts";

const THREAD = "thread:child";
const RUN = "run:thread:child:ordinal:1";
const errorItem = (runId: string, ordinal: number, message: unknown) => ({
  type: "error",
  runId,
  ordinal,
  status: "failed",
  failure: { class: "provider_error", message, code: null, retryable: false },
});
const projectionOf = (
  items: unknown[],
  runs: unknown[] = [{ id: RUN, ordinal: 1, status: "failed", completedAt: null }],
) => ({
  thread: { lineage: { rootThreadId: "thread:root", parentThreadId: "thread:root" } },
  runs,
  turnItems: items,
  subagents: [],
});

it("errorTextOf takes the newest error item of the run asked about, as text, cut to 2000 characters", () => {
  const text = "You hit your ChatGPT usage limit (plus plan). Try again in ~600 min.";
  assert.equal(errorTextOf(projectionOf([errorItem(RUN, 1000006, text)]) as never, RUN), text);
  assert.equal(
    errorTextOf(
      projectionOf([
        errorItem(RUN, 1, "older"),
        errorItem(RUN, 9, "newer"),
        errorItem("run:other", 20, "another run's"),
      ]) as never,
      RUN,
    ),
    "newer",
  );
  assert.equal(
    errorTextOf(projectionOf([errorItem(RUN, 1, "x".repeat(5000))]) as never, RUN)?.length,
    2000,
  );
  for (const items of [
    [],
    [{ type: "assistant_message", runId: RUN, ordinal: 1 }],
    [errorItem(RUN, 1, "")],
    [errorItem(RUN, 1, 42)],
    [{ type: "error", runId: RUN, ordinal: 1 }],
    [errorItem("run:other", 1, "not this run")],
  ])
    assert.isUndefined(errorTextOf(projectionOf(items) as never, RUN), JSON.stringify(items));
  assert.isUndefined(errorTextOf(null as never, RUN));
});

const portWith = (events: unknown[], projections: Array<() => unknown>) =>
  Effect.gen(function* () {
    let read = 0;
    const queue = yield* Queue.unbounded<unknown>();
    for (const event of events) yield* Queue.offer(queue, event);
    const orchestrator = {
      streamDomainEvents: Stream.fromQueue(queue),
      getThreadProjection: () =>
        Effect.sync(() => {
          const next = projections[Math.min(read, projections.length - 1)]!;
          read += 1;
          return next();
        }),
    };
    const port = yield* makeChildThreadPort({ orchestrator } as never);
    return { port, reads: () => read, queue };
  });

const runUpdated = (status: string) => ({
  type: "run.updated",
  payload: { id: RUN, threadId: THREAD, status, completedAt: null },
});

/** The events the handler hears, as a queue to await: the test never polls. */
const heard = (port: { subscribeTurnCompleted: Function }) =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<Record<string, unknown>>();
    port.subscribeTurnCompleted({ threadId: THREAD }, (event: Record<string, unknown>) => {
      Queue.offerUnsafe(queue, event);
    });
    return queue;
  });

it.live("a failed run's event carries the provider text from the run's error item", () =>
  Effect.gen(function* () {
    const text = "You hit your ChatGPT usage limit (plus plan). Try again in ~600 min.";
    const { port, reads } = yield* portWith(
      [runUpdated("failed")],
      [() => projectionOf([errorItem(RUN, 1, text)])],
    );
    const event = yield* Queue.take(yield* heard(port));
    assert.deepEqual(
      { outcome: event.outcome, errorText: event.errorText, threadId: event.threadId },
      { outcome: "failed", errorText: text, threadId: THREAD },
    );
    assert.equal(reads(), 1, "the text was there at once: no retry");
  }),
);

it.live(
  "an error item that is not projected yet is read again once (after 250 ms), then the event goes without text",
  () =>
    Effect.gen(function* () {
      const text = "the provider said no";
      const late = yield* portWith(
        [runUpdated("failed")],
        [() => projectionOf([]), () => projectionOf([errorItem(RUN, 1, text)])],
      );
      const lateEvent = yield* Queue.take(yield* heard(late.port));
      assert.equal(lateEvent.errorText, text);
      assert.equal(late.reads(), 2);

      const never = yield* portWith([runUpdated("failed")], [() => projectionOf([])]);
      const neverEvent = yield* Queue.take(yield* heard(never.port));
      assert.equal(neverEvent.outcome, "failed");
      assert.isFalse("errorText" in neverEvent, "no guess: the event goes without text");
      assert.equal(never.reads(), 2, "one read and one bounded retry, no more");
    }),
);

it.live("a completed run carries no text and reads no projection for it", () =>
  Effect.gen(function* () {
    const done = yield* portWith(
      [runUpdated("completed")],
      [() => projectionOf([errorItem(RUN, 1, "stale")])],
    );
    const event = yield* Queue.take(yield* heard(done.port));
    assert.equal(event.outcome, "completed");
    assert.isFalse("errorText" in event);
    // A thread scope needs no projection to match, and a completed run needs none for text.
    assert.equal(done.reads(), 0);
  }),
);

it.effect(
  "readLastRun carries the text of a failed newest run and null for one that has none",
  () =>
    Effect.gen(function* () {
      const text = "limit";
      const withText = yield* portWith([], [() => projectionOf([errorItem(RUN, 1, text)])]);
      const run = yield* Effect.promise(() => withText.port.readLastRun({ threadId: THREAD }));
      assert.isTrue(run.ok);
      assert.equal(run.ok && run.run?.errorText, text);
      const without = yield* portWith([], [() => projectionOf([])]);
      const none = yield* Effect.promise(() => without.port.readLastRun({ threadId: THREAD }));
      assert.equal(none.ok && none.run?.errorText, null);
      const completed = yield* portWith(
        [],
        [
          () =>
            projectionOf(
              [errorItem(RUN, 1, "x")],
              [{ id: RUN, ordinal: 1, status: "completed", completedAt: null }],
            ),
        ],
      );
      const fine = yield* Effect.promise(() => completed.port.readLastRun({ threadId: THREAD }));
      assert.equal(fine.ok && fine.run?.errorText, null, "a completed run has no error text");
    }),
);
