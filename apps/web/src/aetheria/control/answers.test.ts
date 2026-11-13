import { describe, expect, it } from "vite-plus/test";

import {
  emptyDraft,
  parseDraft,
  serializeDraft,
  toggleOption,
  validateDraft,
  type QuestionDraft,
} from "./answers";
import type { Question } from "./types";

const SINGLE: Question = {
  id: "q1",
  question: "Which colour?",
  options: [{ label: "Red" }, { label: "Blue" }],
};
const MULTI: Question = { ...SINGLE, id: "q2", multiSelect: true };
const FREE: Question = { id: "q3", question: "Why?" };

const draft = (over: Record<string, Partial<QuestionDraft[string]>>): QuestionDraft => {
  const base = emptyDraft([SINGLE, MULTI, FREE]);
  return Object.fromEntries(
    Object.entries(base).map(([id, entry]) => [id, { ...entry, ...over[id] }]),
  );
};
const QUESTIONS = [SINGLE, MULTI, FREE];

describe("an answer batch is valid only when the contract would accept it", () => {
  it("starts with nothing answered, so nothing can be sent", () => {
    const result = validateDraft(QUESTIONS, emptyDraft(QUESTIONS));
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.problems)).toEqual(["q1", "q2", "q3"]);
  });

  it("builds one answer per question in question order", () => {
    const result = validateDraft(
      QUESTIONS,
      draft({
        q1: { selected: ["Red"] },
        q2: { selected: ["Red", "Blue"] },
        q3: { custom: "Because" },
      }),
    );
    expect(result).toEqual({
      ok: true,
      answers: [
        { id: "q1", selected: ["Red"], skipped: false },
        { id: "q2", selected: ["Red", "Blue"], skipped: false },
        { id: "q3", selected: [], custom: "Because", skipped: false },
      ],
    });
  });

  it("refuses two options for a single-select question", () => {
    const result = validateDraft(
      QUESTIONS,
      draft({ q1: { selected: ["Red", "Blue"] }, q2: { selected: ["Red"] }, q3: { custom: "x" } }),
    );
    expect(!result.ok && result.problems["q1"]).toMatch(/one option/);
  });

  it("refuses an option the question did not offer", () => {
    const result = validateDraft(
      QUESTIONS,
      draft({ q1: { selected: ["Green"] }, q2: { selected: ["Red"] }, q3: { custom: "x" } }),
    );
    expect(!result.ok && result.problems["q1"]).toMatch(/not offered/);
  });

  it("a skipped question carries nothing, even when text or options were left in the draft", () => {
    const result = validateDraft(
      QUESTIONS,
      draft({
        q1: { skipped: true, selected: ["Red"], custom: "left over" },
        q2: { selected: ["Blue"] },
        q3: { skipped: true },
      }),
    );
    expect(result).toEqual({
      ok: true,
      answers: [
        { id: "q1", selected: [], skipped: true },
        { id: "q2", selected: ["Blue"], skipped: false },
        { id: "q3", selected: [], skipped: true },
      ],
    });
  });

  it("blank free text is no answer", () => {
    const result = validateDraft([FREE], { q3: { selected: [], custom: "   \n", skipped: false } });
    expect(result.ok).toBe(false);
  });

  it("free text beside options is allowed and sent as custom", () => {
    const result = validateDraft([SINGLE], {
      q1: { selected: [], custom: "Green", skipped: false },
    });
    expect(result).toEqual({
      ok: true,
      answers: [{ id: "q1", selected: [], custom: "Green", skipped: false }],
    });
  });
});

describe("choosing options", () => {
  it("single-select replaces the choice and toggles it off", () => {
    const entry = { selected: ["Red"], custom: "", skipped: false };
    expect(toggleOption(SINGLE, entry, "Blue").selected).toEqual(["Blue"]);
    expect(toggleOption(SINGLE, entry, "Red").selected).toEqual([]);
  });

  it("multi-select adds and removes", () => {
    const entry = { selected: ["Red"], custom: "", skipped: false };
    expect(toggleOption(MULTI, entry, "Blue").selected).toEqual(["Red", "Blue"]);
    expect(toggleOption(MULTI, { ...entry, selected: ["Red", "Blue"] }, "Red").selected).toEqual([
      "Blue",
    ]);
  });

  it("choosing an option clears a skip", () => {
    const entry = { selected: [], custom: "", skipped: true };
    expect(toggleOption(SINGLE, entry, "Red").skipped).toBe(false);
  });
});

describe("a draft survives as text", () => {
  it("round-trips", () => {
    const value = draft({ q1: { selected: ["Red"] }, q3: { custom: "typed" } });
    expect(parseDraft(serializeDraft(value), QUESTIONS)).toEqual(value);
  });

  it.each(["", "{not json", "[]", '{"q1":5}', "null"])("%j is not a draft", (text) => {
    expect(parseDraft(text, QUESTIONS)).toBeNull();
  });

  it("keeps entries for questions that exist and drops the rest", () => {
    const parsed = parseDraft(
      JSON.stringify({ q1: { selected: ["Red"], custom: "", skipped: false }, gone: {} }),
      [SINGLE],
    );
    expect(Object.keys(parsed ?? {})).toEqual(["q1"]);
  });
});
