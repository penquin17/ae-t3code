// The plan-review card (C7): the exact plan text the Backend holds, its review number and revision, and the decisions approve / request changes (with feedback) / cancel / hold / close.
// The plan is shown as text and never rendered as Markdown. The decision carries the revision the person saw; a changed plan makes it a conflict, not a silent approval of new text.
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import type { DraftStore } from "./drafts";
import type { CardRunner } from "./InteractionCard";
import { EarlierDraft, RawText, mutedClass, useStoredDraft } from "./parts";
import type { InteractionRecord } from "./types";

type PlanRecord = Extract<InteractionRecord, { kind: "plan-review" }>;

export interface PlanReviewCardProps {
  readonly record: PlanRecord;
  readonly drafts: DraftStore;
  readonly runner: CardRunner;
}

export function PlanReviewCard({ record, drafts, runner }: PlanReviewCardProps) {
  const key = {
    sessionId: record.sessionId,
    interactionId: record.interactionId,
    revision: record.revision,
  };
  const feedback = useStoredDraft<string>(drafts, key, {
    empty: "",
    parse: (text) => text,
    serialize: (value) => value,
  });
  const payload = { interactionId: record.interactionId, revision: record.revision };
  const withFeedback = feedback.value.trim() === "" ? {} : { feedback: feedback.value };
  return (
    <div data-form="plan-review" className="flex min-w-0 flex-col gap-3">
      <p className={mutedClass}>
        Review {record.content.reviewNumber} · revision {record.revision.slice(0, 8)}
      </p>
      <RawText text={record.content.plan} label="The plan, exactly as submitted" />
      {feedback.earlier === null ? null : (
        <EarlierDraft text={feedback.earlier.text} revision={feedback.earlier.revision} />
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className={mutedClass}>Feedback (optional)</span>
        <Textarea
          aria-label="Feedback on the plan"
          value={feedback.value}
          disabled={runner.busy}
          onChange={(event) => feedback.set(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={runner.busy}
          onClick={() =>
            void runner.run(
              "Approval",
              (a) => a.planDecide({ ...payload, decision: "approved", ...withFeedback }),
              feedback.clear,
            )
          }
        >
          Approve plan
        </Button>
        <Button
          variant="outline"
          disabled={runner.busy}
          onClick={() =>
            void runner.run(
              "Change request",
              (a) => a.planDecide({ ...payload, decision: "changes_requested", ...withFeedback }),
              feedback.clear,
            )
          }
        >
          Request changes
        </Button>
        <Button
          variant="outline"
          disabled={runner.busy}
          onClick={() =>
            void runner.run(
              "Cancel",
              (a) => a.cancel({ ...payload, ...withFeedback }),
              feedback.clear,
            )
          }
        >
          Cancel review
        </Button>
        <Button
          variant="outline"
          disabled={runner.busy || record.held}
          onClick={() => void runner.run("Hold", (a) => a.hold(payload))}
        >
          {record.held ? "Held" : "Hold for later"}
        </Button>
        <Button
          variant="outline"
          disabled={runner.busy}
          onClick={() => void runner.run("Close", (a) => a.close(payload))}
        >
          Close
        </Button>
      </div>
    </div>
  );
}
