import { describe, expect, it } from "vite-plus/test";

import { isOpen, recordFacts, reportNotice } from "./recordText";
import type { ActionReport } from "./actions";
import type { InteractionRecord } from "./types";

const base = {
  interactionId: "i-1",
  revision: "d".repeat(64),
  rootSessionId: "r",
  sessionId: "r",
  createdAt: "2026-01-01T00:00:00Z",
  held: false,
  kind: "question",
  content: { questions: [{ id: "q", question: "Which?" }] },
};
const rec = (over: Record<string, unknown>) =>
  ({ ...base, state: "pending", ...over }) as InteractionRecord;

describe("a record's state is said as the Backend supplied it", () => {
  it("only pending and continued records are open", () => {
    expect(isOpen(rec({}))).toBe(true);
    expect(isOpen(rec({ state: "continued", continuedCause: "host-stop" }))).toBe(true);
    for (const state of ["answered", "cancelled", "superseded"]) {
      expect(isOpen(rec({ state, resolution: { type: "superseded", by: "x" } }))).toBe(false);
    }
  });

  it("pending says it waits; held and a deadline are added as supplied", () => {
    expect(recordFacts(rec({})).headline).toBe("Waiting for your answer");
    const facts = recordFacts(rec({ held: true, deadlineAt: "2026-01-02T00:00:00Z" }));
    expect(facts.lines).toContain("Held.");
    expect(facts.lines).toContain("Deadline: 2026-01-02T00:00:00Z");
  });

  it("continued names the cause and says a late answer is delivered late", () => {
    const facts = recordFacts(rec({ state: "continued", continuedCause: "backend-restart" }));
    expect(facts.headline).toBe("The agent stopped waiting (backend-restart)");
    expect(facts.lines.join(" ")).toMatch(/delivered late/);
  });

  it("answered shows its origin and each delivery state as supplied, never 'delivered' by default", () => {
    const answered = (delivery?: object) =>
      rec({
        state: "answered",
        resolution: { type: "answers", answers: [], originId: "org-1" },
        ...(delivery === undefined ? {} : { delivery }),
      });
    expect(recordFacts(answered()).headline).toBe("Answered");
    expect(recordFacts(answered()).lines).toContain("Origin: org-1");
    expect(recordFacts(answered()).lines.join(" ")).not.toMatch(/deliver/i);
    expect(recordFacts(answered({ status: "pending" })).lines).toContain("Delivery pending.");
    expect(recordFacts(answered({ status: "delivered", commandId: "cmd-1" })).lines).toContain(
      "Delivered (command cmd-1).",
    );
    expect(recordFacts(answered({ status: "failed", code: "SESSION_GONE" })).lines).toContain(
      "Delivery failed (SESSION_GONE).",
    );
  });

  it("an authorization leaves its origin to the card's origin box, so it is shown once", () => {
    const facts = recordFacts(
      rec({
        state: "answered",
        kind: "authorization",
        content: { text: "Allow?", subject: { type: "t", id: "x", revision: "r" } },
        resolution: { type: "answers", answers: [], originId: "org-1" },
      }),
    );
    expect(facts.lines.join(" ")).not.toContain("org-1");
  });

  it("a plan decision says which decision", () => {
    const facts = recordFacts(
      rec({
        state: "answered",
        kind: "plan-review",
        content: { plan: "# P", reviewNumber: 2 },
        resolution: {
          type: "decision",
          decision: "changes_requested",
          feedback: "tighter",
          originId: "o",
        },
      }),
    );
    expect(facts.headline).toBe("Changes requested");
    expect(facts.lines).toContain("Feedback: tighter");
  });

  it("cancelled shows its feedback and the mode-off cause as supplied", () => {
    const facts = recordFacts(
      rec({
        state: "cancelled",
        resolution: { type: "cancelled", feedback: "no", cause: "mode-off" },
      }),
    );
    expect(facts.headline).toBe("Cancelled");
    expect(facts.lines).toContain("Feedback: no");
    expect(facts.lines).toContain("Plan mode was switched off.");
  });

  it("superseded names its replacement", () => {
    const facts = recordFacts(
      rec({ state: "superseded", resolution: { type: "superseded", by: "i-2" } }),
    );
    expect(facts.headline).toBe("Superseded by i-2");
  });
});

describe("what an action report says", () => {
  const sent = (
    outcome: object,
    reply: object = { class: "accepted", reread: true },
  ): ActionReport<unknown> =>
    ({ sent: true, requestId: "r", current: true, outcome, reply }) as ActionReport<unknown>;

  it("claims done only when a re-read showed it", () => {
    expect(
      reportNotice("Answer", sent({ kind: "confirmed", value: 1, refreshed: true }))?.text,
    ).toBe("Answer done.");
    const unrefreshed = reportNotice(
      "Answer",
      sent({ kind: "confirmed", value: 1, refreshed: false }),
    );
    expect(unrefreshed?.text).toMatch(/sent; .* when the backend reports it/i);
    expect(unrefreshed?.text).not.toMatch(/done/);
  });

  it("unknown says it may or may not have applied and was not sent again", () => {
    const notice = reportNotice(
      "Answer",
      sent({ kind: "unknown", reason: "lost" }, { class: "unknown", reread: true }),
    );
    expect(notice?.text).toMatch(/not known whether it applied/);
    expect(notice?.text).toMatch(/not sent again/);
  });

  it("a delivery failure says the answer was recorded but not delivered", () => {
    const notice = reportNotice(
      "Answer",
      sent(
        { kind: "refused", code: "INTERACTION_DELIVERY_FAILED", message: "gone" },
        { class: "delivery-failed", reread: true },
      ),
    );
    expect(notice?.text).toMatch(/recorded/);
    expect(notice?.text).toMatch(/not delivered/);
    expect(notice?.text).not.toMatch(/unchanged/i);
  });

  it("a stale revision says the content changed and the old draft cannot be sent against the new one", () => {
    const notice = reportNotice(
      "Answer",
      sent(
        { kind: "refused", code: "INTERACTION_STALE_REVISION", message: "" },
        { class: "stale-revision", reread: true },
      ),
    );
    expect(notice?.text).toMatch(/changed/);
  });

  it("nothing is said for an action that was not sent", () => {
    expect(reportNotice("Answer", { sent: false })).toBeNull();
  });

  it("a plain refusal has no notice text of its own: the view shows it verbatim", () => {
    expect(
      reportNotice(
        "Answer",
        sent(
          { kind: "refused", code: "INTERACTION_ORIGIN_NOT_HUMAN", message: "m" },
          { class: "refused", reread: false },
        ),
      ),
    ).toBeNull();
  });
});
