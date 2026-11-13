import { describe, expect, it } from "vite-plus/test";

import { outcomeText } from "./outcomeText";

describe("outcomeText", () => {
  it("says what each outcome shows and no more", () => {
    expect(outcomeText("Pin", { kind: "confirmed", value: 1, refreshed: true })).toEqual({
      tone: "ok",
      text: "Pin done.",
    });
    expect(outcomeText("Pin", { kind: "confirmed", value: 1, refreshed: false })).toEqual({
      tone: "ok",
      text: "Pin sent; the list will show it when the backend reports it.",
    });
  });

  it("a refusal carries the backend's message and says nothing changed only as the backend said it", () => {
    expect(
      outcomeText("Archive", { kind: "refused", code: "X", message: "still running" }),
    ).toEqual({
      tone: "error",
      text: "Archive refused: still running",
    });
  });

  it("unknown and unavailable are never worded as done or failed", () => {
    const unknown = outcomeText("Fork", { kind: "unknown", reason: "no reply" });
    expect(unknown.tone).toBe("warning");
    expect(unknown.text).toContain("not known whether");
    const unavailable = outcomeText("Fork", { kind: "unavailable", reason: "no run to fork" });
    expect(unavailable).toEqual({ tone: "error", text: "Fork unavailable: no run to fork" });
  });

  it("a partial names what applied and what did not", () => {
    const partial = outcomeText("Fork", {
      kind: "partial",
      applied: ["fork"],
      failed: { step: "rename", outcome: { kind: "refused", code: "X", message: "empty" } },
    });
    expect(partial.tone).toBe("warning");
    expect(partial.text).toBe("Fork partly done: fork applied; rename refused: empty");
  });
});
