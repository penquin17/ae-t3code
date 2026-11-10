// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off
// AETHERIA M06 Plan step 6 (D2) — an open question segment consumes ZERO XC-6 pending tokens.
//
// Boundary: T3's real XC-6 carrier core (`createXc6Backend`, which awaits an operation before it could mint a token and frees a token only on a
// poll) over the real Backend service with the module's real operations and the REAL `@aetheria/interaction` archive service and file store in a
// scratch state root. Only the clock is faked. It shows: a segment that stays open for its whole bound, a caller that never reads its reply, a
// carrier whose pending table holds nothing at all (`maxPending: 0`), a release during a segment and a disposal during a segment each answer `done`
// and never `pending`, and no token exists to poll afterwards. It does NOT show the HTTP route, a real Pi tool, or the 256-entry production table.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { createAetheriaBackendService } from "@t3tools/aetheria-server";
import { afterAll, describe, expect, it, vi } from "vitest";

import { createXc6Backend, type Xc6Operation } from "./xc6Core.ts";

/** Seeded mutation: report an open segment as an XC-6 pending result. The test must then fail. */
const OPEN_SEGMENT_AS_PENDING = false;

const caller = { threadId: "thread-1", providerSessionId: "ps-1", providerInstanceId: "pi" };
const stateRoot = () => {
  const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  const root = NodeFS.mkdtempSync(NodePath.join(base, "m06-s06-xc6-"));
  scratchRoots.push(root);
  return root;
};
// The scratch state roots this file creates; removed after all its cases.
const scratchRoots: string[] = [];
afterAll(() => {
  for (const root of scratchRoots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

const setup = async () => {
  const made = createAetheriaBackendService({
    stateRoot: stateRoot(),
    credentialOf: () => undefined,
  });
  if (made.outcome !== "prepared") throw new Error("must prepare");
  const { service } = made;
  expect((await service.start()).outcome).toBe("started");
  const operations: Record<string, Xc6Operation> = { ...service.operations() };
  if (OPEN_SEGMENT_AS_PENDING) {
    const real = operations["interaction.await"]!;
    operations["interaction.await"] = (context) => ({
      status: "pending",
      settle: Promise.resolve(real(context)).then((r) => r as never),
    });
  }
  const carrier = createXc6Backend({
    identity: () => ({ ok: true, sessionId: "session-1", kind: "main", rootSessionId: "root-1" }),
    operations,
    newToken: () => `token-${Math.random()}`,
    log: () => {},
    maxPending: 0,
  });
  const call = (op: string, args: Record<string, unknown>) =>
    carrier.handle({ caller, claimedSessionId: "session-1", body: { v: 1, op, args } });
  const created = await call("interaction.create", {
    kind: "question",
    callId: "call-1",
    questions: [{ id: "q1", question: "Which?" }],
  });
  const interactionId = (created.body as { result: { value: { interactionId: string } } }).result
    .value.interactionId;
  return { service, carrier, call, interactionId };
};

const reply = (response: { body: { status: string; result?: unknown } }) => response.body;

describe("an open question segment holds no XC-6 pending slot", () => {
  it("settles done at its bound, with a pending table of size zero, and leaves no token to poll", async () => {
    vi.useFakeTimers();
    try {
      const { service, carrier, call, interactionId } = await setup();
      const open = call("interaction.await", { interactionId });
      await vi.advanceTimersByTimeAsync(5100);
      const settled = reply(await open);
      expect(settled.status).toBe("done");
      expect(settled).toMatchObject({ result: { ok: true, value: { state: "pending" } } });
      const poll = await carrier.handle({
        caller,
        claimedSessionId: "session-1",
        body: { v: 1, poll: "any-token" },
      });
      expect(poll.body).toMatchObject({ status: "refused", code: "XC6_POLL_REFUSED" });
      await service.dispose("test");
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles done when the caller never reads the reply (caller death), and again for the next call", async () => {
    vi.useFakeTimers();
    try {
      const { service, call, interactionId } = await setup();
      void call("interaction.await", { interactionId }); // the caller is gone: nobody reads this reply
      await vi.advanceTimersByTimeAsync(5100);
      const next = call("interaction.await", { interactionId });
      await vi.advanceTimersByTimeAsync(5100);
      expect(reply(await next).status).toBe("done");
      await service.dispose("test");
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles done early on release, and on disposal, never pending", async () => {
    vi.useFakeTimers();
    try {
      const first = await setup();
      const open = first.call("interaction.await", { interactionId: first.interactionId });
      await vi.advanceTimersByTimeAsync(10);
      const released = reply(
        await first.call("interaction.release", {
          interactionId: first.interactionId,
          cause: "abort",
        }),
      );
      expect(released.status).toBe("done");
      expect(reply(await open).status).toBe("done");
      await first.service.dispose("test");

      const second = await setup();
      const inFlight = second.call("interaction.await", { interactionId: second.interactionId });
      await vi.advanceTimersByTimeAsync(10);
      const disposed = second.service.dispose("server-teardown");
      await vi.advanceTimersByTimeAsync(10);
      expect(reply(await inFlight).status).not.toBe("pending");
      expect((await disposed).stillLive).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
