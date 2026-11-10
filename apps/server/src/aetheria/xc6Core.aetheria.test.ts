// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// (B9 probe: plain Node/JSON code at the carrier boundary; the production Backend rewrites this per the host's Effect conventions.)
// AETHERIA B9 probe (M04 Plan step 11): the XC-6 carrier core, tested on its own boundary — request validation, caller identity,
// explicit unavailable, pending token + repoll, cross-session poll refusal and observer-only snapshots. No HTTP here; the route
// test (xc6Route.aetheria.test.ts) proves the same core behind T3's real bearer registry.
import { describe, expect, it } from "@effect/vitest";

import { createXc6Backend, type Xc6Identity, type Xc6Operation } from "./xc6Core.ts";

const caller = { threadId: "thread-1", providerSessionId: "ps-1", providerInstanceId: "pi" };
const otherCaller = { threadId: "thread-2", providerSessionId: "ps-2", providerInstanceId: "pi" };

const identity = (caller: { threadId: string }, claimed: string | null): Xc6Identity => {
  if (claimed === null)
    return { ok: false, outcome: "unavailable", code: "XC6_IDENTITY_UNAVAILABLE" };
  const owner = caller.threadId === "thread-1" ? "session-A" : "session-B";
  return claimed === owner
    ? { ok: true, sessionId: claimed, kind: "main", rootSessionId: claimed }
    : { ok: false, outcome: "refused", code: "XC6_IDENTITY_MISMATCH" };
};

let counter = 0;
const make = (operations: Record<string, Xc6Operation>, events: unknown[] = []) =>
  createXc6Backend({
    identity,
    operations,
    newToken: () => `token-${++counter}`,
    log: (event) => events.push(event),
    maxPending: 2,
  });

const call = (body: unknown, who = caller, session: string | null = "session-A") => ({
  caller: who,
  claimedSessionId: session,
  body,
});

