// The tree's group inputs derived from the Backend's confirmed record: confirmed links beside fork links, saved names,
// and suggestions that never offer a dismissed pair again. Boundary: pure functions plus the pure tree model; no store, no DOM.
import { describe, expect, it } from "vite-plus/test";

import { known, unavailable, unknown } from "../core/known";
import type { GroupRecord } from "../groups/record";
import { groupSources } from "./groupSources";
import { forkLinkSource } from "./links";
import { toTreeModel } from "./model";
import { at, fact, facts, NOW } from "./testing";
import type { ListFacts, TreeGroup, TreeModel } from "./types";

const record = (over: Partial<GroupRecord> = {}): GroupRecord => ({
  version: 2,
  links: [],
  dismissed: [],
  names: [],
  ...over,
});
const link = (a: string, b: string) => ({ a, b, kind: "grouped" as const, at: 1 });

const build = (
  data: ListFacts,
  backend:
    | ReturnType<typeof known<GroupRecord>>
    | ReturnType<typeof unknown<GroupRecord>>
    | ReturnType<typeof unavailable<GroupRecord>>,
  query = "",
): TreeModel => {
  const sources = groupSources(forkLinkSource(data), backend);
  return toTreeModel(data, sources.links, sources.suggestions, {
    now: NOW,
    query,
    names: sources.names,
  });
};
const groupsOf = (model: TreeModel): readonly TreeGroup[] =>
  model.projects[0]?.groupsSection?.groups ?? [];

const three = facts([at("a", 3000), at("b", 2000), at("c", 1000)]);

describe("confirmed links", () => {
  it("join sessions into a group beside fork links, for visible ids only", () => {
    const data = facts([at("a", 3000), at("b", 2000, { parentId: "a" }), at("c", 1000)]);
    const model = build(data, known(record({ links: [link("b", "c")] })));
    expect(groupsOf(model).map((g) => g.component)).toEqual([["a", "b", "c"]]);
    const source = groupSources(
      forkLinkSource(data),
      known(record({ links: [link("b", "c")] })),
    ).links;
    expect(source.linksFor(["b", "c"]).map((l) => l.kind)).toEqual(["grouped"]);
    expect(source.linksFor(["a", "b"]).map((l) => l.kind)).toEqual(["fork"]);
  });

  it("a link whose other end is not a visible session makes no group and no grouped mark", () => {
    const model = build(three, known(record({ links: [link("a", "z")] })));
    expect(groupsOf(model)).toEqual([]);
    const rows = model.projects[0]!.sections.flatMap((s) => s.rows);
    expect(rows.every((row) => !row.grouped)).toBe(true);
  });

  it("split and merge follow the record, not memory", () => {
    const joined = build(three, known(record({ links: [link("a", "b"), link("b", "c")] })));
    expect(groupsOf(joined).map((g) => g.component)).toEqual([["a", "b", "c"]]);
    const split = build(three, known(record({ links: [link("a", "b")] })));
    expect(groupsOf(split).map((g) => g.component)).toEqual([["a", "b"]]);
    const merged = build(three, known(record({ links: [link("a", "b"), link("a", "c")] })));
    expect(groupsOf(merged)).toHaveLength(1);
  });
});

describe("saved names", () => {
  it("label the group they were given to, by whole full-component identity", () => {
    const names = [{ members: ["a", "b", "c"], name: "Reading list", at: 5 }];
    const model = build(
      three,
      known(record({ links: [link("a", "b"), link("b", "c")], names })),
      "session c",
    );
    const group = groupsOf(model)[0]!;
    expect(group.name).toBe("Reading list");
    // A search that shows one member keeps the full component as the rename target.
    expect(group.members.map((m) => m.id)).toEqual(["c"]);
    expect(group.component).toEqual(["a", "b", "c"]);
  });

  it("follow the half that keeps most of the members when a group splits", () => {
    const names = [{ members: ["a", "b", "c"], name: "Whole", at: 5 }];
    const split = build(three, known(record({ links: [link("a", "b")], names })));
    expect(groupsOf(split).map((g) => [g.component, g.name])).toEqual([[["a", "b"], "Whole"]]);
  });

  it("break a tie by the later save, whichever order the Backend lists them", () => {
    const names = [
      { members: ["a", "b", "c"], name: "Whole", at: 5 },
      { members: ["a", "b"], name: "Pair", at: 9 },
    ];
    const split = build(three, known(record({ links: [link("a", "b")], names })));
    expect(groupsOf(split)[0]!.name).toBe("Pair");
    const reversed = build(
      three,
      known(record({ links: [link("a", "b")], names: [names[1]!, names[0]!] })),
    );
    expect(groupsOf(reversed)[0]!.name).toBe("Pair");
  });
});

describe("suggestions", () => {
  const titled = facts([
    at("a", 3000, { title: "Quarterly revenue forecast model" }),
    at("b", 2000, { title: "Quarterly revenue forecast review" }),
    at("c", 1000, { title: "Garden notes" }),
  ]);
  const suggested = (model: TreeModel) =>
    (model.projects[0]?.groupsSection?.suggestions ?? []).map((s) => [s.a.id, s.b.id]);

  it("come from titles alone once the record is known", () => {
    expect(suggested(build(titled, known(record())))).toEqual([["a", "b"]]);
  });

  it("never offer a dismissed pair again, whichever order the pair was stored in", () => {
    const dismissed = [{ a: "a", b: "b", at: 1 }];
    expect(suggested(build(titled, known(record({ dismissed }))))).toEqual([]);
    // An undismissed pair elsewhere in the same project is still offered.
    const more = facts([
      ...titled.sessions,
      at("d", 500, { title: "Quarterly revenue forecast archive" }),
    ]);
    expect(suggested(build(more, known(record({ dismissed })))).flat()).not.toEqual(
      expect.arrayContaining(["a", "b"]),
    );
  });

  it("are not offered while the record is not known, so a dismissed pair cannot reappear", () => {
    expect(suggested(build(titled, unknown("not read yet")))).toEqual([]);
    expect(suggested(build(titled, unavailable("not connected")))).toEqual([]);
  });
});

describe("an unavailable or unknown record leaves the fork groups exactly as before", () => {
  it("fork lineage still groups and no saved name is applied", () => {
    const data = facts([
      at("a", 3000),
      fact("b", { parentId: "a", sortAt: 2000, recentMessageAt: 2000 }),
    ]);
    for (const backend of [
      unavailable<GroupRecord>("not connected"),
      unknown<GroupRecord>("not read"),
    ]) {
      const model = build(data, backend);
      expect(groupsOf(model).map((g) => g.component)).toEqual([["a", "b"]]);
      expect(groupsOf(model)[0]!.name).toBeUndefined();
    }
  });
});
