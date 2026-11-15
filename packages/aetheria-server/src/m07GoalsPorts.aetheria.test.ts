// AETHERIA M07 Plan step 14 — the real port adapters between the Backend's services and the goals service (goals/ports.ts), over scripted services. It shows each adapter's translation and its
// fail-closed rule: a service that is not running, a reply that cannot be had and a throw are `unavailable` and never absent, never a decision, never admitted; M06's verdicts map to the goals
// vocabulary field for field; a child resolves as a child and an unreadable identity as unavailable; the receipt is read on the session's own thread. It does NOT show the real M05, M06 or T3
// services behind them (m07GoalsBackend, m07AdmissionState and the apps/server tests do).
import { describe, expect, it } from "vite-plus/test";

import type { HumanControlService } from "./humanControl.ts";
import {
  createAdmissionPort,
  createGoalRootResolver,
  createInteractionPort,
  createNoticePort,
  createThreadReceiptPort,
} from "./goals/ports.ts";
import type { OrchestrationDirectApi } from "./orchestration.ts";

const authority = { kind: "backend-module", module: "goals-backend" } as const;
const expectation = {
  kind: "authorization",
  subject: { type: "goal-mutation", id: "p", revision: "r" },
  sessionId: "s",
} as const;
const bad = () => {
  throw new Error("boom");
};

describe("root resolver", () => {
  const binding = { threadId: "t1", providerSessionId: "p1", providerInstanceId: "pi" };
  const index = (found: boolean) => ({
    bindingOfSession: () => (found ? (binding as never) : undefined),
  });
  it("maps a main identity to main, a child to child, and everything else to unavailable with its reason", () => {
    const main = createGoalRootResolver({
      index: index(true),
      resolve: () => ({
        ok: true,
        kind: "main",
        sessionId: "s",
        rootSessionId: "s",
        parentChain: [],
        role: null,
      }),
    });
    expect(main.resolve("s")).toEqual({ kind: "main", rootSessionId: "s" });
    const child = createGoalRootResolver({
      index: index(true),
      resolve: () => ({
        ok: true,
        kind: "child",
        sessionId: "c",
        rootSessionId: "s",
        parentChain: ["s"],
        role: "worker",
      }),
    });
    expect(child.resolve("c")).toEqual({ kind: "child", rootSessionId: "s" });
    const refused = createGoalRootResolver({
      index: index(true),
      resolve: () => ({
        ok: false,
        outcome: "refused",
        code: "XC6_IDENTITY_RETIRED",
        reason: "retired",
      }),
    });
    expect(refused.resolve("s")).toEqual({ kind: "unavailable", reason: "retired" });
    expect(createGoalRootResolver({ index: index(false), resolve: bad }).resolve("s")).toEqual({
      kind: "unavailable",
      reason: "no-single-thread-binding",
    });
    expect(createGoalRootResolver({ index: index(true), resolve: bad }).resolve("s")).toEqual({
      kind: "unavailable",
      reason: "boom",
    });
  });
  it("hands the resolver the binding's own thread facts and the claimed session, never anything else", () => {
    const seen: unknown[] = [];
    createGoalRootResolver({
      index: index(true),
      resolve: (caller, claimed) => (
        seen.push(caller, claimed),
        { ok: false, outcome: "unavailable", code: "x", reason: "r" }
      ),
    }).resolve("s");
    expect(seen).toEqual([binding, "s"]);
  });
});

