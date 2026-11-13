import { describe, expect, it } from "vite-plus/test";

import {
  createActionRunner,
  type ConfirmResult,
  type OutcomeStep,
  type SendResult,
} from "./outcome";

let ids = 0;
const newRequestId = () => `req-${++ids}`;
const runner = () => createActionRunner({ newRequestId });

/** One scripted step: records every send and returns what the test scripted. */
function step<T>(
  label: string,
  send: SendResult<T>,
  confirm?: ConfirmResult | (() => Promise<ConfirmResult>),
): OutcomeStep<T> & { sends: string[]; confirms: number } {
  const record = { sends: [] as string[], confirms: 0 };
  return Object.assign(record, {
    label,
    send: async (requestId: string) => {
      record.sends.push(requestId);
      return send;
    },
    ...(confirm === undefined
      ? {}
      : {
          confirm: async () => {
            record.confirms += 1;
            return typeof confirm === "function" ? confirm() : confirm;
          },
        }),
  });
}

describe("the five outcomes", () => {
  it("confirmed: the backend accepted and the next projection shows it", async () => {
    const s = step("rename", { tag: "accepted", value: "ok" }, { tag: "shows" });
    const { outcome } = await runner().run("row-1", s);
    expect(outcome).toEqual({ kind: "confirmed", value: "ok", refreshed: true });
    expect(s.confirms).toBe(1);
  });

  it("confirmed without a re-read seat carries refreshed:false, never a pretended refresh", async () => {
    const s = step("pin", { tag: "accepted", value: undefined });
    const { outcome } = await runner().run("row-1", s);
    expect(outcome).toEqual({ kind: "confirmed", value: undefined, refreshed: false });
  });

  it("refused carries the backend code and message and nothing else changed", async () => {
    const s = step("archive", { tag: "refused", code: "THREAD_RUNNING", message: "still running" });
    const { outcome } = await runner().run("row-1", s);
    expect(outcome).toEqual({ kind: "refused", code: "THREAD_RUNNING", message: "still running" });
    expect(s.confirms).toBe(0);
  });

  it("a lost reply is unknown, is sent exactly once and is not re-read as a guess", async () => {
    const s = step("fork", { tag: "lost" }, { tag: "shows" });
    const { outcome } = await runner().run("row-1", s);
    expect(outcome.kind).toBe("unknown");
    expect(s.sends).toHaveLength(1);
    expect(s.confirms).toBe(0);
  });

  it("unavailable carries the reason, with no send retried", async () => {
    const s = step("fork", { tag: "unavailable", reason: "backend not reachable" });
    const { outcome } = await runner().run("row-1", s);
    expect(outcome).toEqual({ kind: "unavailable", reason: "backend not reachable" });
    expect(s.sends).toHaveLength(1);
  });
});

