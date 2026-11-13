// A question card's draft and the one place it becomes an answer batch (C7). Mirrors the Backend's answer rules (`validateAnswerBatch`, packages/aetheria-interaction/src/core.ts): one answer per
// question, options from those offered, one option for a single-select, a skipped answer carrying nothing. The Backend validates again and its refusal is shown verbatim; this only keeps an
// answer the contract would refuse from being sent. Plain TypeScript.
import type { Answer, Question } from "./types";

export interface AnswerDraftEntry {
  readonly selected: readonly string[];
  readonly custom: string;
  readonly skipped: boolean;
}
export type QuestionDraft = Readonly<Record<string, AnswerDraftEntry>>;

const emptyEntry: AnswerDraftEntry = { selected: [], custom: "", skipped: false };

export const emptyDraft = (questions: readonly Question[]): QuestionDraft =>
  Object.fromEntries(questions.map((question) => [question.id, emptyEntry]));

export type DraftValidation =
  | { readonly ok: true; readonly answers: readonly Answer[] }
  | { readonly ok: false; readonly problems: Readonly<Record<string, string>> };

function problemWith(question: Question, entry: AnswerDraftEntry): string | null {
  const offered = (question.options ?? []).map((option) => option.label);
  const hasCustom = entry.custom.trim() !== "";
  if (entry.selected.length === 0 && !hasCustom) {
    return offered.length > 0
      ? "Choose an option, write an answer, or skip this question."
      : "Write an answer or skip this question.";
  }
  if (entry.selected.some((label) => !offered.includes(label)))
    return "That option is not offered by this question.";
  if (question.multiSelect !== true && entry.selected.length > 1)
    return "This question takes one option.";
  return null;
}

export function validateDraft(
  questions: readonly Question[],
  draft: QuestionDraft,
): DraftValidation {
  const answers: Answer[] = [];
  const problems: Record<string, string> = {};
  for (const question of questions) {
    const entry = draft[question.id] ?? emptyEntry;
    if (entry.skipped) {
      answers.push({ id: question.id, selected: [], skipped: true });
      continue;
    }
    const problem = problemWith(question, entry);
    if (problem !== null) {
      problems[question.id] = problem;
      continue;
    }
    answers.push({
      id: question.id,
      selected: [...entry.selected],
      ...(entry.custom.trim() === "" ? {} : { custom: entry.custom }),
      skipped: false,
    });
  }
  return Object.keys(problems).length === 0 ? { ok: true, answers } : { ok: false, problems };
}

/** Choosing an option: a single-select replaces (and toggles off), a multi-select adds or removes. Choosing clears a skip. */
export function toggleOption(
  question: Question,
  entry: AnswerDraftEntry,
  label: string,
): AnswerDraftEntry {
  const has = entry.selected.includes(label);
  const selected =
    question.multiSelect === true
      ? has
        ? entry.selected.filter((item) => item !== label)
        : [...entry.selected, label]
      : has
        ? []
        : [label];
  return { ...entry, selected, skipped: false };
}

export const serializeDraft = (draft: QuestionDraft): string => JSON.stringify(draft);

/** A stored draft, or `null` when the text is not one. Only entries for questions that exist are kept. */
export function parseDraft(text: string, questions: readonly Question[]): QuestionDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const result: Record<string, AnswerDraftEntry> = {};
  for (const question of questions) {
    const raw = record[question.id] as Partial<AnswerDraftEntry> | undefined;
    if (raw === undefined) {
      result[question.id] = emptyEntry;
      continue;
    }
    if (
      raw === null ||
      typeof raw !== "object" ||
      !Array.isArray(raw.selected) ||
      typeof raw.custom !== "string" ||
      typeof raw.skipped !== "boolean"
    ) {
      return null;
    }
    result[question.id] = {
      selected: raw.selected.filter((item): item is string => typeof item === "string"),
      custom: raw.custom,
      skipped: raw.skipped,
    };
  }
  return result;
}
