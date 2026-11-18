import { describe, expect, it } from "vite-plus/test";

import { chatSummary } from "./chatSummary";
import type { InteractionRecord } from "./types";

const record = (
  interactionId: string,
  kind: InteractionRecord["kind"],
  patch: Partial<InteractionRecord> = {},
): InteractionRecord =>
  ({
    interactionId,
    kind,
    state: "pending",
    held: false,
    revision: "r",
    rootSessionId: "root",
    sessionId: "root",
    createdAt: "2026-01-01T00:00:00Z",
    content: {},
    ...patch,
  }) as InteractionRecord;

describe("chatSummary", () => {
  it("is null when nothing is open, so the chat shows nothing", () => {
    expect(chatSummary([])).toBeNull();
    expect(chatSummary([record("a", "question", { state: "answered" })])).toBeNull();
    expect(chatSummary([record("a", "question", { state: "cancelled" })])).toBeNull();
  });

  it("cards every open request that is not held, a continued one included", () => {
    const summary = chatSummary([
      record("q", "question"),
      record("c", "question", { state: "continued" }),
      record("p", "plan-review"),
      record("done", "question", { state: "answered" }),
    ]);
    expect(summary?.cards.map((r) => r.interactionId)).toEqual(["q", "c", "p"]);
    expect(summary?.title).toBe("3 requests are waiting for you");
  });

  it("names a single request by its kind", () => {
    expect(chatSummary([record("q", "question")])?.title).toBe("A question is waiting for you");
    expect(chatSummary([record("p", "plan-review")])?.title).toBe(
      "A plan review is waiting for you",
    );
    expect(chatSummary([record("a", "authorization")])?.title).toBe(
      "An authorization request is waiting for you",
    );
  });

  it("gives a held request no card but keeps it in the banner", () => {
    const held = chatSummary([record("h", "question", { held: true })]);
    expect(held?.cards).toEqual([]);
    expect(held?.title).toBe("1 held request");
    const mixed = chatSummary([record("q", "question"), record("h", "question", { held: true })]);
    expect(mixed?.cards.map((r) => r.interactionId)).toEqual(["q"]);
    expect(mixed?.title).toBe("A question is waiting for you");
    expect(mixed?.description).toBe("1 held. Answer here or on the Human control page.");
  });
});
