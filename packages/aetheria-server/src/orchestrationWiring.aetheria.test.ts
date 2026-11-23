// AETHERIA M05 Plan step 6 (D17, C2 resume) — the Backend's small seam around the children service: the resume barrier. (The production XC-10 `childStatus` adapter for the board's
// `assign` was removed with `assign` in v1p2 step 4; `children.status` itself stays, in the children service.)
//
// Boundary. Pure logic over scripted promises. It shows the ordering (M06's reconcile then redeliver completes before the barrier opens). It does not show the real service or M06's real handling.
import { describe, expect, it } from "vite-plus/test";

import { createResumeBarrier } from "./orchestrationResume.ts";

describe("resume barrier (C2: M05 deliveries wait for M06's resume handling)", () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("opens at once when no resume is in progress for the session", async () => {
    const barrier = createResumeBarrier();
    await barrier.resumed("s-1");
  });

  it("holds a session's deliveries until the resume handling has finished, and only that session's", async () => {
    const barrier = createResumeBarrier();
    const handling = deferred();
    const done = barrier.track("s-1", handling.promise);
    const order: string[] = [];
    const waited = barrier.resumed("s-1").then(() => order.push("barrier"));
    await barrier.resumed("s-2");
    order.push("other-session");
    expect(order).toEqual(["other-session"]);
    handling.resolve();
    await done;
    await waited;
    expect(order).toEqual(["other-session", "barrier"]);
  });

  it("opens even when the handling fails, and never rejects the waiter", async () => {
    const barrier = createResumeBarrier();
    const failing = Promise.reject(new Error("reconcile failed"));
    const tracked = barrier.track("s-1", failing);
    await barrier.resumed("s-1");
    await expect(tracked).resolves.toBeUndefined();
  });

  it("waits for every overlapping resume of the same session", async () => {
    const barrier = createResumeBarrier();
    const first = deferred();
    const second = deferred();
    void barrier.track("s-1", first.promise);
    void barrier.track("s-1", second.promise);
    let open = false;
    const waited = barrier.resumed("s-1").then(() => (open = true));
    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(open).toBe(false);
    second.resolve();
    await waited;
    expect(open).toBe(true);
  });
});
