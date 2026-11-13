// The authorization card (C7, XC-18). The Backend's own text and the subject it is for. Approve and Decline answer the request (answer with the one option); "Grant for this subject only" is the
// one-step `aetheria.authorization.grant`, which records a grant without answering the request. The returned `originId` is shown as supplied and goes nowhere else: the Re-arm call that would
// use it is M07's and is not built, so that branch is a disabled, honestly labelled control. No Re-arm call is invented.
import { Button } from "../../components/ui/button";
import type { ActionReport } from "./actions";
import type { CardRunner } from "./InteractionCard";
import { RawText, mutedClass } from "./parts";
import type { InteractionRecord } from "./types";

type AuthorizationRecord = Extract<InteractionRecord, { kind: "authorization" }>;

const REARM_WAITING_TEXT = "Waiting for a Re-arm call that is not built yet (M07)";

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

export function OriginAndRearm({ originId }: { readonly originId: string }) {
  return (
    <div data-origin className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p className="text-sm">
        Origin: <code className="break-all text-xs">{originId}</code>
      </p>
      <p className={mutedClass}>
        Shown as the Backend supplied it. It is not sent anywhere from this page.
      </p>
      <Button data-rearm variant="ghost-muted" disabled>
        Re-arm
      </Button>
      <p className={mutedClass}>{REARM_WAITING_TEXT}</p>
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
      {origin === null ? null : <OriginAndRearm originId={origin} />}
    </div>
  );
}