describe("interaction port", () => {
  const record = (resolution?: unknown) => ({
    interactionId: "i1",
    state: resolution === undefined ? "pending" : "answered",
    resolution,
  });
  const service = (over: Record<string, unknown>) =>
    ({ ...over }) as unknown as HumanControlService;
  it("carries the card and the origin id of a settled one, and no origin id for a pending or superseded one", async () => {
    const port = createInteractionPort(() =>
      service({
        createAuthorization: async () => ({ ok: true, value: record() }),
        awaitInteraction: async (id: string) => ({
          ok: true,
          value:
            id === "d"
              ? record({ type: "decision", decision: "approved", originId: "o1" })
              : id === "s"
                ? record({ type: "superseded", by: "x" })
                : record(),
        }),
      }),
    );
    expect(
      await port.createAuthorization({
        sessionId: "s",
        text: "t",
        subject: { type: "goal-mutation", id: "p", revision: "r" },
      }),
    ).toEqual({ ok: true, value: { interactionId: "i1", state: "pending" } });
    expect(await port.awaitInteraction("d")).toEqual({
      ok: true,
      value: { interactionId: "i1", state: "answered", originId: "o1" },
    });
    expect(await port.awaitInteraction("s")).toEqual({
      ok: true,
      value: { interactionId: "i1", state: "answered" },
    });
    expect(await port.awaitInteraction("p")).toEqual({
      ok: true,
      value: { interactionId: "i1", state: "pending" },
    });
  });
  it("maps M06's verdicts field for field and reads every missing answer as unavailable, never verified", async () => {
    const verdict = (value: unknown) =>
      createInteractionPort(() => service({ verifyHumanOrigin: async () => value }));
    const origin = {
      kind: "authorization",
      decision: "declined",
      rootSessionId: "r",
      sessionId: "s",
      originId: "o",
      subject: {},
    };
    expect(await verdict({ verified: true, origin }).verifyHumanOrigin("o", expectation)).toEqual({
      verified: true,
      origin: { decision: "declined", rootSessionId: "r", sessionId: "s" },
    });
    expect(
      await verdict({
        verified: false,
        code: "ORIGIN_MISMATCH",
        field: "subject.id",
      }).verifyHumanOrigin("o", expectation),
    ).toEqual({ verified: false, code: "ORIGIN_MISMATCH", field: "subject.id" });
    expect(
      await verdict({ verified: false, code: "ORIGIN_STALE" }).verifyHumanOrigin("o", expectation),
    ).toEqual({ verified: false, code: "ORIGIN_STALE" });
    expect(
      await verdict({ verified: false, code: "ORIGIN_NOT_FOUND" }).verifyHumanOrigin(
        "o",
        expectation,
      ),
    ).toEqual({ verified: false, code: "ORIGIN_NOT_FOUND" });
    expect(
      await verdict({ ok: false, code: "INTERACTION_UNAVAILABLE" }).verifyHumanOrigin(
        "o",
        expectation,
      ),
    ).toEqual({ unavailable: true, reason: "INTERACTION_UNAVAILABLE" });
    expect(
      await createInteractionPort(() => service({ verifyHumanOrigin: bad })).verifyHumanOrigin(
        "o",
        expectation,
      ),
    ).toEqual({ unavailable: true, reason: "boom" });
    const absent = createInteractionPort(() => undefined);
    expect(await absent.verifyHumanOrigin("o", expectation)).toMatchObject({ unavailable: true });
    expect(
      await absent.createAuthorization({
        sessionId: "s",
        text: "t",
        subject: { type: "a", id: "b", revision: "c" },
      }),
    ).toEqual({ ok: false, code: "INTERACTION_UNAVAILABLE" });
    expect(await absent.awaitInteraction("i")).toEqual({
      ok: false,
      code: "INTERACTION_UNAVAILABLE",
    });
    expect(
      await createInteractionPort(() => service({ awaitInteraction: bad })).awaitInteraction("i"),
    ).toEqual({ ok: false, code: "INTERACTION_UNAVAILABLE" });
  });
});

