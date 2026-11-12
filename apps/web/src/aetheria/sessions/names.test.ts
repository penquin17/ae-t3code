import { describe, expect, it } from "vite-plus/test";

import { nameGroups } from "./names";

const group = (key: string, members: string[], title = `title ${key}`) => ({ key, members, title });
const saved = (members: string[], name: string, at = 1) => ({ members, name, at });

describe("nameGroups", () => {
  it("an unnamed group is called by its newest member's title", () => {
    const labels = nameGroups([group("g", ["a", "b"], "Newest")], []);
    expect(labels.get("g")).toEqual({ name: undefined, label: "Newest" });
  });

  it("a saved name follows the group that still holds most of its members", () => {
    const labels = nameGroups(
      [group("g1", ["a", "b", "c"]), group("g2", ["d", "e"])],
      [saved(["a", "b", "x"], "Plan")],
    );
    expect(labels.get("g1")?.name).toBe("Plan");
    expect(labels.get("g2")?.name).toBeUndefined();
  });

  it("one saved name names at most one group: the larger overlap wins", () => {
    const labels = nameGroups(
      [group("g1", ["a", "b"]), group("g2", ["c"]), group("g3", ["a", "c"])],
      [saved(["a", "b", "c"], "Shared")],
    );
    expect(labels.get("g1")?.name).toBe("Shared");
    expect(labels.get("g3")?.name).toBeUndefined();
  });

  it("ties break by later time, then member list, then group key, so arrival order never matters", () => {
    const groups = [group("g1", ["a", "b"]), group("g2", ["a", "b"])];
    const names = [saved(["a", "b"], "Old", 1), saved(["a", "b"], "New", 9)];
    const forward = nameGroups(groups, names);
    const reversed = nameGroups([...groups].reverse(), [...names].reverse());
    expect(forward.get("g1")?.name).toBe("New");
    expect(forward.get("g2")?.name).toBe("Old");
    expect(reversed.get("g1")?.name).toBe("New");
    expect(reversed.get("g2")?.name).toBe("Old");
  });

  it("a name that matches no group is left alone and no entry is invented", () => {
    const labels = nameGroups([group("g", ["a", "b"], "T")], [saved(["x", "y"], "Stale")]);
    expect(labels.size).toBe(1);
    expect(labels.get("g")?.label).toBe("T");
  });

  it("member ids containing delimiters cannot collide", () => {
    const labels = nameGroups(
      [group("g1", ["a,b", "c"]), group("g2", ["a", "b,c"])],
      [saved(["a,b", "c"], "One", 5), saved(["a", "b,c"], "Two", 5)],
    );
    expect(labels.get("g1")?.name).toBe("One");
    expect(labels.get("g2")?.name).toBe("Two");
  });
});
