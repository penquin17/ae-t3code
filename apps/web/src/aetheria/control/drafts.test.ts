import { describe, expect, it } from "vite-plus/test";

import { createDraftStore, type DraftStorage } from "./drafts";

const REV1 = "1".repeat(64);
const REV2 = "2".repeat(64);
const key = (interactionId: string, revision = REV1, sessionId = "s") => ({
  sessionId,
  interactionId,
  revision,
});

class MemoryStorage implements DraftStorage {
  readonly map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
  keys = () => [...this.map.keys()];
}

let clock = 0;
const tick = () => (clock += 1);

describe("drafts keyed by session, interaction and revision", () => {
  it("returns what was written for the same key", () => {
    const store = createDraftStore(null, { now: tick });
    store.write(key("i-1"), "hello");
    expect(store.read(key("i-1"))).toEqual({ status: "current", value: "hello" });
    expect(store.read(key("i-2"))).toEqual({ status: "none" });
  });

  it("restores unsent drafts after a reload from the persisted store", () => {
    const storage = new MemoryStorage();
    createDraftStore(storage, { now: tick }).write(key("i-1"), "unsent words");
    const reloaded = createDraftStore(storage, { now: tick });
    expect(reloaded.read(key("i-1"))).toEqual({ status: "current", value: "unsent words" });
  });

  it("a superseded revision reads as an earlier version, never as the current draft", () => {
    const store = createDraftStore(new MemoryStorage(), { now: tick });
    store.write(key("i-1", REV1), "old text");
    expect(store.read(key("i-1", REV2))).toEqual({
      status: "earlier",
      value: "old text",
      revision: REV1,
    });
    store.write(key("i-1", REV2), "new text");
    expect(store.read(key("i-1", REV2))).toEqual({ status: "current", value: "new text" });
  });

  it("the latest earlier revision is the one offered", () => {
    const store = createDraftStore(null, { now: tick });
    store.write(key("i-1", "a".repeat(64)), "first");
    store.write(key("i-1", "b".repeat(64)), "second");
    expect(store.read(key("i-1", REV2))).toMatchObject({ status: "earlier", value: "second" });
  });

  it("is cleared only when asked, and clearing takes every revision of that interaction only", () => {
    const storage = new MemoryStorage();
    const store = createDraftStore(storage, { now: tick });
    store.write(key("i-1", REV1), "a");
    store.write(key("i-1", REV2), "b");
    store.write(key("i-10", REV1), "similar id");
    store.write(key("i-1", REV1, "other"), "other session");
    expect(store.read(key("i-1", REV1)).status).toBe("current");
    store.clear(key("i-1", REV2));
    expect(store.read(key("i-1", REV1))).toEqual({ status: "none" });
    expect(store.read(key("i-10", REV1))).toEqual({ status: "current", value: "similar id" });
    expect(store.read(key("i-1", REV1, "other"))).toEqual({
      status: "current",
      value: "other session",
    });
    expect(createDraftStore(storage, { now: tick }).read(key("i-1", REV1))).toEqual({
      status: "none",
    });
  });

  it("ids with separators do not collide across the session/interaction boundary", () => {
    const store = createDraftStore(new MemoryStorage(), { now: tick });
    store.write({ sessionId: "a:b", interactionId: "c", revision: REV1 }, "one");
    expect(store.read({ sessionId: "a", interactionId: "b:c", revision: REV1 })).toEqual({
      status: "none",
    });
  });

  it("a storage that refuses writes degrades to memory without losing the text", () => {
    const failing: DraftStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
      keys: () => [],
    };
    const store = createDraftStore(failing, { now: tick });
    expect(store.degraded()).toBe(false);
    store.write(key("i-1"), "kept in memory");
    expect(store.degraded()).toBe(true);
    expect(store.read(key("i-1"))).toEqual({ status: "current", value: "kept in memory" });
  });

  it("a storage that cannot be read degrades to memory", () => {
    const broken: DraftStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
      removeItem: () => {},
      keys: () => {
        throw new Error("SecurityError");
      },
    };
    const store = createDraftStore(broken, { now: tick });
    expect(store.read(key("i-1"))).toEqual({ status: "none" });
    expect(store.degraded()).toBe(true);
    store.write(key("i-1"), "still here");
    expect(store.read(key("i-1"))).toEqual({ status: "current", value: "still here" });
  });

  it("an entry in storage that is not a draft is ignored", () => {
    const storage = new MemoryStorage();
    storage.setItem("aetheria:control-draft:garbage", "{not json");
    storage.setItem("unrelated", "x");
    const store = createDraftStore(storage, { now: tick });
    expect(store.read(key("i-1"))).toEqual({ status: "none" });
  });
});
