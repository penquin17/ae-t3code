// M10 Plan step 10 (D2, C7): how the Backend's list of a root's children becomes rows, and how a read keeps one owner. Boundary: pure functions over supplied replies; no T3, no DOM.
import { describe, expect, it } from "vitest";

import type { ActionOutcome, SendResult } from "../core/outcome";
import {
  childStopNotice,
  finishRead,
  initialListState,
  listViewFromSend,
  rowViews,
  startRead,
  stopWithReadBack,
  type ChildrenListValue,
  type ListView,
} from "./model";

const row = (overrides: Record<string, unknown> = {}) => ({
  childId: "c1",
  parentId: "root",
  depth: 1,
  role: "researcher",
  mode: "continuable",
  state: "running",
  lastOutcome: null,
  route: 1,
  ...overrides,
});
const list = (rows: unknown[], diagnostics: unknown[] = []) =>
  ({ rows, diagnostics }) as unknown as ChildrenListValue;
const accepted = (value: unknown): SendResult<unknown> => ({
  tag: "accepted",
  value: { ok: true, value },
});

describe("rowViews", () => {
  it("keeps the Backend's order, mode, label and state exactly as supplied", () => {
    const views = rowViews(
      list([
        row({ childId: "b", mode: "one-shot", state: "idle", label: "Budget check" }),
        row({ childId: "a", state: "closed" }),
      ]),
    );
    expect(views.map((view) => view.childId)).toEqual(["b", "a"]);
    expect(views[0]).toMatchObject({
      mode: "one-shot",
      modeText: "One-shot",
      state: "idle",
      stateText: "Idle",
      label: "Budget check",
      name: "Budget check",
    });
    expect(views[1]).toMatchObject({ mode: "continuable", state: "closed", name: "a" });
  });

  it("never reads an unreadable state as idle, closed or empty", () => {
    const [view] = rowViews(list([row({ state: "unknown" })]));
    expect(view?.state).toBe("unknown");
    expect(view?.stateText).toBe("Unknown");
    expect(view?.stateKnown).toBe(false);
    expect(view?.stateText).not.toMatch(/idle|closed|stopped/i);
  });

  it("carries the last outcome's status and cause verbatim, and says none when there is none", () => {
    const [failed, none] = rowViews(
      list([
        row({ lastOutcome: { status: "failed", cause: "the provider said: 429 (rate)" } }),
        row({ childId: "c2", lastOutcome: null }),
      ]),
    );
    expect(failed?.lastOutcomeText).toBe("Last turn: failed (the provider said: 429 (rate))");
    expect(none?.lastOutcomeText).toBe("No finished turn is recorded.");
  });

  it("attaches a diagnostic to the row it names, verbatim, and keeps the rest as unattached", () => {
    const value = list(
      [row()],
      [
        { kind: "corrupt", id: "c1", detail: "route record: bad JSON at 12" },
        { kind: "unavailable", id: "other" },
      ],
    );
    const [view] = rowViews(value);
    expect(view?.diagnostics).toEqual([
      { kind: "corrupt", id: "c1", detail: "route record: bad JSON at 12" },
    ]);
  });
});

describe("a read has one owner and never mixes roots", () => {
  const view = (text: string): ListView => ({ tag: "unavailable", reason: text });

  it("a stale reply is ignored when a newer read began", () => {
    const first = startRead(initialListState("root-a"), "root-a");
    const second = startRead(first.state, "root-a");
    const afterStale = finishRead(second.state, first.ticket, "root-a", view("old"));
    expect(afterStale).toEqual(second.state);
    const afterCurrent = finishRead(afterStale, second.ticket, "root-a", view("new"));
    expect(afterCurrent.view).toEqual(view("new"));
    expect(afterCurrent.refreshing).toBe(false);
  });

  it("a reply for another root changes nothing, and a new root starts from reading", () => {
    const a = startRead(initialListState("root-a"), "root-a");
    const shown = finishRead(a.state, a.ticket, "root-a", {
      tag: "read",
      list: list([row({ childId: "of-a" })]),
    });
    const b = startRead(shown, "root-b");
    expect(b.state.view).toEqual({ tag: "reading" });
    expect(b.state.rootThreadId).toBe("root-b");
    expect(finishRead(b.state, a.ticket, "root-a", view("late")).view).toEqual({ tag: "reading" });
  });

  it("a refresh of the same root keeps the last answer on screen until the new one lands", () => {
    const first = startRead(initialListState("r"), "r");
    const shown = finishRead(first.state, first.ticket, "r", { tag: "read", list: list([]) });
    const again = startRead(shown, "r");
    expect(again.state.view).toEqual({ tag: "read", list: list([]) });
    expect(again.state.refreshing).toBe(true);
  });
});

