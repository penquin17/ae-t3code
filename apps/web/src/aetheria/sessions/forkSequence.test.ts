// Fork then rename as one sequence of two steps (Plan step 2/8): a fork that applied and a rename that did not is
// "partial", naming what applied. Boundary: the sequencing function over supplied steps and the real action runner;
// the T3 fork and rename commands are not exercised here.
import { describe, expect, it } from "vite-plus/test";

import { createActionRunner, type OutcomeStep, type SendResult } from "../core/outcome";
import { forkThenRename } from "./forkSequence";

let counter = 0;
const runner = () => createActionRunner({ newRequestId: () => `r-${(counter += 1)}` });

const forkStep = (sent: SendResult<string>, calls: string[]): OutcomeStep<string> => ({
  label: "Fork",
  send: async () => {
    calls.push("fork");
    return sent;
  },
  confirm: async () => ({ tag: "shows" }),
});
const renameStep =
  (sent: SendResult<unknown>, calls: string[]) =>
  (target: string): OutcomeStep<unknown> => ({
    label: "Rename",
    send: async () => {
      calls.push(`rename:${target}`);
      return sent;
    },
  });

describe("forkThenRename", () => {
  it("confirmed: the fork's new session comes first in the value, and the rename names it", async () => {
    const calls: string[] = [];
    const result = await forkThenRename(
      runner(),
      "s",
      forkStep({ tag: "accepted", value: "new-thread" }, calls),
      renameStep({ tag: "accepted", value: null }, calls),
    );
    expect(result.outcome).toMatchObject({ kind: "confirmed", value: ["new-thread", null] });
    expect(calls).toEqual(["fork", "rename:new-thread"]);
  });

  it.each([
    ["refused", { tag: "refused", code: "NOPE", message: "title is taken" }, "refused"],
    ["lost", { tag: "lost" }, "unknown"],
    ["unavailable", { tag: "unavailable", reason: "offline" }, "unavailable"],
  ] as const)(
    "fork applied and rename %s: partial, naming what applied",
    async (_name, sent, failedKind) => {
      const calls: string[] = [];
      const result = await forkThenRename(
        runner(),
        "s",
        forkStep({ tag: "accepted", value: "new-thread" }, calls),
        renameStep(sent, calls),
      );
      expect(result.outcome).toMatchObject({
        kind: "partial",
        applied: ["Fork"],
        failed: { step: "Rename", outcome: { kind: failedKind } },
      });
    },
  );

  it("the fork refused: the rename is never attempted", async () => {
    const calls: string[] = [];
    const result = await forkThenRename(
      runner(),
      "s",
      forkStep({ tag: "refused", code: "NO_RUN", message: "no run yet" }, calls),
      renameStep({ tag: "accepted", value: null }, calls),
    );
    expect(result.outcome).toMatchObject({ kind: "refused", message: "no run yet" });
    expect(calls).toEqual(["fork"]);
  });

  it("a lost fork reply is never resent and the rename waits for knowledge it does not have", async () => {
    const calls: string[] = [];
    const result = await forkThenRename(
      runner(),
      "s",
      forkStep({ tag: "lost" }, calls),
      renameStep({ tag: "accepted", value: null }, calls),
    );
    expect(result.outcome.kind).toBe("unknown");
    expect(calls).toEqual(["fork"]);
  });
});
