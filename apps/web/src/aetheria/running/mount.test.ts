// @effect-diagnostics nodeBuiltinImport:off - reads the mounting site's own source.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

// Boundary: the source text of the one T3 file that mounts the indicator (IP-39). It shows where the
// marker sits and which T3 branches stay; it does not show how the rows render (running.browser.test.tsx).
const source = NodeFS.readFileSync(
  NodeURL.fileURLToPath(
    new URL("../../components/chat/TimelineWorkGroupRows.tsx", import.meta.url),
  ),
  "utf8",
);
// Built from parts: the registry check reads every committed file for the token.
const marker = ["AETHERIA-IP", "IP-39"].join(":");
const between = (from: string, to: string) =>
  source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

describe("the mounting site", () => {
  it("carries the IP-39 marker in its three hunks, and only there", () => {
    expect(source.split(marker).length - 1).toBe(3);
  });

  it("the working row keeps T3's worktree-setup and compaction labels and mounts Aetheria's indicator otherwise", () => {
    const working = between(
      "export function WorkingTimelineRow",
      "function BackgroundWorktreeSetupChip",
    );
    expect(working).toContain("Setting up worktree…");
    expect(working).toContain("<CompactingLabel");
    expect(working).toContain(
      "<AetheriaRunning createdAt={row.createdAt} threadRef={threadRef} />",
    );
    expect(working).not.toContain("Working for");
  });

  it("the thinking row keeps only the failed-group toggle", () => {
    const thinking = between("export function ThinkingTimelineRow", "function LiveActivityRow");
    expect(thinking).toContain("if (groupId === undefined) return null;");
    expect(thinking).toContain("aria-expanded={row.expanded === true}");
    expect(thinking).toContain("onToggleWorkGroup(groupId, row.id)");
  });
});
