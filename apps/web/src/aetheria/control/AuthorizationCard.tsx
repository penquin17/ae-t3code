// The authorization card (C7, XC-18). The Backend's own text and the subject it is for. Approve and Decline answer the request (answer with the one option); "Grant for this subject only" is the
// one-step `aetheria.authorization.grant`, which records a grant without answering the request. The returned `originId` is shown as supplied and goes nowhere else. Re-arm (M07 Plan step 18) is enabled
// only when this request's subject is the one the goal's current snapshot offers; the click then runs the goal card's own one-click Re-arm, never this origin.
import { Button } from "../../components/ui/button";
import type { ActionReport } from "./actions";
import { useGoalsHandle } from "./goals/GoalsProvider";
import { RearmButton, RearmStatus } from "./goals/RearmButton";
import type { GoalView } from "./goals/reply";
import type { GoalsHandle } from "./goals/useGoals";
import type { CardRunner } from "./InteractionCard";
import { RawText, mutedClass } from "./parts";
import type { InteractionRecord, InteractionSubject } from "./types";

type AuthorizationRecord = Extract<InteractionRecord, { kind: "authorization" }>;

const REARM_NO_GOAL_TEXT = "Re-arm is not available here: no goal is connected to this card.";
const REARM_NOT_LIVE_TEXT =
  "Re-arm is not offered while the goal is being read or may be out of date.";
const REARM_NO_OFFER_TEXT = "Re-arm is not offered: the goal's current view has no Re-arm request.";
const REARM_OTHER_SUBJECT_TEXT =
  "Re-arm is offered only for the goal's own Re-arm request, and this request is for another subject.";

export interface AuthorizationCardProps {
  readonly record: AuthorizationRecord;
  readonly runner: CardRunner;
}

/** The origin the Backend supplied for this request: the resolution's, else a one-step grant's, as returned. */
function originOf(
  record: AuthorizationRecord,
  report: ActionReport<unknown> | null,
): string | null {
  if (record.resolution?.type === "answers") return record.resolution.originId;
  if (report !== null && report.sent && report.outcome.kind === "confirmed") {
    const value = report.outcome.value as { originId?: unknown } | null;
    if (value !== null && typeof value === "object" && typeof value.originId === "string")
      return value.originId;
  }
  return null;
}

/** Why Re-arm is not offered on this card, in words; null when it is offered. */
function rearmHeldText(
  handle: GoalsHandle | null,
  goal: GoalView | null,
  subject: InteractionSubject,
): string | null {
  if (handle === null) return REARM_NO_GOAL_TEXT;
  if (handle.view.status !== "live") return REARM_NOT_LIVE_TEXT;
  const offer = goal?.rearm;
  if (offer === undefined) return REARM_NO_OFFER_TEXT;
  return offer.subject.type === subject.type &&
    offer.subject.id === subject.id &&
    offer.subject.revision === subject.revision
    ? null
    : REARM_OTHER_SUBJECT_TEXT;
}

/**
 * The origin the Backend supplied, shown as supplied, and the Re-arm. Re-arm is enabled only when this request is the one the goal's current snapshot offers (same subject type, id and revision): then the click
 * is the same one-click Re-arm as the goal card, which makes its own fresh grant and never reuses the origin shown here.
 */
export function OriginAndRearm({
  originId,
  subject,
}: {
  readonly originId: string;
  readonly subject: InteractionSubject;
}) {
  const handle = useGoalsHandle();
  const goal = handle !== null && handle.view.status === "live" ? handle.view.goal : null;
  const held = rearmHeldText(handle, goal, subject);
  return (
    <div data-origin className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p className="text-sm">
        Origin: <code className="break-all text-xs">{originId}</code>
      </p>
      <p className={mutedClass}>
        Shown as the Backend supplied it. It is not sent anywhere from this page.
      </p>
      {held === null && handle !== null && goal !== null ? (
        <>
          <RearmButton goal={goal} handle={handle} />
          <RearmStatus handle={handle} />
        </>
      ) : (
        <>
          <Button data-rearm="held" variant="ghost-muted" disabled>
            Re-arm
          </Button>
          <p className={mutedClass}>{held}</p>
        </>
      )}
    </div>
  );
}

export function AuthorizationCard({ record, runner }: AuthorizationCardProps) {
  const payload = { interactionId: record.interactionId, revision: record.revision };
  const { subject } = record.content;
  const origin = originOf(record, runner.report);
  return (
    <div data-form="authorization" className="flex min-w-0 flex-col gap-3">
      <RawText text={record.content.text} label="What is asked" />
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className={mutedClass}>Subject type</dt>
        <dd className="break-all">{subject.type}</dd>
        <dt className={mutedClass}>Subject id</dt>
        <dd className="break-all">{subject.id}</dd>
        <dt className={mutedClass}>Subject revision</dt>
        <dd className="break-all">{subject.revision}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={runner.busy}
          onClick={() =>
            void runner.run("Approval", (a) =>
              a.answer({
                ...payload,
                answers: [{ id: "authorization", selected: ["Approve"], skipped: false }],
              }),
            )
          }
        >
          Approve
        </Button>
        <Button
          variant="outline"
          disabled={runner.busy}
          onClick={() =>
            void runner.run("Decline", (a) =>
              a.answer({
                ...payload,
                answers: [{ id: "authorization", selected: ["Decline"], skipped: false }],
              }),
            )
          }
        >
          Decline
        </Button>
        <Button
          variant="outline"
          disabled={runner.busy}
          onClick={() => void runner.run("Cancel", (a) => a.cancel(payload))}
        >
          Cancel request
        </Button>
        <Button
          variant="outline"
          disabled={runner.busy}
          onClick={() => void runner.run("Close", (a) => a.close(payload))}
        >
          Close
        </Button>
        <Button
          variant="outline"
          disabled={runner.busy}
          onClick={() =>
            void runner.run("Grant", (a) => a.grant({ subject, sessionId: record.sessionId }))
          }
        >
          Grant for this subject only
        </Button>
      </div>
      <p className={mutedClass}>
        A one-step grant records the grant for this subject; it does not answer the request above.
      </p>
      {origin === null ? null : <OriginAndRearm originId={origin} subject={subject} />}
    </div>
  );
}
