// One interaction record as a card (C7): its state as supplied, then a form while it is open or a read-only copy once settled. The card owns only the last action's report and a busy flag;
// the record comes from the view. A form is keyed by the record's revision, so a new revision starts a fresh form and the old draft becomes "from an earlier version".
import { useId, useRef, useState } from "react";

import type { ActionReport, ControlActions } from "./actions";
import { AuthorizationCard, OriginAndRearm } from "./AuthorizationCard";
import type { DraftStore } from "./drafts";
import { Heading, RawText, RecordStatus, ReportView, cardClass, mutedClass } from "./parts";
import { PlanReviewCard } from "./PlanReviewCard";
import { QuestionCard } from "./QuestionCard";
import { isOpen } from "./recordText";
import type { InteractionRecord } from "./types";

/** What a form needs to act: intents out, the last report, and whether one is in flight. */
export interface CardRunner {
  readonly busy: boolean;
  readonly report: ActionReport<unknown> | null;
  /** True once the person tried to send an answer that is not valid yet: problems show only then. */
  readonly attempted: boolean;
  readonly markAttempted: () => void;
  readonly run: (
    label: string,
    send: (actions: ControlActions) => Promise<ActionReport<unknown>>,
    onConfirmed?: () => void,
  ) => Promise<void>;
}

export interface InteractionCardProps {
  readonly record: InteractionRecord;
  readonly actions: ControlActions;
  readonly drafts: DraftStore;
}

const KIND_LABEL = {
  question: "Question",
  "plan-review": "Plan review",
  authorization: "Authorization request",
} as const;

function SettledContent({ record }: { readonly record: InteractionRecord }) {
  if (record.kind === "question") {
    return (
      <ul className="flex flex-col gap-1 text-sm">
        {record.content.questions.map((question) => (
          <li key={question.id} className="break-words">
            {question.question}
          </li>
        ))}
      </ul>
    );
  }
  if (record.kind === "plan-review")
    return <RawText text={record.content.plan} label="The plan, exactly as submitted" />;
  return (
    <>
      <RawText text={record.content.text} label="What was asked" />
      {record.resolution?.type === "answers" ? (
        <OriginAndRearm originId={record.resolution.originId} />
      ) : null}
    </>
  );
}

export function InteractionCard({ record, actions, drafts }: InteractionCardProps) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const [report, setReport] = useState<ActionReport<unknown> | null>(null);
  const [reportLabel, setReportLabel] = useState("Action");
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const runner: CardRunner = {
    busy,
    report,
    attempted,
    markAttempted: () => setAttempted(true),
    run: async (label, send, onConfirmed) => {
      setBusy(true);
      // `.finally` rather than try/finally: React Compiler cannot compile a `try` without a `catch`.
      await send(actions)
        .then((result) => {
          // A reply to an older action never replaces what a newer one said.
          if (result.sent && result.current) {
            setReport(result);
            setReportLabel(label);
          }
          if (result.sent && result.outcome.kind === "confirmed") onConfirmed?.();
        })
        .finally(() => {
          setBusy(false);
          // The button that was pressed is disabled while the action runs; focus returns to the card, where the result is said.
          sectionRef.current?.focus();
        });
    },
  };

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby={headingId}
      data-interaction={record.interactionId}
      aria-busy={busy}
      data-kind={record.kind}
      data-state={record.state}
      className={`${cardClass} outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
    >
      <div className="flex flex-col gap-0.5">
        <Heading id={headingId}>{KIND_LABEL[record.kind]}</Heading>
        <p className={`${mutedClass} break-all`}>{record.interactionId}</p>
      </div>
      <RecordStatus record={record} />
      {isOpen(record) ? (
        record.kind === "question" ? (
          <QuestionCard key={record.revision} record={record} drafts={drafts} runner={runner} />
        ) : record.kind === "plan-review" ? (
          <PlanReviewCard key={record.revision} record={record} drafts={drafts} runner={runner} />
        ) : (
          <AuthorizationCard key={record.revision} record={record} runner={runner} />
        )
      ) : (
        <SettledContent record={record} />
      )}
      <ReportView label={reportLabel} report={report} />
    </section>
  );
}