describe("XC-6 carrier core", () => {
  it("answers a request with the identity the Backend verified, never one from the body", async () => {
    let seen: unknown;
    const backend = make({
      "probe.whoami": (context) => {
        seen = {
          sessionId: context.sessionId,
          threadId: context.caller.threadId,
          args: context.args,
        };
        return { status: "done", result: { sessionId: context.sessionId } };
      },
    });
    const reply = await backend.handle(
      call({
        v: 1,
        op: "probe.whoami",
        args: { sessionId: "session-VICTIM", callerSessionId: "session-VICTIM" },
      }),
    );
    expect(reply.http).toBe(200);
    expect(reply.body).toEqual({ v: 1, status: "done", result: { sessionId: "session-A" } });
    expect(seen).toEqual({
      sessionId: "session-A",
      threadId: "thread-1",
      args: { sessionId: "session-VICTIM", callerSessionId: "session-VICTIM" },
    });
  });

  it("refuses a body that tries to carry caller identity at the top level, before any operation runs", async () => {
    let ran = false;
    const backend = make({ "probe.whoami": () => ((ran = true), { status: "done", result: {} }) });
    for (const extra of [
      "callerSessionId",
      "sessionId",
      "threadId",
      "providerSessionId",
      "caller",
    ]) {
      const reply = await backend.handle(call({ v: 1, op: "probe.whoami", [extra]: "x" }));
      expect(reply.http, extra).toBe(400);
      expect(reply.body).toMatchObject({ status: "refused", code: "XC6_BAD_REQUEST" });
    }
    expect(ran).toBe(false);
  });

  it("refuses malformed requests with a stable code and never throws", async () => {
    const backend = make({ "probe.whoami": () => ({ status: "done", result: {} }) });
    for (const body of [
      null,
      7,
      "x",
      [],
      {},
      { v: 2, op: "probe.whoami" },
      { v: 1 },
      { v: 1, op: "Bad Op" },
      { v: 1, op: "probe.whoami", poll: "t" },
      { v: 1, op: "probe.whoami", args: [] },
      { v: 1, poll: 5 },
    ]) {
      const reply = await backend.handle(call(body));
      expect(reply.http, JSON.stringify(body)).toBe(400);
      expect(reply.body).toMatchObject({ status: "refused", code: "XC6_BAD_REQUEST" });
    }
  });

  it("refuses an unknown operation and runs nothing", async () => {
    const reply = await make({}).handle(call({ v: 1, op: "board.write" }));
    expect(reply.http).toBe(404);
    expect(reply.body).toMatchObject({ status: "refused", code: "XC6_UNKNOWN_OPERATION" });
  });

  it("returns an explicit unavailable reply from an operation, as a result and not a failure", async () => {
    const backend = make({
      "probe.unavailable": () => ({ status: "unavailable", code: "BOARD_UNAVAILABLE" }),
    });
    const reply = await backend.handle(call({ v: 1, op: "probe.unavailable" }));
    expect(reply.http).toBe(200);
    expect(reply.body).toEqual({ v: 1, status: "unavailable", code: "BOARD_UNAVAILABLE" });
  });

  it("lets an operation refuse a verified caller with a stable code: a refused reply, 403, with the code and nothing else", async () => {
    const events: unknown[] = [];
    const backend = make(
      { "probe.refuse": () => ({ status: "refused", code: "AUTH_TOOL_NOT_ALLOWED" }) },
      events,
    );
    const reply = await backend.handle(call({ v: 1, op: "probe.refuse" }));
    expect(reply.http).toBe(403);
    expect(reply.body).toEqual({ v: 1, status: "refused", code: "AUTH_TOOL_NOT_ALLOWED" });
    expect(events).toEqual([
      { kind: "call", op: "probe.refuse", status: "refused", code: "AUTH_TOOL_NOT_ALLOWED" },
    ]);
  });

  it("delivers a refusal that settles later as the same refused reply on the poll", async () => {
    const backend = make({
      "probe.slow-refuse": () => ({
        status: "pending",
        settle: Promise.resolve({ status: "refused", code: "AUTH_ROLE_REMOVED" } as const),
      }),
    });
    const started = await backend.handle(call({ v: 1, op: "probe.slow-refuse" }));
    const token = (started.body as { token: string }).token;
    await Promise.resolve();
    const polled = await backend.handle(call({ v: 1, poll: token }));
    expect(polled.http).toBe(403);
    expect(polled.body).toEqual({ v: 1, status: "refused", code: "AUTH_ROLE_REMOVED" });
  });

  it("reports an operation that throws as an error reply without its message", async () => {
    const backend = make({
      boom: () => {
        throw new Error("secret detail in message");
      },
    });
    const reply = await backend.handle(call({ v: 1, op: "boom" }));
    expect(reply.http).toBe(500);
    expect(reply.body).toEqual({ v: 1, status: "error", code: "XC6_OPERATION_FAILED" });
  });

  it("refuses identity mismatch, and answers unavailable when identity is not yet resolvable; neither runs the operation", async () => {
    let ran = 0;
    const backend = make({ "probe.whoami": () => (ran++, { status: "done", result: {} }) });
    const mismatch = await backend.handle(call({ v: 1, op: "probe.whoami" }, caller, "session-B"));
    expect(mismatch.http).toBe(403);
    expect(mismatch.body).toMatchObject({ status: "refused", code: "XC6_IDENTITY_MISMATCH" });
    const none = await backend.handle(call({ v: 1, op: "probe.whoami" }, caller, null));
    expect(none.http).toBe(200);
    expect(none.body).toMatchObject({ status: "unavailable", code: "XC6_IDENTITY_UNAVAILABLE" });
    expect(ran).toBe(0);
  });

  it("returns a pending token, answers pending on repoll, then the completed result once", async () => {
    let finish!: (value: { status: "done"; result: unknown }) => void;
    const settle = new Promise<{ status: "done"; result: unknown }>(
      (resolve) => (finish = resolve),
    );
    const backend = make({ "probe.slow": () => ({ status: "pending", settle }) });
    const first = await backend.handle(call({ v: 1, op: "probe.slow" }));
    expect(first.http).toBe(200);
    expect(first.body).toEqual({ v: 1, status: "pending", token: "token-" + counter });
    const token = (first.body as { token: string }).token;

    const early = await backend.handle(call({ v: 1, poll: token }));
    expect(early.body).toEqual({ v: 1, status: "pending", token });

    finish({ status: "done", result: { n: 42 } });
    await settle;
    const done = await backend.handle(call({ v: 1, poll: token }));
    expect(done.body).toEqual({ v: 1, status: "done", result: { n: 42 } });

    const again = await backend.handle(call({ v: 1, poll: token }));
    expect(again.http).toBe(403);
    expect(again.body).toMatchObject({ status: "refused", code: "XC6_POLL_REFUSED" });
  });

  it("refuses a poll from another session or provider session exactly as it refuses an unknown token", async () => {
    const settle = new Promise<never>(() => {});
    const backend = make({ "probe.slow": () => ({ status: "pending", settle }) });
    const { body } = await backend.handle(call({ v: 1, op: "probe.slow" }));
    const token = (body as { token: string }).token;
    const foreign = await backend.handle(call({ v: 1, poll: token }, otherCaller, "session-B"));
    const sameThreadOtherProviderSession = await backend.handle(
      call({ v: 1, poll: token }, { ...caller, providerSessionId: "ps-other" }),
    );
    const unknown = await backend.handle(call({ v: 1, poll: "no-such-token" }));
    for (const reply of [foreign, sameThreadOtherProviderSession, unknown]) {
      expect(reply.http).toBe(403);
      expect(reply.body).toEqual({ v: 1, status: "refused", code: "XC6_POLL_REFUSED" });
    }
    // the owner still polls fine afterwards: a refused poll consumed nothing
    expect((await backend.handle(call({ v: 1, poll: token }))).body).toMatchObject({
      status: "pending",
    });
  });

  it("re-verifies identity on every poll, so a record that went away cannot collect a result", async () => {
    let live = true;
    const backend = createXc6Backend({
      identity: (c, claimed) =>
        live
          ? identity(c, claimed)
          : { ok: false, outcome: "refused", code: "XC6_IDENTITY_MISMATCH" },
      operations: {
        slow: () => ({ status: "pending", settle: Promise.resolve({ status: "done", result: 1 }) }),
      },
      newToken: () => "t",
      log: () => {},
      maxPending: 2,
    });
    await backend.handle(call({ v: 1, op: "slow" }));
    live = false;
    const reply = await backend.handle(call({ v: 1, poll: "t" }));
    expect(reply.http).toBe(403);
  });

  it("bounds the pending table and says unavailable when full", async () => {
    const settle = new Promise<never>(() => {});
    const backend = make({ slow: () => ({ status: "pending", settle }) });
    await backend.handle(call({ v: 1, op: "slow" }));
    await backend.handle(call({ v: 1, op: "slow" }));
    const full = await backend.handle(call({ v: 1, op: "slow" }));
    expect(full.body).toMatchObject({ status: "unavailable", code: "XC6_PENDING_FULL" });
  });

  it("logs only operation, status and code: never arguments, results, tokens or session ids", async () => {
    const events: unknown[] = [];
    const backend = make({ echo: (context) => ({ status: "done", result: context.args }) }, events);
    await backend.handle(call({ v: 1, op: "echo", args: { text: "PAYLOAD-SENTINEL-TEXT" } }));
    await backend.handle(
      call({ v: 1, op: "echo", args: { text: "PAYLOAD-SENTINEL-TEXT" } }, caller, "session-B"),
    );
    const text = JSON.stringify(events);
    expect(events.length).toBe(2);
    expect(text).not.toContain("PAYLOAD-SENTINEL-TEXT");
    expect(text).not.toContain("session-A");
    expect(text).not.toContain("thread-1");
    for (const event of events)
      expect(Object.keys(event as object).sort()).toEqual(
        ["code", "kind", "op", "status"].filter((k) => k in (event as object)).sort(),
      );
  });
});

