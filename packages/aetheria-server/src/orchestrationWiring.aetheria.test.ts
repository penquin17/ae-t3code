// AETHERIA M05 Plan step 6 (D13, D17, C2 resume) — the Backend's small seams around the children service: the production XC-10 `childStatus` and the resume barrier.
//
// Boundary. Both are pure logic over injected ports: the child-status adapter over a scripted thread index and a scripted service, the barrier over scripted
// promises. They show the translation (XC-10 session ids to the service's, never equated to thread ids), the unavailable-not-guess rule and the ordering
// (M06's reconcile then redeliver completes before the barrier opens). They do not show the real service or M06's real handling.
import { describe, expect, it } from "vite-plus/test";

import { createChildStatus } from "./orchestrationChildStatus.ts";
import type { OrchestrationService } from "./orchestration.ts";
import { createResumeBarrier } from "./orchestrationResume.ts";

const service = (reply: unknown): OrchestrationService & { calls: unknown[][] } => {
  const calls: unknown[][] = [];
  return {
    calls,
    start: async () => ({ ok: true }),
    handle: (async (...args: unknown[]) => {
      calls.push(args);
      if (reply instanceof Error) throw reply;
      return reply;
    }) as OrchestrationService["handle"],
    drain: async () => ({ stopped: [], stillLive: [] }),
    direct: () => undefined,
  };
};
const bound = new Set(["root-1", "child-1"]);
const index = {
  bindingOfSession: (id: string) => (bound.has(id) ? { threadId: `t-${id}` } : undefined),
};

describe("production childStatus (XC-10)", () => {
  it("asks the service as the root session main, with the child's session id, and returns owned and state", async () => {
    const fake = service({ ok: true, value: { owned: true, state: "idle" } });
    const status = createChildStatus({ index, service: () => fake });
    expect(await status("root-1", "child-1")).toEqual({ owned: true, state: "idle" });
    expect(fake.calls).toEqual([
      [
        "children.status",
        { sessionId: "root-1", rootSessionId: "root-1", kind: "main" },
        { childSessionId: "child-1" },
      ],
    ]);
  });

  it("returns a closed child as closed and an unowned one as not owned", async () => {
    expect(
      await createChildStatus({
        index,
        service: () => service({ ok: true, value: { owned: true, state: "closed" } }),
      })("root-1", "child-1"),
    ).toEqual({ owned: true, state: "closed" });
    expect(
      await createChildStatus({
        index,
        service: () => service({ ok: true, value: { owned: false, state: "unknown" } }),
      })("root-1", "child-1"),
    ).toEqual({ owned: false, state: "unknown" });
  });

  it("is unavailable (a throw the board turns into UNAVAILABLE) when ownership or the service is unknown", async () => {
    const cases: Array<[string, () => OrchestrationService | undefined, string, string]> = [
      ["no service", () => undefined, "root-1", "child-1"],
      [
        "unknown ownership",
        () => service({ ok: true, value: { owned: "unknown", state: "idle" } }),
        "root-1",
        "child-1",
      ],
      [
        "service failure",
        () => service({ ok: false, code: "ORCHESTRATION_UNAVAILABLE" }),
        "root-1",
        "child-1",
      ],
      ["lost reply", () => service(new Error("lost")), "root-1", "child-1"],
      ["malformed reply", () => service({ ok: true, value: { owned: true } }), "root-1", "child-1"],
      [
        "unbound root",
        () => service({ ok: true, value: { owned: true, state: "idle" } }),
        "ghost",
        "child-1",
      ],
    ];
    for (const [label, make, root, child] of cases) {
      await expect(
        createChildStatus({ index, service: make })(root, child),
        label,
      ).rejects.toThrow();
    }
  });
});

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
