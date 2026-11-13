// What a thread's earlier sessions left open is read with its live root's snapshot (M10 review 1, follow-up 4b). Boundary: the pure merge over a supplied per-root read; it shows what the view is
// given — the live root's records first, each earlier root's after, nothing partial when one read fails — not the transport or the Backend that names the roots.
import { describe, expect, it, vi } from "vite-plus/test";

import { isFromEarlierSession, readWithEarlier } from "./earlier";
import type { SnapshotRead } from "./resync";
import type { InteractionRecord, InteractionsSnapshot } from "./types";

const record = (interactionId: string, rootSessionId: string): InteractionRecord => ({
  interactionId,
  state: "pending",
  revision: "r".repeat(64),
  rootSessionId,
  sessionId: rootSessionId,
  createdAt: "2026-11-11T00:00:00.000Z",
  held: false,
  kind: "question",
  content: { questions: [{ id: "q1", question: "Which?" }] },
});
const snapshot = (root: string, ids: string[], retiredRoots?: string[]): InteractionsSnapshot => ({
  rootSessionId: root,
  version: 3,
  interactions: ids.map((id) => record(id, root)),
  ...(retiredRoots === undefined ? {} : { retiredRoots }),
});
const ok = (value: InteractionsSnapshot): SnapshotRead => ({ tag: "ok", snapshot: value });

describe("readWithEarlier", () => {
  it("a snapshot that names no earlier root is returned as it is, and nothing else is read", async () => {
    const readEarlier = vi.fn();
    const first = snapshot("live", ["i1"]);
    expect(await readWithEarlier(first, readEarlier)).toEqual(ok(first));
    expect(readEarlier).not.toHaveBeenCalled();
  });

  it("adds each earlier root's records after the live root's, keeping the live root's version", async () => {
    const readEarlier = vi.fn(async (root: string) =>
      ok(snapshot(root, root === "old-1" ? ["a1"] : ["b1", "b2"])),
    );
    const read = await readWithEarlier(snapshot("live", ["i1"], ["old-1", "old-2"]), readEarlier);
    expect(readEarlier.mock.calls.map(([root]) => root)).toEqual(["old-1", "old-2"]);
    expect(read.tag === "ok" && read.snapshot.interactions.map((r) => r.interactionId)).toEqual([
      "i1",
      "a1",
      "b1",
      "b2",
    ]);
    expect(read.tag === "ok" && read.snapshot.version).toBe(3);
  });

  it("an earlier root that cannot be read makes the whole read a failure that says so, never a partial list", async () => {
    const readEarlier = async (root: string): Promise<SnapshotRead> =>
      root === "old-2"
        ? { tag: "failed", reason: "the reply to the read never arrived" }
        : ok(snapshot(root, ["a1"]));
    const read = await readWithEarlier(snapshot("live", ["i1"], ["old-1", "old-2"]), readEarlier);
    expect(read).toEqual({
      tag: "failed",
      reason:
        "an earlier session of this thread could not be read (the reply to the read never arrived)",
    });
  });

  it("a record is listed once even if two reads name it", async () => {
    const read = await readWithEarlier(snapshot("live", ["i1"], ["old"]), async (root) =>
      ok(snapshot(root, ["i1", "a1"])),
    );
    expect(read.tag === "ok" && read.snapshot.interactions.map((r) => r.interactionId)).toEqual([
      "i1",
      "a1",
    ]);
  });
});

describe("isFromEarlierSession", () => {
  it("is true only for a record whose root is not the page's live root", () => {
    expect(isFromEarlierSession(record("a", "old"), "live")).toBe(true);
    expect(isFromEarlierSession(record("a", "live"), "live")).toBe(false);
  });
});
