// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off
// AETHERIA M06 Plan steps 13-14 (D2, D17) — abandoned question segments beyond XC-6's 256-entry pending table, and a drain while every segment is open.
//
// Boundary: T3's real XC-6 carrier core (`createXc6Backend`) with the PRODUCTION `maxPending` of 256 over the real Backend service, the module's real
// operations and the REAL `@aetheria/interaction` archive service and file store in a scratch state root. Only the clock is faked. It shows: 300 open
// await segments whose callers never read a reply (more than the table could hold if M06 minted tokens) mint no token and answer `done`, another
// operation still succeeds while they are open, the carrier's token generator is never called, and the fake clock holds no timer of M06's afterwards;
// a disposal with all 300 segments open finishes, reports no live waiter, settles every segment `done`, releases the owner lock and leaves the state
// root byte-identical when later time passes. It does NOT show the HTTP route, a real Pi tool, real elapsed time (the macOS scenario run measures
// that), or that the archive's drain order is right under a write failure (the archive suites and `humanControlResume.aetheria.test.ts`).
/* oxlint-disable t3code/no-wall-clock-in-tests, t3code/no-polling-loop-in-tests, t3code/no-real-time-wait-in-tests -- The drain under test does real file I/O (one journal write per live wait) while the fake clock stands still, so no segment can end by its own bound; the only milestone is the drain's own completion, which arrives from the file system outside any fake clock, so the test yields real event-loop turns until it does, with a 30 s real bound. */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { createAetheriaBackendService } from "@t3tools/aetheria-server";
import { describe, expect, it, vi } from "vitest";

import { createXc6Backend, type Xc6Operation } from "./xc6Core.ts";

const PRODUCTION_MAX_PENDING = 256;
const ABANDONED = PRODUCTION_MAX_PENDING + 44;
const LOCK_FILE = "backend-owner.lock";

const caller = { threadId: "thread-1", providerSessionId: "ps-1", providerInstanceId: "pi" };
const stateRoot = () => {
  const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  return NodeFS.mkdtempSync(NodePath.join(base, "m06-s14-stress-"));
};
const tree = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const entry of NodeFS.readdirSync(current, { withFileTypes: true })) {
      const path = NodePath.join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else out[NodePath.relative(dir, path)] = NodeFS.readFileSync(path, "utf8");
    }
  };
  walk(dir);
  return out;
};

const setup = async () => {
  const root = stateRoot();
  const made = createAetheriaBackendService({ stateRoot: root, credentialOf: () => undefined });
  if (made.outcome !== "prepared") throw new Error("must prepare");
  const { service } = made;
  expect((await service.start()).outcome).toBe("started");
  const operations: Record<string, Xc6Operation> = { ...service.operations() };
  const newToken = vi.fn(() => `token-${Math.random()}`);
  const carrier = createXc6Backend({
    identity: () => ({ ok: true, sessionId: "session-1", kind: "main", rootSessionId: "root-1" }),
    operations,
    newToken,
    log: () => {},
    maxPending: PRODUCTION_MAX_PENDING,
  });
  const call = (op: string, args: Record<string, unknown>) =>
    carrier.handle({ caller, claimedSessionId: "session-1", body: { v: 1, op, args } });
  const create = async (callId: string) => {
    const created = await call("interaction.create", {
      kind: "question",
      callId,
      questions: [{ id: "q1", question: "Which?" }],
    });
    return (created.body as { result: { value: { interactionId: string } } }).result.value
      .interactionId;
  };
  const ids: string[] = [];
  for (let n = 0; n < ABANDONED; n += 1) ids.push(await create(`call-${n}`));
  return { root, service, carrier, call, create, ids, newToken };
};

const bodyOf = (response: { body: { status: string; result?: unknown } }) => response.body;

describe("abandoned segments beyond the carrier's pending table", () => {
  it("opens more segments than maxPending without a token, while another operation still succeeds, and leaks no timer", async () => {
    vi.useFakeTimers();
    try {
      const { service, carrier, call, create, ids, newToken } = await setup();
      const baseline = vi.getTimerCount();
      // Every caller is gone: nobody reads any of these replies.
      const open = ids.map((interactionId) => call("interaction.await", { interactionId }));
      await vi.advanceTimersByTimeAsync(50);
      expect(ids.length).toBeGreaterThan(PRODUCTION_MAX_PENDING);
      // Another operation, on the same carrier, while all of them are open.
      const another = await create("call-another");
      expect(another).toMatch(/\S/);
      const released = bodyOf(
        await call("interaction.release", { interactionId: ids[0]!, cause: "abort" }),
      );
      expect(released.status).toBe("done");
      await vi.advanceTimersByTimeAsync(5600);
      const replies = (await Promise.all(open)).map(bodyOf);
      expect(replies.every((reply) => reply.status === "done")).toBe(true);
      expect(newToken).not.toHaveBeenCalled();
      const poll = await carrier.handle({
        caller,
        claimedSessionId: "session-1",
        body: { v: 1, poll: "any-token" },
      });
      expect(poll.body).toMatchObject({ status: "refused", code: "XC6_POLL_REFUSED" });
      // The segments' own and the module's guard timers are gone; only the Backend's pre-existing ones may remain.
      expect(vi.getTimerCount()).toBeLessThanOrEqual(baseline);
      await service.dispose("test");
    } finally {
      vi.useRealTimers();
    }
  });

  it("finishes a disposal with every segment open, settles them all, keeps no timer and mutates nothing afterwards", async () => {
    // `setImmediate` stays real: the drain does real file I/O and the loop below yields to it.
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    try {
      const { root, service, call, ids, newToken } = await setup();
      const baseline = vi.getTimerCount();
      const open = ids.map((interactionId) => call("interaction.await", { interactionId }));
      await vi.advanceTimersByTimeAsync(50);
      const disposing = service.dispose("server-teardown");
      const progress = { finished: false };
      void disposing.then(() => {
        progress.finished = true;
      });
      // Real I/O inside the drain (one journal write per live wait): give it up to 30 real seconds, with the fake clock standing still, so no
      // segment can end by its own bound and only the drain settles them.
      const deadline = performance.now() + 30_000;
      while (!progress.finished && performance.now() < deadline) {
        await vi.advanceTimersByTimeAsync(0);
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(progress.finished, "the drain did not finish while all segments were open").toBe(true);
      const report = await disposing;
      expect(report.ok).toBe(true);
      expect(report.stillLive).toEqual([]);
      const replies = (await Promise.all(open)).map(bodyOf);
      expect(replies.every((reply) => reply.status !== "pending")).toBe(true);
      expect(newToken).not.toHaveBeenCalled();
      expect(NodeFS.existsSync(NodePath.join(root, LOCK_FILE))).toBe(false);
      expect(vi.getTimerCount()).toBeLessThanOrEqual(baseline);
      // No callback of the drained Backend writes any more.
      const after = tree(root);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(tree(root)).toEqual(after);
      expect(service.status().phase).toBe("disposed");
    } finally {
      vi.useRealTimers();
    }
  });
});
