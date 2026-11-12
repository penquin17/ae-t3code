import { describe, expect, it } from "vite-plus/test";

import { known, unavailable, unknown } from "../core/known";
import { forkLinkSource } from "./links";
import { ONGOING_MS, classify, stateOf, tagOf } from "./model";
import { createSuggestionSource } from "./suggest";
import {
  MINUTE,
  NOW,
  ago,
  at,
  fact,
  facts,
  fork,
  grouped,
  linksOf,
  tree,
  withCwd,
  workspace,
} from "./testing";
import type { SessionFact, TreeGroup, TreeModel, TreeProject, TreeRow } from "./types";

function project(model: TreeModel, id: string): TreeProject {
  const found = model.projects.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no project ${id}`);
  return found;
}
const sectionIds = (p: TreeProject) => p.sections.map((section) => section.id);
const rowIds = (p: TreeProject, id: "needs-you" | "working" | "ongoing" | "dormant") =>
  p.sections.find((section) => section.id === id)?.rows.map((row) => row.id) ?? [];
const groupsIn = (p: TreeProject): readonly TreeGroup[] => p.groupsSection?.groups ?? [];
const groupShapes = (p: TreeProject) =>
  groupsIn(p).map((group) => `${group.key}[${group.members.map((member) => member.id).join(",")}]`);
const placed = (p: TreeProject) => [
  ...p.pinned.map((row) => row.id),
  ...p.sections.flatMap((section) => section.rows.map((row) => row.id)),
];
const occurrences = (p: TreeProject): TreeRow[] => [
  ...p.pinned,
  ...p.sections.flatMap((section) => section.rows),
  ...groupsIn(p).flatMap((group) => group.members),
];
function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) freeze(inner);
  }
  return value;
}

describe("the session state rule", () => {
  it("exports the 30-minute window", () => {
    expect(ONGOING_MS).toBe(30 * 60 * 1000);
  });

  it.each([
    ["a pending interaction", { pendingKind: "approval" }, "needs-you"],
    ["running", { running: known(true) }, "working"],
    [
      "an unread completion long ago",
      { completionUnread: known(true), recentMessageAt: ago(600) },
      "ongoing",
    ],
    ["a user message just now", { recentMessageAt: NOW }, "ongoing"],
    ["a user message exactly 30 minutes ago", { recentMessageAt: NOW - ONGOING_MS }, "ongoing"],
    [
      "a user message 30 minutes and 1 ms ago",
      { recentMessageAt: NOW - ONGOING_MS - 1 },
      "dormant",
    ],
    ["a user message an hour ago, read", { recentMessageAt: ago(60) }, "dormant"],
    ["no user message at all", { recentMessageAt: undefined }, "dormant"],
  ] as const)("%s is %s", (_name, over, expected) => {
    expect(stateOf(fact("a", over as Partial<SessionFact>), NOW)).toBe(expected);
  });

  it("precedence is pending > working > unread or recent > dormant", () => {
    const all = { running: known(true), completionUnread: known(true), recentMessageAt: NOW };
    expect(stateOf(fact("a", { ...all, pendingKind: "question" }), NOW)).toBe("needs-you");
    expect(stateOf(fact("a", all), NOW)).toBe("working");
    expect(stateOf(fact("a", { ...all, running: known(false) }), NOW)).toBe("ongoing");
  });

  it("an unknown pending kind is needs-you with no invented tag; known kinds are tagged", () => {
    const odd = fact("a", { pendingKind: "something-new" });
    expect(stateOf(odd, NOW)).toBe("needs-you");
    expect(tagOf(odd.pendingKind)).toBeUndefined();
    const row = project(tree(facts([odd])), "unfiled").sections[0]?.rows[0];
    expect(row?.state).toBe("needs-you");
    expect(row?.tag).toBeUndefined();
    expect(["approval", "plan-review", "question"].map(tagOf)).toEqual([
      "Approve",
      "Review",
      "Question",
    ]);
  });

  it("an unread or running fact that is unknown never reads as idle: the state is flagged not known", () => {
    const hidden = fact("a", { running: unknown("shell not read"), recentMessageAt: ago(600) });
    expect(classify(hidden, NOW)).toEqual({ state: "dormant", known: false });
    const noUnread = fact("a", {
      completionUnread: unavailable("server sends no visit mark"),
      recentMessageAt: ago(600),
    });
    expect(classify(noUnread, NOW).known).toBe(false);
    // Unknown does not override what is known: a pending request is needs-you whatever else is hidden.
    expect(classify(fact("a", { running: unknown("x"), pendingKind: "approval" }), NOW)).toEqual({
      state: "needs-you",
      known: true,
    });
    const row = project(tree(facts([hidden])), "unfiled").sections[0]?.rows[0];
    expect(row?.stateKnown).toBe(false);
  });

  it("an unknown running fact does not mark its project as working", () => {
    const model = tree(facts([fact("a", { running: unknown("x") })]));
    expect(project(model, "unfiled").working).toBe(false);
    expect(project(model, "unfiled").workingKnown).toBe(false);
  });
});

describe("exclusions", () => {
  it.each([
    ["a subagent", { subagent: true }],
    ["a known blank session", { blank: known(true) }],
    ["an archived session", { archived: true }],
  ])("%s appears nowhere: not in rows, counts, attention or the project choice", (_name, over) => {
    const model = tree(
      facts([
        fact("x", {
          ...over,
          pendingKind: "approval",
          running: known(true),
          current: true,
          recentMessageAt: ago(1),
          sortAt: ago(1),
        }),
        fact("y"),
      ]),
    );
    expect(placed(project(model, "unfiled"))).toEqual(["y"]);
    expect(model.attention).toEqual({
      needsYou: 0,
      rows: [],
      byProject: [{ projectId: "unfiled", needsYou: 0 }],
    });
  });

  it("an unavailable blank flag is not a reason to hide a session", () => {
    const model = tree(facts([fact("a", { blank: unavailable("no blank flag") })]));
    expect(placed(project(model, "unfiled"))).toEqual(["a"]);
  });
});

describe("projects", () => {
  it("lists workspaces in order, keeping empty ones, and assigns each session once to the first holder", () => {
    const model = tree(
      facts(
        [fact("a"), fact("b")],
        [
          workspace("w2", "Two", []),
          workspace("w1", "One", ["a"]),
          workspace("w3", "Three", ["a", "b"]),
        ],
      ),
    );
    expect(model.projects.map((p) => [p.id, p.kind, p.workspaceId])).toEqual([
      ["w2", "workspace", "w2"],
      ["w1", "workspace", "w1"],
      ["w3", "workspace", "w3"],
    ]);
    expect(placed(project(model, "w1"))).toEqual(["a"]);
    expect(placed(project(model, "w3"))).toEqual(["b"]);
    expect(project(model, "w2").sections).toEqual([]);
  });

  it("puts sessions in no workspace into one Unfiled project after the workspaces, with the folder of a known cwd", () => {
    const model = tree(
      facts(
        [
          fact("f1", withCwd("/home/me/gamma/")),
          fact("f2", withCwd("C:\\code\\delta")),
          fact("f3", { cwd: unavailable("no cwd") }),
          fact("f4", withCwd("/")),
          fact("in-w", withCwd("/home/me/ignored")),
        ],
        [workspace("w", "W", ["in-w"])],
      ),
    );
    expect(model.projects.map((p) => [p.id, p.kind, p.workspaceId])).toEqual([
      ["w", "workspace", "w"],
      ["unfiled", "unfiled", undefined],
    ]);
    const folders = Object.fromEntries(
      occurrences(project(model, "unfiled")).map((row) => [row.id, row.folder]),
    );
    expect(folders).toEqual({ f1: "gamma", f2: "delta", f3: undefined, f4: undefined });
    expect(occurrences(project(model, "w"))[0]).not.toHaveProperty("folder");
  });

  it("an absent cwd is carried as unavailable on the row, never as an empty folder", () => {
    const row = project(tree(facts([fact("a", { cwd: unavailable("no cwd") })])), "unfiled")
      .sections[0]?.rows[0];
    expect(row?.folder).toBeUndefined();
    expect(row?.folderState).toBe("unavailable");
  });

  it("has no projects when nothing is listed, and no Unfiled when every session is in a workspace", () => {
    expect(tree(facts([]))).toEqual({
      projects: [],
      attention: { needsYou: 0, rows: [], byProject: [] },
    });
    const model = tree(facts([fact("a")], [workspace("w", "W", ["a"])]));
    expect(model.projects.map((p) => p.id)).toEqual(["w"]);
  });

  it("marks the project of the open session current, else of the newest eligible one, never two", () => {
    const data = (retained: boolean) =>
      facts(
        [at("newest", ago(1)), at("open", ago(500), { current: retained }), at("mid", ago(5))],
        [
          workspace("wa", "A", ["newest"]),
          workspace("wb", "B", ["open"]),
          workspace("wc", "C", ["mid"]),
        ],
      );
    const current = (model: TreeModel) => model.projects.filter((p) => p.current).map((p) => p.id);
    expect(current(tree(data(true)))).toEqual(["wb"]);
    expect(current(tree(data(false)))).toEqual(["wa"]);
    const ties = tree(
      facts(
        [at("b", 5), at("a", 5)],
        [workspace("w1", "One", ["b"]), workspace("w2", "Two", ["a"])],
      ),
    );
    expect(current(ties)).toEqual(["w2"]);
  });
});

describe("sections, pins and order", () => {
  const states = facts(
    [
      at("d", ago(200)),
      at("o", ago(10)),
      fact("w", { running: known(true) }),
      fact("n", { pendingKind: "question" }),
    ],
    [workspace("w1", "One", ["d", "o", "w", "n"])],
  );

  it("shows only non-empty sections in the order needs-you, working, ongoing, dormant", () => {
    const p = project(tree(states), "w1");
    expect(sectionIds(p)).toEqual(["needs-you", "working", "ongoing", "dormant"]);
    expect(rowIds(p, "needs-you")).toEqual(["n"]);
    expect(p.sections[0]?.rows[0]).toMatchObject({ state: "needs-you", tag: "Question" });
    const some = facts([at("o", ago(10)), fact("d")], [workspace("w1", "One", ["o", "d"])]);
    expect(sectionIds(project(tree(some), "w1"))).toEqual(["ongoing", "dormant"]);
  });

  it("orders rows newest first, then id ascending", () => {
    const model = tree(
      facts(
        [at("b", ago(3)), at("a", ago(3)), at("new", ago(1)), at("old", ago(9))],
        [workspace("w1", "One", ["b", "a", "new", "old"])],
      ),
    );
    expect(rowIds(project(model, "w1"), "ongoing")).toEqual(["new", "a", "b", "old"]);
  });

  it("lifts pinned rows out of the sections, newest first, keeping their state and tag", () => {
    const model = tree(
      facts(
        [
          at("p-old", ago(500), { pinned: true }),
          at("p-wait", ago(100), { pinned: true, pendingKind: "approval" }),
          at("p-run", ago(1), { pinned: true, running: known(true) }),
          at("free", ago(2)),
        ],
        [workspace("w1", "One", ["p-old", "p-wait", "p-run", "free"])],
      ),
    );
    const p = project(model, "w1");
    expect(p.pinned.map((row) => [row.id, row.state, row.tag])).toEqual([
      ["p-run", "working", undefined],
      ["p-wait", "needs-you", "Approve"],
      ["p-old", "dormant", undefined],
    ]);
    expect(sectionIds(p)).toEqual(["ongoing"]);
  });

  it("a snoozed row keeps its policy state and carries a snoozed mark", () => {
    const row = project(
      tree(facts([fact("a", { snoozed: true, pendingKind: "approval" })])),
      "unfiled",
    ).sections[0]?.rows[0];
    expect(row).toMatchObject({ state: "needs-you", snoozed: true });
  });

  it("moves a session between sections as the clock passes 30 minutes", () => {
    const data = facts([at("a", NOW)], [workspace("w1", "One", ["a"])]);
    expect(sectionIds(project(tree(data, { now: NOW + ONGOING_MS }), "w1"))).toEqual(["ongoing"]);
    expect(sectionIds(project(tree(data, { now: NOW + ONGOING_MS + 1 }), "w1"))).toEqual([
      "dormant",
    ]);
  });
});

describe("attention", () => {
  it("counts each needs-you session once, pinned or not, and lists working rows too", () => {
    const model = tree(
      facts(
        [
          at("p", ago(5), { pinned: true, pendingKind: "approval" }),
          at("q", ago(6), { pendingKind: "question" }),
          at("r", ago(7), { running: known(true) }),
          at("s", ago(8)),
        ],
        [workspace("w1", "One", ["p", "q", "r", "s"])],
      ),
    );
    expect(model.attention.needsYou).toBe(2);
    expect(model.attention.rows.map((row) => row.id)).toEqual(["p", "q", "r"]);
    expect(new Set(model.attention.rows.map((row) => row.id)).size).toBe(
      model.attention.rows.length,
    );
  });

  it("is not changed by search, folds or a group that repeats a row", () => {
    const data = facts(
      [
        at("a", ago(5), { pendingKind: "approval", title: "Alpha" }),
        at("b", ago(6), { title: "Beta" }),
      ],
      [workspace("w1", "One", ["a", "b"])],
    );
    const links = linksOf(grouped("a", "b"));
    const plain = tree(data, { links });
    const searched = tree(data, { links, query: "beta" });
    expect(searched.attention).toEqual(plain.attention);
    expect(plain.attention.needsYou).toBe(1);
    expect(project(searched, "w1").needsYou).toBe(1);
  });
});

describe("groups", () => {
  const inW = (sessions: SessionFact[]) =>
    facts(sessions, [
      workspace(
        "w1",
        "One",
        sessions.map((s) => s.id),
      ),
    ]);

  it("joins linked sessions: the newest names it, the oldest keys it, members newest first", () => {
    const data = inW([
      at("root", ago(900), { title: "Root" }),
      at("mid", ago(800), { parentId: "root", title: "Mid" }),
      at("leaf", ago(700), { parentId: "mid", title: "Leaf" }),
      at("alone", ago(750), { title: "Alone" }),
    ]);
    const p = project(tree(data, { links: forkLinkSource(data) }), "w1");
    expect(groupShapes(p)).toEqual(["root[leaf,mid,root]"]);
    expect(groupsIn(p)[0]).toMatchObject({ key: "root", title: "Leaf", label: "Leaf", count: 3 });
    expect(groupsIn(p)[0]?.component).toEqual(["leaf", "mid", "root"]);
    expect(rowIds(p, "dormant")).toEqual(["leaf", "alone", "mid", "root"]);
  });

  it("a loose session is in no group and a self link joins nothing", () => {
    const data = inW([fact("a"), fact("b"), fact("c")]);
    expect(project(tree(data), "w1").groupsSection).toBeUndefined();
    expect(
      project(tree(data, { links: linksOf(fork("a", "a")) }), "w1").groupsSection,
    ).toBeUndefined();
  });

  it("a link to an excluded session or across projects joins nothing", () => {
    const data = facts(
      [fact("a"), fact("b"), fact("gone", { archived: true })],
      [workspace("w1", "One", ["a"]), workspace("w2", "Two", ["b"])],
    );
    const model = tree(data, { links: linksOf(grouped("a", "b"), grouped("a", "gone")) });
    expect(model.projects.every((p) => p.groupsSection === undefined)).toBe(true);
  });

  it("a grouped session stays in its state section and the row says which group it is in", () => {
    const data = inW([at("a", ago(1), { title: "A" }), at("b", ago(2), { title: "B" })]);
    const p = project(tree(data, { links: linksOf(grouped("a", "b")) }), "w1");
    expect(rowIds(p, "ongoing")).toEqual(["a", "b"]);
    expect(p.sections[0]?.rows[0]?.group).toEqual({ key: "b", label: "A" });
    expect(p.sections[0]?.rows[0]?.grouped).toBe(true);
  });

  it("a saved name labels the group it overlaps most", () => {
    const data = inW([at("a", ago(1), { title: "A" }), at("b", ago(2), { title: "B" })]);
    const p = project(
      tree(data, {
        links: linksOf(grouped("a", "b")),
        names: [{ members: ["a", "b"], name: "Plan", at: 5 }],
      }),
      "w1",
    );
    expect(groupsIn(p)[0]).toMatchObject({ name: "Plan", label: "Plan" });
  });

  it("search narrows the members shown but never changes the group's key, label or full component", () => {
    const data = inW([
      at("a", ago(1), { title: "Alpha topic" }),
      at("b", ago(2), { title: "Beta topic" }),
      at("c", ago(3), { title: "Gamma" }),
    ]);
    const links = linksOf(grouped("a", "b"), grouped("b", "c"));
    const full = groupsIn(project(tree(data, { links }), "w1"))[0] as TreeGroup;
    const searched = groupsIn(
      project(tree(data, { links, query: "  GAMMA " }), "w1"),
    )[0] as TreeGroup;
    expect(searched.members.map((m) => m.id)).toEqual(["c"]);
    expect({ key: searched.key, label: searched.label, component: searched.component }).toEqual({
      key: full.key,
      label: full.label,
      component: full.component,
    });
    expect(searched.forcedOpen).toBe(true);
    expect(searched.members[0]?.group).toEqual(full.members[0]?.group);
  });

  it("orders groups by each full group's newest member, not by what a search leaves showing", () => {
    const data = inW([
      at("a1", ago(10), { title: "A one" }),
      at("a2", ago(11), { title: "A two" }),
      at("b1", ago(5), { title: "B one" }),
      at("b2", ago(6), { title: "B two zeta" }),
    ]);
    const links = linksOf(grouped("a1", "a2"), grouped("b1", "b2"));
    expect(groupShapes(project(tree(data, { links }), "w1")).map((s) => s[0])).toEqual(["b", "a"]);
    expect(
      groupShapes(project(tree(data, { links, query: "two" }), "w1")).map((s) => s[0]),
    ).toEqual(["b", "a"]);
  });

  it("suggestions come only from unpinned dormant rows, never join, and show only when both titles match", () => {
    const data = inW([
      at("a", ago(100), { title: "Quarterly revenue forecast model" }),
      at("b", ago(101), { title: "Quarterly revenue forecast review" }),
      at("c", ago(102), { title: "Holiday photos" }),
      at("p", ago(103), { pinned: true, title: "Quarterly revenue forecast pinned" }),
    ]);
    const suggestions = createSuggestionSource([]);
    const p = project(tree(data, { suggestions }), "w1");
    expect(p.groupsSection?.suggestions.map((s) => [s.a.id, s.b.id])).toEqual([["a", "b"]]);
    expect(p.groupsSection?.groups).toEqual([]);
    expect(
      project(tree(data, { suggestions, query: "model" }), "w1").groupsSection,
    ).toBeUndefined();
  });
});

describe("search", () => {
  it("matches a title substring, trimmed and case-insensitive, drops empty sections and projects, forces the rest open", () => {
    const data = facts(
      [
        at("a", ago(1), { title: "Budget plan" }),
        at("b", ago(2), { title: "Trip notes" }),
        at("p", ago(3), { pinned: true, title: "Budget pinned" }),
      ],
      [workspace("w1", "One", ["a", "p"]), workspace("w2", "Two", ["b"])],
    );
    const model = tree(data, { query: "  BUDGET " });
    expect(model.projects.map((p) => p.id)).toEqual(["w1"]);
    const p = project(model, "w1");
    expect(rowIds(p, "ongoing")).toEqual(["a"]);
    expect(p.pinned.map((row) => row.id)).toEqual(["p"]);
    expect([p.forcedOpen, p.pinnedForcedOpen, p.sections[0]?.forcedOpen]).toEqual([
      true,
      true,
      true,
    ]);
    expect(tree(data).projects.every((q) => !q.forcedOpen)).toBe(true);
  });
});

describe("purity", () => {
  it("does not change a deeply frozen input and returns the same model for the same input", () => {
    const data = freeze(
      facts(
        [at("a", ago(1), { title: "A" }), at("b", ago(2), { title: "B", parentId: "a" })],
        [workspace("w1", "One", ["a", "b"])],
      ),
    );
    const links = freeze(linksOf(grouped("a", "b")));
    expect(tree(data, { links })).toEqual(tree(data, { links }));
    expect(MINUTE).toBe(60_000);
  });
});