describe("admission and notice ports", () => {
  const direct = (over: Record<string, unknown>) => over as unknown as OrchestrationDirectApi;
  it("pass M05's answers through unchanged and read a missing, throwing or unsubscribable direct API as unavailable", async () => {
    const present = createAdmissionPort(() =>
      direct({
        admitTurn: async () => ({ status: "admitted", messageId: "m" }),
        admissionState: async () => ({ status: "admitting", messageId: "m" }),
        interruptTurn: async () => ({ status: "accepted" }),
        subscribeSettled: () => ({ status: "subscribed", unsubscribe: () => undefined }),
      }),
    );
    const request = {
      authority,
      sessionId: "s",
      origin: { kind: "goal-round", goalId: "g", revision: 1, round: 1 },
      content: "c",
      key: "k",
    } as const;
    expect(await present.admitTurn(request)).toEqual({ status: "admitted", messageId: "m" });
    expect(await present.admissionState({ authority, sessionId: "s", key: "k" })).toEqual({
      status: "admitting",
      messageId: "m",
    });
    expect(await present.interruptTurn!({ authority, sessionId: "s" })).toEqual({
      status: "accepted",
    });
    expect(
      present.subscribeSettled({ authority, scope: { sessionId: "s" }, handler: () => undefined })
        .status,
    ).toBe("subscribed");
    for (const port of [
      createAdmissionPort(() => undefined),
      createAdmissionPort(() =>
        direct({ admitTurn: bad, admissionState: bad, interruptTurn: bad, subscribeSettled: bad }),
      ),
    ]) {
      expect((await port.admitTurn(request)).status).toBe("unavailable");
      expect((await port.admissionState({ authority, sessionId: "s", key: "k" })).status).toBe(
        "unavailable",
      );
      expect((await port.interruptTurn!({ authority, sessionId: "s" })).status).toBe("unavailable");
      expect(
        port.subscribeSettled({ authority, scope: { sessionId: "s" }, handler: () => undefined })
          .status,
      ).toBe("unavailable");
    }
  });
  it("carries the notice calls with the trusted authority and reads a stopped or failing outbox as unavailable and unknown", async () => {
    const seen: unknown[] = [];
    const port = createNoticePort(() =>
      direct({
        goalNoticeEnqueue: async (r: unknown) => (
          seen.push(r),
          { status: "queued", created: true }
        ),
        goalNoticeDeliver: async () => ({ status: "delivered" }),
        goalNoticeState: async () => "inserted",
      }),
    );
    expect(await port.enqueue({ authority, sessionId: "s", key: "k", text: "t" })).toEqual({
      status: "queued",
      created: true,
    });
    expect(seen).toEqual([{ authority, sessionId: "s", key: "k", text: "t" }]);
    expect(await port.deliver({ authority, sessionId: "s", key: "k" })).toEqual({
      status: "delivered",
    });
    expect(await port.state({ authority, key: "k" })).toBe("inserted");
    for (const stopped of [
      createNoticePort(() => undefined),
      createNoticePort(() =>
        direct({ goalNoticeEnqueue: bad, goalNoticeDeliver: bad, goalNoticeState: bad }),
      ),
    ]) {
      expect(
        (await stopped.enqueue({ authority, sessionId: "s", key: "k", text: "t" })).status,
      ).toBe("unavailable");
      expect((await stopped.deliver({ authority, sessionId: "s", key: "k" })).status).toBe(
        "unavailable",
      );
      expect(await stopped.state({ authority, key: "k" })).toBe("unknown");
    }
  });
});

describe("thread receipt port", () => {
  it("reads the receipt on the session's own thread: present, absent, and unavailable for an unknown thread, an unreadable projection or a throw", async () => {
    const reads: unknown[] = [];
    const threads = {
      readMessageReceipt: async (r: { messageId: string }) => (
        reads.push(r),
        r.messageId === "bad"
          ? { ok: false, reason: "unavailable" }
          : { ok: true, found: r.messageId === "here" }
      ),
    } as never;
    const port = createThreadReceiptPort({
      threads,
      threadOf: (s) => (s === "s" ? "t1" : undefined),
    });
    expect(await port.hasMessage("s", "here")).toBe("present");
    expect(await port.hasMessage("s", "gone")).toBe("absent");
    expect(await port.hasMessage("s", "bad")).toBe("unavailable");
    expect(await port.hasMessage("nobody", "here")).toBe("unavailable");
    expect(reads).toEqual([
      { threadId: "t1", messageId: "here" },
      { threadId: "t1", messageId: "gone" },
      { threadId: "t1", messageId: "bad" },
    ]);
    expect(
      await createThreadReceiptPort({
        threads: { readMessageReceipt: bad } as never,
        threadOf: () => "t1",
      }).hasMessage("s", "m"),
    ).toBe("unavailable");
  });
});
