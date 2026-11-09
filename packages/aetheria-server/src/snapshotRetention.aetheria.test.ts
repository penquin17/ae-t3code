// AETHERIA M09 step 21 — the retention rule over a stand-in index and a recording forget; the real index and store are in snapshots.aetheria.test.ts.
// It shows when a deletion forgets a session (sole or last holder) and that nothing throws.
import { describe, expect, it } from "vite-plus/test";

import { createSnapshotRetention } from "./snapshotRetention.ts";

const world = (holders: Record<string, readonly string[]>, bound: Record<string, string>) => {
  const forgotten: string[] = [];
  const retention = createSnapshotRetention({
    index: {
      lookup: (threadId) =>
        threadId in bound
          ? ({ status: "ok", binding: { sessionId: bound[threadId] } } as never)
          : threadId === "corrupt"
            ? { status: "corrupt", problem: "x" }
            : { status: "absent" },
      threadsOf: (sessionId) => holders[sessionId] ?? [],
    },
    forgetSession: async (sessionId) => {
      forgotten.push(sessionId);
      return { ok: true, removed: 1 };
    },
  });
  return { retention, forgotten };
};

describe("snapshot retention", () => {
  it("forgets the session when its only holder is deleted, remembering nothing", async () => {
    const { retention, forgotten } = world({ S1: ["T1"] }, { T1: "S1" });
    await retention.threadDeleted("T1");
    expect(forgotten).toEqual(["S1"]);
  });

  it("does nothing while another thread still holds the session, and forgets when the last holder is deleted", async () => {
    const { retention, forgotten } = world({ S1: ["T1", "T2"] }, { T1: "S1", T2: "S1" });
    await retention.threadDeleted("T1");
    expect(forgotten).toEqual([]);
    await retention.threadDeleted("T1");
    expect(forgotten).toEqual([]);
    await retention.threadDeleted("T2");
    expect(forgotten).toEqual(["S1"]);
  });

  it("keeps deletions per session: a deletion in one session never counts toward another", async () => {
    const { retention, forgotten } = world(
      { S1: ["T1", "T2"], S2: ["T3", "T4"] },
      { T1: "S1", T2: "S1", T3: "S2", T4: "S2" },
    );
    await retention.threadDeleted("T1");
    await retention.threadDeleted("T3");
    expect(forgotten).toEqual([]);
    await retention.threadDeleted("T4");
    expect(forgotten).toEqual(["S2"]);
  });

  it("forgets nothing for a thread the index does not bind or cannot read", async () => {
    const { retention, forgotten } = world({ S1: ["T1"] }, { T1: "S1" });
    await retention.threadDeleted("never-bound");
    await retention.threadDeleted("corrupt");
    expect(forgotten).toEqual([]);
  });

  it("never throws when the forget fails or throws", async () => {
    const retention = createSnapshotRetention({
      index: {
        lookup: () => ({ status: "ok", binding: { sessionId: "S1" } }) as never,
        threadsOf: () => ["T1"],
      },
      forgetSession: async () => {
        throw new Error("disk");
      },
    });
    await expect(retention.threadDeleted("T1")).resolves.toBeUndefined();
  });
});
