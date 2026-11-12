// M10 Plan step 5 (R1, D4): a per-child Stop reads the root's list for the child's mode, then interrupts a continuable child or closes a one-shot child, once. Nothing is sent for a
// child the Backend does not list under the root, and a failed read sends nothing.
import { describe, expect, it } from "vitest";

import type { SendResult } from "../core/outcome";
import { childStopSend, type ChildStopCalls } from "./childStop";

const ids = { rootThreadId: "root", childThreadId: "child" };
const row = (mode: "continuable" | "one-shot") => ({ childId: "child", mode });
const listed = (rows: ReadonlyArray<{ childId: string; mode: "continuable" | "one-shot" }>) =>
  Promise.resolve<SendResult<unknown>>({
    tag: "accepted",
    value: { ok: true, value: { rows } },
  });
const accepted = Promise.resolve<SendResult<unknown>>({
  tag: "accepted",
  value: { ok: true, value: { accepted: true } },
});

function recorder(overrides: Partial<ChildStopCalls> = {}) {
  const calls: string[] = [];
  const dependencies: ChildStopCalls = {
    list: () => {
      calls.push("list");
      return listed([row("continuable")]);
    },
    interrupt: () => {
      calls.push("interrupt");
      return accepted;
    },
    close: () => {
      calls.push("close");
      return accepted;
    },
    ...overrides,
  };
  return { calls, dependencies };
}

describe("childStopSend", () => {
  it("interrupts a continuable child, once, and does not close it", async () => {
    const { calls, dependencies } = recorder();
    expect(await childStopSend(dependencies, ids)).toMatchObject({ tag: "accepted" });
    expect(calls).toEqual(["list", "interrupt"]);
  });

  it("closes a one-shot child, once, and does not interrupt it", async () => {
    const { calls, dependencies } = recorder({ list: () => listed([row("one-shot")]) });
    expect(await childStopSend(dependencies, ids)).toMatchObject({ tag: "accepted" });
    expect(calls).toEqual(["close"]);
  });

  it("sends nothing for a child the Backend does not list under the root", async () => {
    const { calls, dependencies } = recorder({
      list: () => listed([{ childId: "someone-else", mode: "continuable" }]),
    });
    expect(await childStopSend(dependencies, ids)).toMatchObject({
      tag: "refused",
      code: "CHILDREN_NOT_FOUND",
    });
    expect(calls).toEqual([]);
  });

  it("a read that failed or whose reply was lost is unavailable (nothing was sent), not unknown", async () => {
    for (const read of [
      Promise.resolve<SendResult<unknown>>({ tag: "lost" }),
      Promise.resolve<SendResult<unknown>>({ tag: "unavailable", reason: "x" }),
      Promise.resolve<SendResult<unknown>>({
        tag: "accepted",
        value: { ok: false, code: "CHILDREN_UNAVAILABLE", detail: "x" },
      }),
      Promise.resolve<SendResult<unknown>>({
        tag: "accepted",
        value: { ok: false, code: "CHILDREN_OUTCOME_UNKNOWN" },
      }),
    ]) {
      const { calls, dependencies } = recorder({ list: () => read });
      expect(await childStopSend(dependencies, ids)).toMatchObject({ tag: "unavailable" });
      expect(calls).toEqual([]);
    }
  });

  it("a refused read stays a refusal, and nothing is sent", async () => {
    const { calls, dependencies } = recorder({
      list: () =>
        Promise.resolve<SendResult<unknown>>({
          tag: "accepted",
          value: { ok: false, code: "CHILDREN_DEVICE_REVOKED" },
        }),
    });
    expect(await childStopSend(dependencies, ids)).toMatchObject({
      tag: "refused",
      code: "CHILDREN_DEVICE_REVOKED",
    });
    expect(calls).toEqual([]);
  });

  it("a lost interrupt or close reply is unknown and is not repeated", async () => {
    for (const mode of ["continuable", "one-shot"] as const) {
      const lost = Promise.resolve<SendResult<unknown>>({ tag: "lost" });
      const { calls, dependencies } = recorder({
        list: () => listed([row(mode)]),
        interrupt: () => {
          calls.push("interrupt");
          return lost;
        },
        close: () => {
          calls.push("close");
          return lost;
        },
      });
      expect(await childStopSend(dependencies, ids)).toEqual({ tag: "lost" });
      expect(calls).toEqual([mode === "continuable" ? "interrupt" : "close"]);
    }
  });

  it("an M05 refusal of the act is shown as the refusal it is", async () => {
    const { dependencies } = recorder({
      interrupt: () =>
        Promise.resolve<SendResult<unknown>>({
          tag: "accepted",
          value: { ok: false, code: "NOT_AUTHORIZED" },
        }),
    });
    expect(await childStopSend(dependencies, ids)).toMatchObject({
      tag: "refused",
      code: "NOT_AUTHORIZED",
    });
  });
});