describe("listViewFromSend", () => {
  it("reads a list reply, and keeps an empty list as a known empty list", () => {
    expect(listViewFromSend(accepted({ rows: [], diagnostics: [] }))).toEqual({
      tag: "read",
      list: { rows: [], diagnostics: [] },
    });
  });

  it.each([
    ["CHILDREN_NOT_AUTHORIZED", "refused"],
    ["CHILDREN_DEVICE_REVOKED", "refused"],
    ["CHILDREN_NOT_FOUND", "refused"],
    ["CHILD_NOT_OWNED", "refused"],
    ["SOMETHING_NEW", "refused"],
    ["CHILDREN_UNAVAILABLE", "unavailable"],
    ["CHILDREN_OUTCOME_UNKNOWN", "unknown"],
    ["ORCHESTRATION_UNAVAILABLE", "unknown"],
  ] as const)("a %s reply is %s, with the Backend's detail kept", (code, tag) => {
    const view = listViewFromSend({
      tag: "accepted",
      value: { ok: false, code, detail: "backend words" },
    });
    expect(view.tag).toBe(tag);
    expect(JSON.stringify(view)).toContain("backend words");
    if (view.tag === "refused") expect(view.code).toBe(code);
  });

  it("a reply that is not a list is unknown, never an empty list", () => {
    for (const value of [null, "x", { ok: true }, { ok: true, value: { rows: 3 } }]) {
      expect(listViewFromSend({ tag: "accepted", value }).tag).toBe("unknown");
    }
  });

  it("a lost reply is unknown, a failed command a refusal, and an unavailable send unavailable", () => {
    expect(listViewFromSend({ tag: "lost" }).tag).toBe("unknown");
    expect(listViewFromSend({ tag: "refused", code: "COMMAND_FAILED", message: "no" })).toEqual({
      tag: "refused",
      code: "COMMAND_FAILED",
      detail: "no",
    });
    expect(listViewFromSend({ tag: "unavailable", reason: "offline" }).tag).toBe("unavailable");
  });
});

describe("a Stop and the re-read after it", () => {
  const closed: ActionOutcome<unknown> = {
    kind: "confirmed",
    value: { closed: true, killedJobs: ["job-1", "job-2"] },
    refreshed: false,
  };

  it("a close followed by a list that could not be re-read shows both results, as a partial", () => {
    const outcome = stopWithReadBack(closed, "c1", "one-shot", {
      tag: "unknown",
      reason: "the reply never arrived",
    });
    expect(outcome).toMatchObject({
      kind: "partial",
      applied: ["closed c1"],
      failed: { step: "the list re-read", outcome: { kind: "unknown" } },
    });
  });

  it("an interrupt followed by a refused re-read keeps the refusal's code and message", () => {
    const outcome = stopWithReadBack(
      { kind: "confirmed", value: { accepted: true }, refreshed: false },
      "c1",
      "continuable",
      { tag: "refused", code: "CHILDREN_DEVICE_REVOKED", detail: "revoked at noon" },
    );
    expect(outcome).toMatchObject({
      kind: "partial",
      applied: ["interrupted c1"],
      failed: {
        outcome: { kind: "refused", code: "CHILDREN_DEVICE_REVOKED", message: "revoked at noon" },
      },
    });
  });

  it("a re-read that worked leaves the outcome alone, and a failed Stop is never turned into a partial", () => {
    expect(stopWithReadBack(closed, "c1", "one-shot", { tag: "read", list: list([]) })).toBe(
      closed,
    );
    const refused: ActionOutcome<unknown> = { kind: "refused", code: "X", message: "no" };
    expect(stopWithReadBack(refused, "c1", "one-shot", { tag: "unknown", reason: "r" })).toBe(
      refused,
    );
  });

  it("the notice names the child, the jobs the close killed, and claims no more", () => {
    expect(childStopNotice("Budget check", closed).text).toBe(
      "Closed Budget check. Jobs killed: job-1, job-2.",
    );
    expect(
      childStopNotice("c1", { kind: "confirmed", value: { accepted: true }, refreshed: false })
        .text,
    ).toBe("Interrupt accepted for c1.");
    expect(childStopNotice("c1", { kind: "unknown", reason: "never arrived" }).text).toContain(
      "not known whether it applied",
    );
  });
});
