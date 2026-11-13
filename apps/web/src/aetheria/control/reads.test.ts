import { describe, expect, it, vi } from "vite-plus/test";

import { classifyRead, createSequencedReader, readView, type ReadState } from "./reads";
import type { TransportResult } from "./types";

const reply = (value: unknown): TransportResult => ({ tag: "reply", reply: value });
const MODE = { sessionId: "s", active: true, modeRevision: 2 };

describe("a single-value read is read as it is", () => {
  it("an accepted value is carried, and null stays null (nothing published)", () => {
    expect(classifyRead<typeof MODE>(reply({ ok: true, value: MODE }))).toEqual({
      tag: "ok",
      value: MODE,
    });
    expect(classifyRead<null>(reply({ ok: true, value: null }))).toEqual({
      tag: "ok",
      value: null,
    });
  });

  it.each([
    [
      "a coded failure",
      reply({ ok: false, code: "INTERACTION_UNAVAILABLE", detail: "unreadable" }),
      "unreadable",
    ],
    [
      "a coded failure without words",
      reply({ ok: false, code: "INTERACTION_NOT_FOUND" }),
      "INTERACTION_NOT_FOUND",
    ],
    ["a non-reply", reply("x"), "the Backend's reply was not a reply"],
    ["ok without a value", reply({ ok: true }), "the Backend's reply was not a reply"],
    ["a lost reply", { tag: "lost" } as TransportResult, "the reply to the read never arrived"],
    ["a T3 failure", { tag: "failed", message: "scope" } as TransportResult, "scope"],
  ])("%s is a failed read, never an empty value", (_name, input, reason) => {
    expect(classifyRead(input)).toMatchObject({ tag: "failed", reason });
  });
});

describe("what a read shows", () => {
  it("shows nothing as known before the first read, then the value, then keeps it stale on failure", () => {
    let state: ReadState<typeof MODE> = { status: "waiting" };
    expect(readView(state)).toEqual({
      state: "unknown",
      reason: "waiting for the Backend's first read",
    });
    state = { status: "ok", value: MODE };
    expect(readView(state)).toEqual({ state: "known", value: MODE, stale: false });
    state = { status: "failed", reason: "closed", last: MODE };
    expect(readView(state)).toEqual({ state: "known", value: MODE, stale: true, reason: "closed" });
  });

  it("a failure with no earlier value is unavailable, not empty", () => {
    expect(readView({ status: "failed", reason: "unreadable" })).toEqual({
      state: "unavailable",
      reason: "unreadable",
    });
  });
});

describe("reads are sequenced so a confirming read starts after the action", () => {
  it("a call while a read runs starts exactly one further read, shared by every waiter", async () => {
    const starts: Array<(value: string) => void> = [];
    const read = createSequencedReader(
      () => new Promise<string>((resolve) => starts.push(resolve)),
    );
    const first = read();
    const second = read();
    const third = read();
    expect(starts).toHaveLength(1);
    expect(second).toBe(third);
    starts[0]!("one");
    expect(await first).toBe("one");
    await vi.waitFor(() => expect(starts).toHaveLength(2));
    starts[1]!("two");
    expect(await second).toBe("two");
    expect(await third).toBe("two");
  });

  it("an idle reader starts a read at once", async () => {
    let n = 0;
    const read = createSequencedReader(async () => (n += 1));
    expect(await read()).toBe(1);
    expect(await read()).toBe(2);
  });
});
