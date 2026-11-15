// The goal card (M07 Plan step 18, D24, C8, XC-23): the Backend's goal for this root as the last read shows it, with the person's one-click Re-arm. It holds no copy of backend state beyond the last read, which it
// marks stale when the connection ends; nothing here arms a goal except the Re-arm the Backend accepted and a read-back showed. It replaces M10's static "not built yet" statement.
import { useId, useRef } from "react";

import { Alert, AlertDescription } from "../../../components/ui/alert";
import { REGION } from "../../regions/declarations";
import { RefusalNotice } from "../../refusals/RefusalNotice";
import { useRegion } from "../../regions/useRegion";
import { Heading, RawText, cardClass, mutedClass } from "../parts";
import { useGoalsHandle } from "./GoalsProvider";
import { RearmButton, RearmStatus } from "./RearmButton";
import type { GoalView } from "./reply";
import type { GoalsHandle } from "./useGoals";
import { goalFacts } from "./text";

const HOME_CLASS = `${cardClass} outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`;

function GoalBody({
  goal,
  handle,
  offerRearm,
}: {
  readonly goal: GoalView;
  readonly handle: GoalsHandle;
  /** Only a live read offers Re-arm; a stale one shows the goal and says why it does not. */
  readonly offerRearm: boolean;
}) {
  const facts = goalFacts(goal);
  const { rearm } = goal;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <RawText text={goal.objective} label="Objective" />
      <div
        data-goal-headline={facts.headline}
        data-goal-phase={goal.phase}
        data-goal-armed={String(goal.armed)}
        data-goal-needs-rearm={String(goal.needsRearm)}
        className="flex flex-col gap-0.5"
      >
        <p className="text-sm font-medium">{facts.headlineText}</p>
        {facts.lines.map((line) => (
          <p key={line} className={`${mutedClass} break-words`}>
            {line}
          </p>
        ))}
      </div>
      {rearm === undefined ? null : (
        <div data-rearm-offer className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Re-arm this goal</p>
          <RawText text={rearm.text} label="What your Re-arm authorizes" />
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            <dt className={mutedClass}>Subject type</dt>
            <dd className="break-all">{rearm.subject.type}</dd>
            <dt className={mutedClass}>Subject id</dt>
            <dd className="break-all">{rearm.subject.id}</dd>
            <dt className={mutedClass}>Subject revision</dt>
            <dd className="break-all">{rearm.subject.revision}</dd>
          </dl>
          {offerRearm ? (
            <div className="flex flex-wrap gap-2">
              <RearmButton goal={goal} handle={handle} />
            </div>
          ) : (
            <p className={mutedClass} data-rearm-held>
              This may be out of date, so Re-arm is not offered until the goal is read again.
            </p>
          )}
          <p className={mutedClass}>
            Your click records one grant for exactly this subject and passes it once to the Backend.
            The goal is armed only if the Backend accepts it and a read shows it.
          </p>
        </div>
      )}
    </div>
  );
}

function GoalsCardBody({ handle }: { readonly handle: GoalsHandle }) {
  const headingId = useId();
  const homeRef = useRef<HTMLElement>(null);
  const { view, rearm } = handle;
  useRegion(REGION.controlGoals, () => ({}));
  const goal = view.status === "live" || view.status === "stale" ? view.goal : null;
  return (
    <section
      ref={homeRef}
      tabIndex={-1}
      aria-labelledby={headingId}
      aria-busy={rearm.busy}
      data-aetheria="goals"
      data-goal-view={view.status}
      className={HOME_CLASS}
    >
      <Heading id={headingId}>Goal</Heading>
      {view.status === "waiting" ? (
        <p role="status" className={mutedClass}>
          Reading the goal… ({view.reason})
        </p>
      ) : null}
      {view.status === "unavailable" ? (
        <Alert variant="error" role="alert" data-goal-problem={view.kind}>
          <AlertDescription>
            <span className="text-foreground">
              {view.kind === "unknown"
                ? `The goal could not be read, so it is not known: ${view.reason}`
                : `The goal is unavailable: ${view.reason}`}
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {view.status === "refused" ? (
        <RefusalNotice code={view.code} backendMessage={view.reason} />
      ) : null}
      {view.status === "stale" ? (
        <Alert variant="warning" role="status">
          <AlertDescription>
            <span className="text-foreground">
              This may be out of date: {view.reason}. It shows what was last read (version{" "}
              {view.version}) and is being read again.
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {(view.status === "live" || view.status === "stale") && goal === null ? (
        <p className="text-sm" data-goal-empty>
          The Backend holds no goal for this session.
        </p>
      ) : null}
      {goal === null ? null : (
        <GoalBody goal={goal} handle={handle} offerRearm={view.status === "live"} />
      )}
      <RearmStatus handle={handle} />
      <p className={mutedClass}>Workflow runs are not shown on this page yet.</p>
    </section>
  );
}

/** The card for the mounted goal view; without one (no identity known, or a card shown alone) it says so and reads nothing. */
export function GoalsCard() {
  const handle = useGoalsHandle();
  return handle === null ? <GoalsUnknown /> : <GoalsCardBody handle={handle} />;
}

function GoalsUnknown() {
  const headingId = useId();
  useRegion(REGION.controlGoals, () => ({}));
  return (
    <section
      aria-labelledby={headingId}
      data-aetheria="goals"
      data-goal-view="no-session"
      className={cardClass}
    >
      <Heading id={headingId}>Goal</Heading>
      <p role="status" className="text-sm">
        The goal cannot be read here: this page has no Backend session for it.
      </p>
    </section>
  );
}
