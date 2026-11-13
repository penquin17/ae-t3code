import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { connectedView, notConnectedView, showConnection } from "../connection/testing";
import { createControlActions, type ActionReport, type SnapshotRead } from "./actions";
import type {
  ControlTransport,
  InteractionRecord,
  InteractionsSnapshot,
  TransportResult,
} from "./types";

const ROOT = "root-1";
const REV = "c".repeat(64);
const record = (id: string, over: Record<string, unknown> = {}): InteractionRecord =>
  ({
    interactionId: id,
    state: "pending",
    revision: REV,
    rootSessionId: ROOT,
    sessionId: ROOT,
    createdAt: "2026-01-01T00:00:00Z",
    held: false,
    kind: "question",
    content: { questions: [{ id: "q", question: "Which?" }] },
    ...over,
  }) as InteractionRecord;
const ok = (value: unknown): TransportResult => ({ tag: "reply", reply: { ok: true, value } });
const refused = (code: string, extra: object = {}): TransportResult => ({
  tag: "reply",
  reply: { ok: false, code, ...extra },
});
const shows = (...records: InteractionRecord[]): SnapshotRead => ({
  tag: "ok",
  snapshot: {
    rootSessionId: ROOT,
    version: 9,
    interactions: records,
  } satisfies InteractionsSnapshot,
});

function setup(
  answers: Partial<Record<keyof ControlTransport, TransportResult>>,
  read: SnapshotRead,
) {
  const calls: Array<{ method: string; payload: unknown }> = [];
  const transport = new Proxy({} as ControlTransport, {
    get: (_t, method: string) => async (_env: string, payload: unknown) => {
      calls.push({ method, payload });
      return answers[method as keyof ControlTransport] ?? ({ tag: "lost" } as TransportResult);
    },
  });
  const readSnapshot = vi.fn(async () => read);
  let n = 0;
  const actions = createControlActions({
    transport,
    environmentId: "env",
    rootSessionId: ROOT,
    newRequestId: () => `req-${(n += 1)}`,
    readSnapshot,
  });
  return { actions, calls, readSnapshot };
}
const outcomeOf = (report: ActionReport<unknown>) => (report.sent ? report.outcome : null);

const answered = record("i-1", { state: "answered" });

describe("each of the seven actions sends its own method once with exactly the payload", () => {
  const answerPayload = {
    interactionId: "i-1",
    revision: REV,
    answers: [{ id: "q", selected: ["Red"], skipped: false }],
  };
  const subject = { type: "tool", id: "t", revision: REV };
  const CASES = [
    ["answer", "answer", answerPayload, ok(answered), shows(answered)],
    [
      "cancel",
      "cancel",
      { interactionId: "i-1", revision: REV, feedback: "no" },
      ok(record("i-1", { state: "cancelled" })),
      shows(record("i-1", { state: "cancelled" })),
    ],
    [
      "hold",
      "hold",
      { interactionId: "i-1", revision: REV },
      ok(record("i-1", { held: true })),
      shows(record("i-1", { held: true })),
    ],
    [
      "close",
      "close",
      { interactionId: "i-1", revision: REV },
      ok(record("i-1")),
      shows(record("i-1")),
    ],
    [
      "planDecide",
      "planDecide",
      { interactionId: "i-1", revision: REV, decision: "approved" },
      ok(answered),
      shows(answered),
    ],
    [
      "planModeSet",
      "planModeSet",
      { sessionId: ROOT, active: true, expectedModeRevision: 3 },
      ok({ sessionId: ROOT, active: true, modeRevision: 4 }),
      shows(),
    ],
    [
      "grant",
      "authorizationGrant",
      { subject, sessionId: ROOT },
      ok({ originId: "org-1" }),
      shows(),
    ],
  ] as const;

  it.each(CASES)("%s", async (action, method, payload, reply, read) => {
    const { actions, calls } = setup(
      { [method]: reply, planModeGet: ok({ sessionId: ROOT, active: true, modeRevision: 4 }) },
      read,
    );
    const report = await (
      actions as unknown as Record<string, (p: unknown) => Promise<{ sent: boolean }>>
    )[action]!(payload);
    expect(report.sent).toBe(true);
    expect(calls.filter((call) => call.method === method)).toEqual([{ method, payload }]);
  });
});

