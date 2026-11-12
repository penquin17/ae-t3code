import { describe, expect, it } from "vite-plus/test";

import { createSuggestionSource, pairKey, suggestPairs } from "./suggest";

const row = (id: string, title: string, updatedAt = 1, groupKey = id) => ({
  id,
  title,
  updatedAt,
  groupKey,
});
const none = new Set<string>();

describe("suggestPairs", () => {
  it("pairs titles that share at least two topic words and half the shorter title", () => {
    const rows = [
      row("a", "Quarterly revenue forecast model"),
      row("b", "Quarterly revenue forecast review"),
      row("c", "Holiday photos"),
    ];
    expect(suggestPairs(rows, none, none)).toEqual([{ a: "a", b: "b", shared: 3 }]);
  });

  it("one shared word, stop words and short words are not topics", () => {
    const rows = [row("a", "Fix the session error"), row("b", "Fix the session test")];
    expect(suggestPairs(rows, none, none)).toEqual([]);
    expect(suggestPairs([row("a", "Budget plan"), row("b", "Budget trip")], none, none)).toEqual(
      [],
    );
  });

  it("skips rows already in one group, a dismissed pair (either order) and the pair with itself", () => {
    const rows = [
      row("a", "Quarterly revenue forecast", 1, "g"),
      row("b", "Quarterly revenue forecast two", 1, "g"),
      row("c", "Quarterly revenue forecast three"),
    ];
    expect(suggestPairs(rows, none, new Set([pairKey("c", "a")])).map((p) => [p.a, p.b])).toEqual([
      ["b", "c"],
    ]);
  });

  it("uses a row at most once and returns at most three pairs, deterministically", () => {
    const rows = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id, i) =>
      row(id, `Alpha beta gamma delta ${id}x`, i),
    );
    const first = suggestPairs(rows, none, none);
    expect(first.length).toBeLessThanOrEqual(3);
    const ids = first.flatMap((p) => [p.a, p.b]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(suggestPairs([...rows].reverse(), none, none)).toEqual(first);
  });

  it("createSuggestionSource binds the dismissed pairs", () => {
    const rows = [
      row("a", "Quarterly revenue forecast"),
      row("b", "Quarterly revenue forecast two"),
    ];
    expect(createSuggestionSource([]).suggestFor(rows)).toHaveLength(1);
    expect(createSuggestionSource([{ a: "b", b: "a" }]).suggestFor(rows)).toEqual([]);
  });
});
