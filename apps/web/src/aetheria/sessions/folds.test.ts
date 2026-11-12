import { describe, expect, it } from "vite-plus/test";

import {
  FOLDS_STORAGE_KEY,
  foldKey,
  readFolds,
  resolveOpen,
  writeFolds,
  type FoldStorage,
} from "./folds";

const memory = (initial?: string): FoldStorage & { value: string | null } => ({
  value: initial ?? null,
  getItem() {
    return this.value;
  },
  setItem(_key, value) {
    this.value = value;
  },
});

describe("fold keys", () => {
  it("keep the persisted names", () => {
    expect(FOLDS_STORAGE_KEY).toBe("aetheria-ui:folds");
    expect(foldKey.project("w1")).toBe("project:w1");
    expect(foldKey.section("w1", "dormant")).toBe("section:w1:dormant");
    expect(foldKey.pinned("w1")).toBe("section:w1:pinned");
    expect(foldKey.groups("w1")).toBe("section:w1:groups");
    expect(foldKey.group("w1", "old")).toBe("group:w1:old");
  });
});

describe("resolveOpen", () => {
  it("a saved value wins over the default", () => {
    expect(resolveOpen({ k: false }, "k", true, false)).toBe(false);
    expect(resolveOpen({ k: true }, "k", false, false)).toBe(true);
  });

  it("without a saved value the default decides", () => {
    expect(resolveOpen({}, "k", true, false)).toBe(true);
    expect(resolveOpen({}, "k", false, false)).toBe(false);
  });

  it("a search forces open without saving, even over a saved fold", () => {
    expect(resolveOpen({ k: false }, "k", false, true)).toBe(true);
  });
});

describe("storage", () => {
  it("reads nothing as empty, and a saved record back", () => {
    expect(readFolds(memory())).toEqual({ ok: true, folds: {} });
    const storage = memory();
    writeFolds(storage, { "project:w1": true });
    expect(readFolds(storage)).toEqual({ ok: true, folds: { "project:w1": true } });
  });

  it("a corrupt or non-boolean record reads as empty and says it was unreadable", () => {
    expect(readFolds(memory("{nope"))).toEqual({ ok: false, folds: {} });
    expect(readFolds(memory('{"a":1}'))).toEqual({ ok: false, folds: {} });
    expect(readFolds(memory("[true]"))).toEqual({ ok: false, folds: {} });
  });

  it("a storage that throws never throws to the caller: reads are empty, writes report failure", () => {
    const broken: FoldStorage = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    };
    expect(readFolds(broken)).toEqual({ ok: false, folds: {} });
    expect(writeFolds(broken, { a: true })).toBe(false);
  });

  it("keeps entries it does not consult when it writes (legacy keys are preserved)", () => {
    const storage = memory(JSON.stringify({ "project:folder:/old": true, "project:w1": false }));
    const read = readFolds(storage);
    writeFolds(storage, { ...read.folds, "project:w2": true });
    expect(JSON.parse(storage.value ?? "{}")).toEqual({
      "project:folder:/old": true,
      "project:w1": false,
      "project:w2": true,
    });
  });
});