describe("an accepted reply is confirmed only by the Backend's own projection", () => {
  it("answer: confirmed and refreshed when the snapshot shows it answered", async () => {
    const { actions } = setup({ answer: ok(answered) }, shows(answered));
    const report = await actions.answer({ interactionId: "i-1", revision: REV, answers: [] });
    expect(outcomeOf(report)).toMatchObject({ kind: "confirmed", refreshed: true });
  });

  it("answer: unknown when the snapshot still shows it pending", async () => {
    const { actions } = setup({ answer: ok(answered) }, shows(record("i-1")));
    const report = await actions.answer({ interactionId: "i-1", revision: REV, answers: [] });
    expect(outcomeOf(report)).toMatchObject({ kind: "unknown" });
  });

  it("answer: unknown when the re-read fails, and the reason names the step and the read failure", async () => {
    const { actions } = setup({ answer: ok(answered) }, { tag: "failed", reason: "read refused" });
    const report = await actions.answer({ interactionId: "i-1", revision: REV, answers: [] });
    expect(outcomeOf(report)).toMatchObject({
      kind: "unknown",
      reason: expect.stringMatching(/"Answer" was accepted.*reading.*back failed \(read refused\)/),
    });
  });

  it("two cards with similar ids: the answer reaches, and is confirmed against, exactly its own interaction", async () => {
    const { actions, calls } = setup(
      { answer: ok(record("q-10", { state: "answered" })) },
      shows(record("q-1", { state: "answered" }), record("q-10")),
    );
    const report = await actions.answer({ interactionId: "q-10", revision: REV, answers: [] });
    expect(calls[0]?.payload).toMatchObject({ interactionId: "q-10" });
    expect(outcomeOf(report)).toMatchObject({ kind: "unknown" });
  });

  it("hold is confirmed by the held flag, not by a state change", async () => {
    const { actions } = setup(
      { hold: ok(record("i-1", { held: true })) },
      shows(record("i-1", { held: true })),
    );
    expect(outcomeOf(await actions.hold({ interactionId: "i-1", revision: REV }))).toMatchObject({
      kind: "confirmed",
      refreshed: true,
    });
  });

  it("close changes no state, so it is confirmed without a read-back and the view is re-read", async () => {
    const { actions, readSnapshot } = setup({ close: ok(record("i-1")) }, shows(record("i-1")));
    const outcome = outcomeOf(await actions.close({ interactionId: "i-1", revision: REV }));
    expect(outcome).toMatchObject({ kind: "confirmed", refreshed: false });
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it("plan mode is confirmed by reading the mode back", async () => {
    const set = { sessionId: ROOT, active: true, modeRevision: 4 };
    const payload = { sessionId: ROOT, active: true, expectedModeRevision: 3 };
    const good = setup({ planModeSet: ok(set), planModeGet: ok(set) }, shows());
    expect(outcomeOf(await good.actions.planModeSet(payload))).toMatchObject({ refreshed: true });
    const behind = setup(
      { planModeSet: ok(set), planModeGet: ok({ ...set, modeRevision: 3, active: false }) },
      shows(),
    );
    expect(outcomeOf(await behind.actions.planModeSet(payload))).toMatchObject({ kind: "unknown" });
  });

  it("a grant returns its origin id as supplied and claims no read-back", async () => {
    const { actions } = setup({ authorizationGrant: ok({ originId: "org-9" }) }, shows());
    const report = await actions.grant({
      subject: { type: "t", id: "x", revision: REV },
      sessionId: ROOT,
    });
    expect(outcomeOf(report)).toMatchObject({
      kind: "confirmed",
      refreshed: false,
      value: { originId: "org-9" },
    });
  });
});

describe("what is not accepted is never resent and never called done", () => {
  it.each([
    [
      "INTERACTION_UNAVAILABLE reply",
      refused("INTERACTION_UNAVAILABLE", { detail: "nothing was done" }),
    ],
    ["lost reply", { tag: "lost" } as TransportResult],
  ])("a %s is unknown, sent once, and the view is re-read", async (_name, reply) => {
    const { actions, calls, readSnapshot } = setup({ answer: reply }, shows(record("i-1")));
    const report = await actions.answer({ interactionId: "i-1", revision: REV, answers: [] });
    expect(outcomeOf(report)).toMatchObject({ kind: "unknown" });
    expect(calls).toHaveLength(1);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it("a read-only or foreign-actor refusal is shown with its own words and prompts no read", async () => {
    const { actions, readSnapshot } = setup(
      {
        answer: refused("INTERACTION_ORIGIN_NOT_HUMAN", {
          detail: "the connection's scopes do not allow operating",
        }),
      },
      shows(),
    );
    const report = await actions.answer({ interactionId: "i-1", revision: REV, answers: [] });
    expect(outcomeOf(report)).toEqual({
      kind: "refused",
      code: "INTERACTION_ORIGIN_NOT_HUMAN",
      message: "the connection's scopes do not allow operating",
    });
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it("a stale revision is a conflict and the view is re-read to adopt the new revision", async () => {
    const { actions, readSnapshot } = setup(
      {
        answer: refused("INTERACTION_STALE_REVISION", {
          detail: "the content changed since the human saw it",
        }),
      },
      shows(record("i-1")),
    );
    const report = await actions.answer({ interactionId: "i-1", revision: REV, answers: [] });
    expect(report.sent && report.reply.class).toBe("stale-revision");
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it("already-settled keeps the settling record and delivery-failed keeps its record", async () => {
    const settled = record("i-1", { state: "cancelled" });
    const a = setup(
      { cancel: refused("INTERACTION_ALREADY_SETTLED", { record: settled }) },
      shows(settled),
    );
    const settledReport = await a.actions.cancel({ interactionId: "i-1", revision: REV });
    expect(settledReport.sent && settledReport.reply.record).toEqual(settled);
    const d = setup(
      {
        answer: refused("INTERACTION_DELIVERY_FAILED", {
          record: answered,
          detail: "session gone",
        }),
      },
      shows(answered),
    );
    const delivery = await d.actions.answer({ interactionId: "i-1", revision: REV, answers: [] });
    expect(delivery.sent && delivery.reply).toMatchObject({
      class: "delivery-failed",
      record: answered,
    });
    expect(outcomeOf(delivery)).toMatchObject({ kind: "refused", message: "session gone" });
  });
});

describe("a second action on the same target while one is in flight sends nothing", () => {
  it("the second answer is not sent", async () => {
    let release: (value: TransportResult) => void = () => {};
    const calls: unknown[] = [];
    const transport = {
      answer: (_env: string, payload: unknown) => {
        calls.push(payload);
        return new Promise<TransportResult>((resolve) => (release = resolve));
      },
    } as unknown as ControlTransport;
    const actions = createControlActions({
      transport,
      environmentId: "env",
      rootSessionId: ROOT,
      newRequestId: () => "r",
      readSnapshot: async () => shows(answered),
    });
    const payload = { interactionId: "i-1", revision: REV, answers: [] };
    const first = actions.answer(payload);
    expect(await actions.answer(payload)).toEqual({ sent: false });
    expect(await actions.hold({ interactionId: "i-1", revision: REV })).toEqual({ sent: false });
    release(ok(answered));
    expect((await first).sent).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("a send while the connection does not allow actions is blocked and never sent (review finding 2)", () => {
  const subject = { type: "tool", id: "t", revision: REV };
  const SENDS = {
    answer: (a: ReturnType<typeof setup>["actions"]) =>
      a.answer({ interactionId: "i-1", revision: REV, answers: [] }),
    cancel: (a: ReturnType<typeof setup>["actions"]) =>
      a.cancel({ interactionId: "i-1", revision: REV }),
    hold: (a: ReturnType<typeof setup>["actions"]) =>
      a.hold({ interactionId: "i-1", revision: REV }),
    close: (a: ReturnType<typeof setup>["actions"]) =>
      a.close({ interactionId: "i-1", revision: REV }),
    planDecide: (a: ReturnType<typeof setup>["actions"]) =>
      a.planDecide({ interactionId: "i-1", revision: REV, decision: "approve" } as never),
    planModeSet: (a: ReturnType<typeof setup>["actions"]) =>
      a.planModeSet({ sessionId: ROOT, active: true } as never),
    grant: (a: ReturnType<typeof setup>["actions"]) => a.grant({ subject, scope: "once" } as never),
  } as const;
  const ALL = Object.keys(SENDS) as Array<keyof typeof SENDS>;
  let hide = () => {};
  afterEach(() => hide());

  it.each(ALL)(
    "%s sends nothing, is unavailable in the gate's words, and re-reads nothing",
    async (name) => {
      hide = showConnection(notConnectedView);
      const h = setup({}, shows(answered));
      const report = await SENDS[name](h.actions);
      expect(h.calls).toEqual([]);
      expect(h.readSnapshot).not.toHaveBeenCalled();
      expect(outcomeOf(report)).toMatchObject({ kind: "unavailable" });
      expect((outcomeOf(report) as { reason: string }).reason).toMatch(/nothing was sent/i);
    },
  );

  it("is sent once the connection allows actions, and the blocked one is not sent later", async () => {
    hide = showConnection(notConnectedView);
    const h = setup({ answer: ok(answered) }, shows(answered));
    await SENDS.answer(h.actions);
    hide = showConnection(connectedView);
    expect(h.calls).toEqual([]);
    const report = await SENDS.answer(h.actions);
    expect(h.calls).toHaveLength(1);
    expect(outcomeOf(report)).toMatchObject({ kind: "confirmed" });
  });
});
