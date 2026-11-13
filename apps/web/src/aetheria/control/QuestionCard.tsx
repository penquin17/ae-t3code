// The question card (C7): the Backend's questions as supplied, a draft per (session, interaction, revision), validated answers, and the four intents answer / cancel / hold / close.
// Props in, intents out: it holds no Backend state, only what the person has typed.
import { useId } from "react";

import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import {
  emptyDraft,
  parseDraft,
  serializeDraft,
  toggleOption,
  validateDraft,
  type AnswerDraftEntry,
  type QuestionDraft,
} from "./answers";
import type { DraftStore } from "./drafts";
import { EarlierDraft, RawText, mutedClass, useStoredDraft } from "./parts";
import type { CardRunner } from "./InteractionCard";
import type { InteractionRecord, Question } from "./types";

type QuestionRecord = Extract<InteractionRecord, { kind: "question" }>;

export interface QuestionCardProps {
  readonly record: QuestionRecord;
  readonly drafts: DraftStore;
  readonly runner: CardRunner;
}

function QuestionBlock({
  question,
  entry,
  problem,
  disabled,
  onChange,
}: {
  readonly question: Question;
  readonly entry: AnswerDraftEntry;
  readonly problem: string | undefined;
  readonly disabled: boolean;
  readonly onChange: (next: AnswerDraftEntry) => void;
}) {
  const uid = useId();
  const multi = question.multiSelect === true;
  return (
    <fieldset
      data-question={question.id}
      disabled={disabled}
      className="flex min-w-0 flex-col gap-2 border-0 p-0"
    >
      <legend className="flex flex-col gap-0.5 p-0">
        {question.header === undefined ? null : (
          <span className={mutedClass}>{question.header}</span>
        )}
        <span className="text-sm font-medium break-words">{question.question}</span>
      </legend>
      {question.detail === undefined ? null : (
        <RawText text={question.detail} label={`Details for ${question.question}`} />
      )}
      {(question.options ?? []).map((option, index) => {
        const id = `${uid}-o${index}`;
        const checked = entry.selected.includes(option.label);
        return (
          <div key={option.label} className="flex flex-col gap-1">
            <label htmlFor={id} className="flex min-h-9 cursor-pointer items-start gap-2 text-sm">
              <input
                id={id}
                type={multi ? "checkbox" : "radio"}
                name={`${uid}-q`}
                checked={checked}
                onChange={() => onChange(toggleOption(question, entry, option.label))}
                className="mt-1 size-4 accent-primary"
              />
              <span className="min-w-0 break-words">
                {option.label}
                {option.description === undefined ? null : (
                  <span className={`${mutedClass} block`}>{option.description}</span>
                )}
              </span>
            </label>
            {option.context === undefined ? null : (
              <RawText text={option.context} label={`Context for ${option.label}`} />
            )}
          </div>
        );
      })}
      <label className="flex flex-col gap-1 text-sm">
        <span className={mutedClass}>
          {(question.options ?? []).length > 0 ? "Or write your own answer" : "Your answer"}
        </span>
        <Textarea
          aria-label={`Your own answer to: ${question.question}`}
          value={entry.custom}
          onChange={(event) => onChange({ ...entry, custom: event.target.value, skipped: false })}
        />
      </label>
      <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={entry.skipped}
          onChange={(event) => onChange({ ...entry, skipped: event.target.checked })}
          className="size-4 accent-primary"
        />
        Skip this question
      </label>
      {problem === undefined ? null : (
        <p role="alert" className="text-xs text-error-foreground">
          {problem}
        </p>
      )}
    </fieldset>
  );
}

export function QuestionCard({ record, drafts, runner }: QuestionCardProps) {
  const questions = record.content.questions;
  const key = {
    sessionId: record.sessionId,
    interactionId: record.interactionId,
    revision: record.revision,
  };
  const answers = useStoredDraft<QuestionDraft>(drafts, key, {
    empty: emptyDraft(questions),
    parse: (text) => parseDraft(text, questions),
    serialize: serializeDraft,
  });
  const feedback = useStoredDraft<string>(
    drafts,
    { ...key, interactionId: `${key.interactionId}#feedback` },
    { empty: "", parse: (text) => text, serialize: (value) => value },
  );
  const validation = validateDraft(questions, answers.value);
  const problems = validation.ok ? {} : validation.problems;
  const submitted = runner.attempted && !validation.ok;
  const payload = { interactionId: record.interactionId, revision: record.revision };
  const clearDrafts = () => {
    answers.clear();
    feedback.clear();
  };

  return (
    <form
      data-form="question"
      noValidate
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!validation.ok) {
          runner.markAttempted();
          return;
        }
        void runner.run(
          "Answer",
          (actions) => actions.answer({ ...payload, answers: validation.answers }),
          clearDrafts,
        );
      }}
    >
      {answers.earlier === null ? null : (
        <EarlierDraft text={answers.earlier.text} revision={answers.earlier.revision} />
      )}
      {questions.map((question) => (
        <QuestionBlock
          key={question.id}
          question={question}
          entry={answers.value[question.id] ?? { selected: [], custom: "", skipped: false }}
          problem={submitted ? problems[question.id] : undefined}
          disabled={runner.busy}
          onChange={(next) => answers.set({ ...answers.value, [question.id]: next })}
        />
      ))}
      <label className="flex flex-col gap-1 text-sm">
        <span className={mutedClass}>Feedback for a cancellation (optional)</span>
        <Textarea
          aria-label="Feedback for a cancellation"
          value={feedback.value}
          disabled={runner.busy}
          onChange={(event) => feedback.set(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={runner.busy}>
          Send answers
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={runner.busy}
          onClick={() =>
            void runner.run(
              "Cancel",
              (actions) =>
                actions.cancel({
                  ...payload,
                  ...(feedback.value.trim() === "" ? {} : { feedback: feedback.value }),
                }),
              clearDrafts,
            )
          }
        >
          Cancel question
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={runner.busy || record.held}
          onClick={() => void runner.run("Hold", (actions) => actions.hold(payload))}
        >
          {record.held ? "Held" : "Hold for later"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={runner.busy}
          onClick={() => void runner.run("Close", (actions) => actions.close(payload))}
        >
          Close
        </Button>
      </div>
    </form>
  );
}