describe("saving, then reading back", () => {
  it("a failed read-back after an accepted save is unknown, never confirmed, and says why", async () => {
    const s = step(
      "rename",
      { tag: "accepted", value: undefined },
      { tag: "failed", reason: "snapshot read failed" },
    );
    const { outcome } = await runner().run("row-1", s);
    expect(outcome.kind).toBe("unknown");
    expect(outcome.kind === "unknown" && outcome.reason).toContain("snapshot read failed");
    expect(outcome.kind === "unknown" && outcome.reason).toContain("rename");
    expect(s.sends).toHaveLength(1);
  });

  it("the words of a failed read-back differ from those of an absent one", async () => {
    const failed = await runner().run(
      "k1",
      step("rename", { tag: "accepted", value: 1 }, { tag: "failed", reason: "boom" }),
    );
    const absent = await runner().run(
      "k2",
      step("rename", { tag: "accepted", value: 1 }, { tag: "absent" }),
    );
    expect(failed.outcome).not.toEqual(absent.outcome);
  });

  it("only a read-back that shows the result is refreshed:true", async () => {
    const results = await Promise.all(
      (["shows", "absent", "failed"] as const).map((tag, i) =>
        runner().run(
          `k${i}`,
          step(
            "pin",
            { tag: "accepted", value: 1 },
            tag === "failed" ? { tag, reason: "x" } : { tag },
          ),
        ),
      ),
    );
    expect(results.map((r) => r.outcome.kind === "confirmed" && r.outcome.refreshed)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("an accepted save the projection does not show is unknown, not confirmed", async () => {
    const s = step("rename", { tag: "accepted", value: undefined }, { tag: "absent" });
    const { outcome } = await runner().run("row-1", s);
    expect(outcome.kind).toBe("unknown");
  });
});

describe("request ids", () => {
  it("every send carries its own fresh request id, and an id does not make a send exactly-once", async () => {
    const r = runner();
    const a = step("one", { tag: "lost" });
    const b = step("two", { tag: "lost" });
    const first = await r.run("row-1", a);
    const second = await r.run("row-1", b);
    expect(first.requestId).not.toBe(second.requestId);
    expect(a.sends[0]).toBe(first.requestId);
    expect(b.sends[0]).toBe(second.requestId);
  });
});

describe("stale replies", () => {
  it("a reply that settles after a newer action on the same key is marked not current", async () => {
    const r = runner();
    let release: (() => void) | undefined;
    const slow: OutcomeStep<undefined> = {
      label: "rename-old",
      send: () =>
        new Promise((resolve) => {
          release = () => resolve({ tag: "accepted", value: undefined });
        }),
    };
    const older = r.run("row-1", slow);
    const newer = await r.run("row-1", step("rename-new", { tag: "accepted", value: undefined }));
    release?.();
    const olderResult = await older;
    expect(newer.current).toBe(true);
    expect(olderResult.current).toBe(false);
    expect(olderResult.outcome.kind).toBe("confirmed");
  });

  it("a different key does not make a reply stale", async () => {
    const r = runner();
    let release: (() => void) | undefined;
    const slow: OutcomeStep<undefined> = {
      label: "a",
      send: () =>
        new Promise((resolve) => {
          release = () => resolve({ tag: "accepted", value: undefined });
        }),
    };
    const first = r.run("row-1", slow);
    await r.run("row-2", step("b", { tag: "accepted", value: undefined }));
    release?.();
    expect((await first).current).toBe(true);
  });
});

describe("a sequence of steps (fork, then rename)", () => {
  it("both steps confirmed: one confirmed outcome carrying each step's value", async () => {
    const fork = step("fork", { tag: "accepted", value: "new-id" }, { tag: "shows" });
    const rename = step("rename", { tag: "accepted", value: undefined }, { tag: "shows" });
    const { outcome } = await runner().runSequence("row-1", [fork, rename]);
    expect(outcome.kind).toBe("confirmed");
    expect(outcome.kind === "confirmed" && outcome.value).toEqual(["new-id", undefined]);
  });

  it("the fork lands and the rename is refused: partial, naming what applied and what failed", async () => {
    const fork = step("fork", { tag: "accepted", value: "new-id" }, { tag: "shows" });
    const rename = step("rename", { tag: "refused", code: "TITLE_EMPTY", message: "empty title" });
    const { outcome } = await runner().runSequence("row-1", [fork, rename]);
    expect(outcome).toEqual({
      kind: "partial",
      applied: ["fork"],
      failed: {
        step: "rename",
        outcome: { kind: "refused", code: "TITLE_EMPTY", message: "empty title" },
      },
    });
  });

  it("the fork lands and the rename reply is lost: partial with an unknown failure, rename sent once", async () => {
    const fork = step("fork", { tag: "accepted", value: "new-id" }, { tag: "shows" });
    const rename = step("rename", { tag: "lost" });
    const { outcome } = await runner().runSequence("row-1", [fork, rename]);
    expect(outcome.kind).toBe("partial");
    expect(outcome.kind === "partial" && outcome.failed.outcome.kind).toBe("unknown");
    expect(rename.sends).toHaveLength(1);
  });

  it("the fork lands and the rename's read-back fails: partial with an unknown rename, not confirmed", async () => {
    const fork = step("fork", { tag: "accepted", value: "new-id" }, { tag: "shows" });
    const rename = step(
      "rename",
      { tag: "accepted", value: undefined },
      { tag: "failed", reason: "snapshot read failed" },
    );
    const { outcome } = await runner().runSequence("row-1", [fork, rename]);
    expect(outcome).toMatchObject({
      kind: "partial",
      applied: ["fork"],
      failed: { step: "rename", outcome: { kind: "unknown" } },
    });
  });

  it("the first step failing runs nothing after it and reports that step's own outcome", async () => {
    const fork = step("fork", { tag: "refused", code: "NO_ACCESS", message: "no" });
    const rename = step("rename", { tag: "accepted", value: undefined });
    const { outcome } = await runner().runSequence("row-1", [fork, rename]);
    expect(outcome).toEqual({ kind: "refused", code: "NO_ACCESS", message: "no" });
    expect(rename.sends).toHaveLength(0);
  });
});
