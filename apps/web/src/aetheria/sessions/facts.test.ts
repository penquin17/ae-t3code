import { describe, expect, it } from "vite-plus/test";

import { known, unavailable, unknown } from "../core/known";
import { pendingKindOf, toSessionFact, type ShellFactsInput } from "./facts";

const NOW = Date.parse("2026-11-12T10:00:00Z");
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function shell(over: Partial<ShellFactsInput> = {}): ShellFactsInput {
  return {
    id: "t1",
    title: "A thread",
    parentThreadId: null,
    relationshipToParent: null,
    worktreePath: "/work/tree",
    archivedAt: null,
    pinnedAt: null,
    snoozedUntil: null,
    runStatus: "idle",
    pendingRequestKind: null,
    hasActionableProposedPlan: false,
    latestRunCompletedAt: null,
    lastVisitedAt: null,
    latestUserMessageAt: iso(5),
    createdAt: iso(60),
    visibleItemCount: 4,
    ...over,
  };
}
const map = (over: Partial<ShellFactsInput> = {}, current = false) =>
  toSessionFact(shell(over), { now: NOW, current });

describe("archive and pin", () => {
  it("archived comes from archivedAt and nothing else", () => {
    expect(map().archived).toBe(false);
    expect(map({ archivedAt: iso(1) }).archived).toBe(true);
  });

  it("pinned comes from pinnedAt", () => {
    expect(map().pinned).toBe(false);
    expect(map({ pinnedAt: iso(1) }).pinned).toBe(true);
  });
});

describe("unread completion (R7): lastVisitedAt against latestRunCompletedAt, no markViewed", () => {
  it.each([
    ["no run has completed", { latestRunCompletedAt: null, lastVisitedAt: iso(10) }, known(false)],
    [
      "completed after the last visit",
      { latestRunCompletedAt: iso(2), lastVisitedAt: iso(10) },
      known(true),
    ],
    [
      "completed before the last visit",
      { latestRunCompletedAt: iso(10), lastVisitedAt: iso(2) },
      known(false),
    ],
    [
      "completed, never visited: T3 does not count an unopened thread's completion",
      { latestRunCompletedAt: iso(2), lastVisitedAt: null },
      known(false),
    ],
    [
      "the server sends no latestRunCompletedAt",
      { latestRunCompletedAt: undefined, lastVisitedAt: iso(2) },
      "not-known",
    ],
    [
      "the server sends no lastVisitedAt",
      { latestRunCompletedAt: iso(2), lastVisitedAt: undefined },
      "not-known",
    ],
    [
      "an unreadable completion time",
      { latestRunCompletedAt: "not a date", lastVisitedAt: iso(2) },
      "not-known",
    ],
  ] as const)("%s", (_name, over, expected) => {
    const unread = map(over).completionUnread;
    if (expected === "not-known") expect(unread.state).not.toBe("known");
    else expect(unread).toEqual(expected);
  });
});

describe("running", () => {
  it.each([
    ["idle", false],
    ["completed", false],
    ["failed", false],
    ["interrupted", false],
    ["cancelled", false],
    ["preparing", true],
    ["queued", true],
    ["starting", true],
    ["running", true],
    ["waiting", true],
  ] as const)("a thread whose status is %s: running=%s", (runStatus, running) => {
    expect(map({ runStatus }).running).toEqual(known(running));
  });

  it("an absent status is unknown, never idle", () => {
    expect(map({ runStatus: undefined }).running.state).toBe("unknown");
  });

  it("a status this build does not know is unknown, never idle", () => {
    expect(map({ runStatus: "teleporting" }).running.state).toBe("unknown");
  });
});

describe("pending kind", () => {
  it.each([
    ["command", "approval"],
    ["file-read", "approval"],
    ["file-change", "approval"],
    ["permission", "approval"],
    ["mcp-elicitation", "question"],
    ["user_input", "question"],
  ])("a pending %s request is %s", (kind, expected) => {
    expect(pendingKindOf(kind, false)).toBe(expected);
  });

  it("an actionable proposed plan is plan-review when no request waits", () => {
    expect(pendingKindOf(null, true)).toBe("plan-review");
    expect(pendingKindOf("command", true)).toBe("approval");
    expect(pendingKindOf(null, false)).toBeUndefined();
  });

  it("a request kind this build does not know is carried as is, so it needs you but gets no tag", () => {
    expect(pendingKindOf("auth_refresh", false)).toBe("auth_refresh");
  });
});

describe("the remaining facts", () => {
  it("title, id and the open-session flag", () => {
    expect(map({}, true)).toMatchObject({ id: "t1", title: "A thread", current: true });
  });

  it("a fork or subagent parent is the parent id; subagent is its own flag", () => {
    expect(map({ parentThreadId: "p", relationshipToParent: "fork" })).toMatchObject({
      parentId: "p",
      subagent: false,
    });
    expect(map({ parentThreadId: "p", relationshipToParent: "subagent" })).toMatchObject({
      parentId: "p",
      subagent: true,
    });
    expect(map().parentId).toBeUndefined();
  });

  it("cwd is the worktree path when there is one, otherwise unavailable", () => {
    expect(map().cwd).toEqual(known("/work/tree"));
    expect(map({ worktreePath: null }).cwd.state).toBe("unavailable");
  });

  it("blank is known only from an item count; absent is unavailable", () => {
    expect(map({ visibleItemCount: 0 }).blank).toEqual(known(true));
    expect(map({ visibleItemCount: 3 }).blank).toEqual(known(false));
    expect(map({ visibleItemCount: undefined }).blank.state).toBe("unavailable");
  });

  it("recent message time is the last user message; a thread without one sorts by creation", () => {
    expect(map().recentMessageAt).toBe(NOW - 5 * 60_000);
    const none = map({ latestUserMessageAt: null });
    expect(none.recentMessageAt).toBeUndefined();
    expect(none.sortAt).toBe(NOW - 60 * 60_000);
  });

  it("snoozed while snoozedUntil is in the future", () => {
    expect(map({ snoozedUntil: new Date(NOW + 60_000).toISOString() }).snoozed).toBe(true);
    expect(map({ snoozedUntil: new Date(NOW - 60_000).toISOString() }).snoozed).toBe(false);
    expect(map().snoozed).toBe(false);
  });
});

describe("kept distinct", () => {
  it("unknown and unavailable are different states with their own reasons", () => {
    expect(unknown("a")).not.toEqual(unavailable("a"));
  });
});
