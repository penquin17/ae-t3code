import { describe, expect, it } from "vite-plus/test";

import { ageText, rowStatusText } from "./rowText";
import type { TreeRow } from "./types";

const row = (over: Partial<TreeRow> = {}): TreeRow => ({
  id: "a",
  title: "A",
  state: "dormant",
  stateKnown: true,
  tag: undefined,
  snoozed: false,
  updatedAt: 0,
  pinned: false,
  current: false,
  grouped: false,
  ...over,
});

describe("rowStatusText", () => {
  it("shows the status tag when there is one, otherwise the state", () => {
    expect(rowStatusText(row({ state: "needs-you", tag: "Approve" }))).toBe("Approve");
    expect(rowStatusText(row({ state: "needs-you" }))).toBe("Needs you");
    expect(rowStatusText(row({ state: "working" }))).toBe("Working");
    expect(rowStatusText(row({ state: "ongoing" }))).toBe("Ongoing");
    expect(rowStatusText(row({ state: "dormant" }))).toBe("Idle");
  });

  it("never calls a row idle or ongoing when the state rests on an unknown fact", () => {
    expect(rowStatusText(row({ state: "dormant", stateKnown: false }))).toBe("State unknown");
    expect(rowStatusText(row({ state: "ongoing", stateKnown: false }))).toBe("State unknown");
    // A pending request or a known running thread stays what it is.
    expect(rowStatusText(row({ state: "needs-you", stateKnown: true }))).toBe("Needs you");
  });

  it("adds a snoozed mark and keeps the state", () => {
    expect(rowStatusText(row({ state: "needs-you", tag: "Question", snoozed: true }))).toBe(
      "Question · snoozed",
    );
  });
});

describe("ageText", () => {
  const NOW = 1_700_000_000_000;
  const minutes = (n: number) => NOW - n * 60_000;
  it.each([
    [0, "now"],
    [1, "1m"],
    [59, "59m"],
    [60, "1h"],
    [60 * 23, "23h"],
    [60 * 24, "1d"],
    [60 * 24 * 40, "40d"],
  ])("%s minutes ago reads %s", (n, text) => {
    expect(ageText(minutes(n), NOW)).toBe(text);
  });

  it("a time in the future reads now, not a negative age", () => {
    expect(ageText(NOW + 60_000, NOW)).toBe("now");
  });
});
