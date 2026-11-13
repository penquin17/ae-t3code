// Session actions are confirmed only by what T3's projection shows (D4). Boundary: the matchers and the
// read-back function over a supplied wait; the live shell store and its bounded wait are not exercised here.
import { describe, expect, it } from "vite-plus/test";

import {
  confirmShell,
  shellArchived,
  shellPinned,
  shellTitled,
  type ShellMatch,
  type ShellProjection,
  type WaitForShell,
} from "./projectionConfirm";

const shell = (over: Partial<ShellProjection> = {}): ShellProjection => ({
  title: "Notes",
  pinnedAt: null,
  ...over,
});

/** A wait over a fixed projection: it answers whether the projection matches, as T3's wait does at its first read. */
const waitOver =
  (current: ShellProjection | null): WaitForShell =>
  async (matches) =>
    matches(current);

describe("the matchers", () => {
  it("titled: the projection's title equals the requested title, ignoring edge spaces", () => {
    expect(shellTitled("New name")(shell({ title: "New name" }))).toBe(true);
    expect(shellTitled("  New name ")(shell({ title: "New name" }))).toBe(true);
    expect(shellTitled("New name")(shell({ title: "Notes" }))).toBe(false);
  });

  it("titled: a thread missing from the projection never matches", () => {
    expect(shellTitled("Notes")(null)).toBe(false);
  });

  it("pinned: matches the pin state the projection carries, and never a missing thread", () => {
    expect(shellPinned(true)(shell({ pinnedAt: "2026-01-01T00:00:00Z" }))).toBe(true);
    expect(shellPinned(true)(shell())).toBe(false);
    expect(shellPinned(false)(shell())).toBe(true);
    expect(shellPinned(false)(shell({ pinnedAt: "2026-01-01T00:00:00Z" }))).toBe(false);
    expect(shellPinned(true)(null)).toBe(false);
    expect(shellPinned(false)(null)).toBe(false);
  });

  it("archived: T3 drops an archived thread from the active projection, so only its absence shows it", () => {
    expect(shellArchived(null)).toBe(true);
    expect(shellArchived(shell())).toBe(false);
  });
});

describe("confirmShell", () => {
  it("shows when the projection matches", async () => {
    expect(await confirmShell(waitOver(shell({ title: "A" })), shellTitled("A"))).toEqual({
      tag: "shows",
    });
  });

  it("is absent, not shows, when the bounded wait ends without a match", async () => {
    const result = await confirmShell(waitOver(shell({ title: "Old" })), shellTitled("A"));
    expect(result).toEqual({ tag: "absent" });
  });

  it("is failed with the reason when the read-back itself throws", async () => {
    const wait: WaitForShell = async () => {
      throw new Error("registry unavailable");
    };
    expect(await confirmShell(wait, shellTitled("A"))).toEqual({
      tag: "failed",
      reason: "registry unavailable",
    });
  });

  it("hands the matcher it was given to the wait, once", async () => {
    const seen: ShellMatch[] = [];
    const wait: WaitForShell = async (matches) => {
      seen.push(matches);
      return true;
    };
    const matcher = shellTitled("A");
    await confirmShell(wait, matcher);
    expect(seen).toEqual([matcher]);
  });
});
