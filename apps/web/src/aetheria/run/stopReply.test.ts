// M10 Plan step 5 (D4, D5, R1, C3): how a Backend reply to the user's Stop becomes one honest outcome. A reply is a value or a coded refusal; a refusal that says the effect may have landed is
// "unknown", never "refused" and never retried; M05's partial child failures and an unconfirmed root stop are "partly done", never "stopped".
import { describe, expect, it } from "vitest";

import type { ActionOutcome } from "../core/outcome";
import {
  stopNotice,
  stopOutcomeFromAccepted,
  stopSendResult,
  type CancelTreeValue,
} from "./stopReply";

const tree = (overrides: Partial<CancelTreeValue> = {}): CancelTreeValue => ({
  rootThreadId: "root",
  rows: [
    { childId: "c1", action: "interrupted" },
    { childId: "c2", action: "closed" },
    { childId: "c3", action: "left-idle" },
  ],
  rootStopped: true,
  complete: true,
  ...overrides,
});

describe("stopSendResult", () => {
  it("accepts a value", () => {
    expect(stopSendResult({ ok: true, value: tree() })).toEqual({ tag: "accepted", value: tree() });
  });

  it("reads a refusal the Backend made before acting as refused, with its own words", () => {
    for (const code of [
      "CHILDREN_NOT_AUTHORIZED",
      "NOT_AUTHORIZED",
      "CHILDREN_DEVICE_REVOKED",
      "CHILDREN_NOT_FOUND",
      "CHILD_NOT_OWNED",
      "CHILD_NOT_ADJACENT",
      "CHILD_NOT_RESUMABLE",
    ])
      expect(stopSendResult({ ok: false, code, detail: "because" })).toMatchObject({
        tag: "refused",
        code,
      });
    expect(stopSendResult({ ok: false, code: "CHILDREN_DEVICE_REVOKED" })).toMatchObject({
      message: expect.stringContaining("revoked"),
    });
    expect(stopSendResult({ ok: false, code: "CHILDREN_NOT_AUTHORIZED" })).toMatchObject({
      message: expect.stringContaining("cannot stop"),
    });
  });

  it("reads anything that is not a reply as a lost reply, never a pass", () => {
    for (const odd of [undefined, null, "ok", 7, {}, { ok: "yes" }])
      expect(stopSendResult(odd as never)).toEqual({ tag: "lost" });
  });

  it("reads 'nothing was done' as unavailable", () => {
    expect(
      stopSendResult({ ok: false, code: "CHILDREN_UNAVAILABLE", detail: "x; nothing was done" }),
    ).toEqual({
      tag: "unavailable",
      reason: "x; nothing was done",
    });
  });

  it("reads every code that may have landed, and any code it does not know, as a lost reply", () => {
    for (const code of [
      "CHILDREN_OUTCOME_UNKNOWN",
      "ORCHESTRATION_UNAVAILABLE",
      "CHILD_DELIVERY_UNAVAILABLE",
      "CHILD_PARENT_UNAVAILABLE",
      "A_CODE_FROM_THE_FUTURE",
    ])
      expect(stopSendResult({ ok: false, code })).toEqual({ tag: "lost" });
  });
});

describe("stopOutcomeFromAccepted", () => {
  const confirmed = (value: CancelTreeValue): ActionOutcome<CancelTreeValue> => ({
    kind: "confirmed",
    value,
    refreshed: false,
  });

  it("keeps a complete stop confirmed", () => {
    expect(stopOutcomeFromAccepted(confirmed(tree()))).toEqual(confirmed(tree()));
  });

  it("turns an incomplete tree stop into partly done and names what applied and what did not", () => {
    const outcome = stopOutcomeFromAccepted(
      confirmed(
        tree({
          rows: [
            { childId: "c1", action: "interrupted" },
            { childId: "c2", action: "failed", detail: "the close was not confirmed (X)" },
            { childId: "c3", action: "unavailable", detail: "T3 could not report the activity" },
            { childId: "c4", action: "left-idle" },
          ],
          complete: false,
        }),
      ),
    );
    expect(outcome.kind).toBe("partial");
    if (outcome.kind !== "partial") return;
    expect(outcome.applied).toEqual(["interrupted c1", "left c4 idle"]);
    expect(outcome.failed.outcome.kind).toBe("unknown");
    const text = stopNotice(outcome).text;
    expect(text).toContain("c2");
    expect(text).toContain("the close was not confirmed (X)");
    expect(text).toContain("c3");
    expect(text).toContain("not known whether it applied");
  });

  it("says when only the root's stop was not confirmed", () => {
    const outcome = stopOutcomeFromAccepted(
      confirmed(tree({ rootStopped: false, complete: false })),
    );
    expect(outcome.kind).toBe("partial");
    expect(stopNotice(outcome).text).toContain("root");
  });

  it("leaves other outcomes alone", () => {
    const refused: ActionOutcome<CancelTreeValue> = { kind: "refused", code: "X", message: "no" };
    expect(stopOutcomeFromAccepted(refused)).toBe(refused);
  });
});

describe("stopNotice", () => {
  it("is silent about a confirmed stop: the running indicator shows stopping and settled", () => {
    expect(stopNotice({ kind: "confirmed", value: tree(), refreshed: false }).tone).toBe("ok");
  });

  it("never turns a lost reply into success or into 'nothing happened'", () => {
    const notice = stopNotice({ kind: "unknown", reason: "The reply never arrived." });
    expect(notice.tone).toBe("warning");
    expect(notice.text).toContain("not known whether it applied");
    expect(notice.text).toContain("not sent again");
  });

  it("shows a refusal's words and an unavailable Backend as an error", () => {
    expect(
      stopNotice({ kind: "refused", code: "CHILDREN_NOT_FOUND", message: "not for you" }),
    ).toMatchObject({
      tone: "error",
      text: expect.stringContaining("not for you"),
    });
    expect(
      stopNotice({
        kind: "unavailable",
        reason: "the children service is not running; nothing was done",
      }),
    ).toMatchObject({
      tone: "error",
      text: expect.stringContaining("nothing was done"),
    });
  });
});