describe("XC-6 observer-only attachment", () => {
  it("receives frozen snapshots without arguments or results, and exposes nothing to call, register or reply", async () => {
    const backend = make({
      echo: (context) => ({ status: "done", result: { secret: context.args } }),
    });
    const seen: any[] = [];
    const handle = backend.observe((snapshot) => {
      seen.push(snapshot);
    });
    expect(Object.keys(handle).sort()).toEqual(["close"]);
    const reply = await backend.handle(
      call({ v: 1, op: "echo", args: { text: "PAYLOAD-SENTINEL-TEXT" } }),
    );
    expect(seen).toHaveLength(1);
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(seen[0]).toEqual({ kind: "call", op: "echo", status: "done" });
    expect(JSON.stringify(seen)).not.toContain("PAYLOAD-SENTINEL-TEXT");
    expect(reply.body).toEqual({
      v: 1,
      status: "done",
      result: { secret: { text: "PAYLOAD-SENTINEL-TEXT" } },
    });
    handle.close();
    await backend.handle(call({ v: 1, op: "echo" }));
    expect(seen).toHaveLength(1);
  });

  it("cannot alter a reply: mutation attempts fail or have no effect, and listener errors are swallowed", async () => {
    const backend = make({ echo: () => ({ status: "done", result: { n: 1 } }) });
    let mutationThrew = false;
    backend.observe((snapshot) => {
      try {
        (snapshot as { status: string }).status = "refused";
      } catch {
        mutationThrew = true;
      }
      (snapshot as { status: string }).status = "refused";
      throw new Error("observer throws");
    });
    backend.observe(async () => {
      throw new Error("observer rejects");
    });
    const reply = await backend.handle(call({ v: 1, op: "echo" }));
    expect(mutationThrew).toBe(true);
    expect(reply).toEqual({ http: 200, body: { v: 1, status: "done", result: { n: 1 } } });
  });
});
