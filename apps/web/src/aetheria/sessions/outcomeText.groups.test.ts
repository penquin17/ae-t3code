// Each of the five outcomes read plainly for every group change and for fork-as. Boundary: the pure wording function;
// it shows what the status line says, not how a screen places it.
import { describe, expect, it } from "vite-plus/test";

import type { ActionOutcome } from "../core/outcome";
import { outcomeText, refusalOf } from "./outcomeText";

const LABELS = [
  "Group",
  "Ungroup",
  "Dismiss suggestion",
  "Detach",
  "Rename group",
  "Fork as",
] as const;
const MESSAGE = "This device is read-only: ‘no’ — verbatim.";

const OUTCOMES: readonly (readonly [string, ActionOutcome<unknown>, RegExp])[] = [
  ["confirmed and re-read", { kind: "confirmed", value: null, refreshed: true }, /done\.$/],
  [
    "refused",
    { kind: "refused", code: "GROUPS_NOT_AUTHORIZED", message: MESSAGE },
    new RegExp(`refused: ${MESSAGE}`),
  ],
  [
    "unknown",
    { kind: "unknown", reason: "the reply never arrived" },
    /not known whether it applied \(the reply never arrived\)\. Check the list; it was not sent again\./,
  ],
  ["unavailable", { kind: "unavailable", reason: "not connected" }, /unavailable: not connected/],
  [
    "partial",
    {
      kind: "partial",
      applied: ["Fork"],
      failed: {
        step: "Rename",
        outcome: { kind: "refused", code: "X", message: "title is taken" },
      },
    },
    /partly done: Fork applied; Rename refused: title is taken/,
  ],
];

describe.each(LABELS)("%s", (label) => {
  it.each(OUTCOMES)("says %s plainly", (_name, outcome, pattern) => {
    const notice = outcomeText(label, outcome);
    expect(notice.text.startsWith(label)).toBe(true);
    expect(notice.text).toMatch(pattern);
  });
});

describe("a refusal keeps its code and the Backend's message for the screen", () => {
  it("is carried verbatim", () => {
    const outcome = { kind: "refused", code: "GROUPS_NOT_AUTHORIZED", message: MESSAGE } as const;
    expect(refusalOf(outcome)).toEqual({ code: "GROUPS_NOT_AUTHORIZED", message: MESSAGE });
    expect(outcomeText("Rename group", outcome).tone).toBe("error");
  });

  it("is absent from every other outcome", () => {
    expect(refusalOf({ kind: "unavailable", reason: "x" })).toBeUndefined();
    expect(refusalOf({ kind: "unknown", reason: "x" })).toBeUndefined();
  });
});
