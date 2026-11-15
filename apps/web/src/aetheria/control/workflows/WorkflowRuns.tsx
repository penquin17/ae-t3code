// The workflow runs of this root and a one-click Cancel for each running run (M07 Plan step 29, M10 run controls). It shows the last read and nothing else: no script, argument or child output (the contract carries
// none), and it never says a run ended unless its state says so. "Cancel requested" is a running run whose cancel was asked for, told apart from "cancelled". The Cancel button is the person's own click, with
// no confirmation step: it is sent once, stays focusable while busy (aria-disabled, never a dropped click that sends twice), and when the run changes under it and the button goes away, focus returns to this
// group, where the result is said. It sits inside the goal card, where the static "not shown yet" statement was.
import { useId, useRef } from "react";

import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { RefusalNotice } from "../../refusals/RefusalNotice";
import { mutedClass } from "../parts";
import type { WorkflowRunView } from "./reply";
import { cancelOffered } from "./state";
import { cancelNotice, runFacts, type RunHeadline } from "./text";
import { useWorkflowsHandle } from "./WorkflowsProvider";
import type { WorkflowsHandle } from "./useWorkflows";

const HEADLINE_LABEL: Readonly<Record<RunHeadline, string>> = {
  "cancel-requested": "Cancel requested",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  lost: "Lost",
};

function RunRow({
  run,
  handle,
  home,
}: {
  readonly run: WorkflowRunView;
  readonly handle: WorkflowsHandle;
  readonly home: () => HTMLElement | null;
}) {
  const facts = runFacts(run);
  const { view, cancel } = handle;
  const busy = cancel.busy.has(run.runId);
  const report = cancel.reports[run.runId];
  const notice = cancelNotice(report);
  const refused =
    report !== undefined && report.sent && report.outcome.kind === "refused"
      ? report.outcome
      : null;
  return (
    <li
      data-run-id={run.runId}
      data-run-state={facts.headline}
      aria-busy={busy}
      className="flex min-w-0 flex-col gap-2 rounded-lg border p-3"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-medium">{run.name}</span>
        <span data-run-chip className="rounded-full border px-2 py-0.5 text-xs">
          {HEADLINE_LABEL[facts.headline]}
        </span>
      </div>
      <p className="text-sm">{facts.headlineText}</p>
      {facts.lines.map((line) => (
        <p key={line} className={`${mutedClass} break-words`}>
          {line}
        </p>
      ))}
      {cancelOffered(view, run) || busy ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive-outline"
            size="sm"
            data-cancel="ready"
            aria-label={`Cancel ${run.name}`}
            aria-disabled={busy}
            aria-busy={busy}
            onClick={(event) => {
              if (busy) return;
              const button = event.currentTarget;
              // The run usually changes under the button (Cancel goes away once the Backend shows the cancel asked for), which drops focus; after the page has drawn the result, focus goes to the group that says it.
              void cancel.start(run.runId).then(() =>
                requestAnimationFrame(() => {
                  if (!button.isConnected || document.activeElement === document.body)
                    home()?.focus();
                }),
              );
            }}
          >
            {busy ? "Cancelling…" : "Cancel"}
          </Button>
        </div>
      ) : null}
      {busy ? (
        <p role="status" className={mutedClass}>
          Cancelling… the cancel is sent once and never repeated.
        </p>
      ) : null}
      {!busy && notice !== null ? (
        <div aria-live="polite" data-cancel-status={report?.sent ? report.outcome.kind : ""}>
          <Alert
            variant={
              notice.tone === "ok" ? "success" : notice.tone === "warning" ? "warning" : "error"
            }
            role="status"
          >
            <AlertDescription>
              <span className="text-foreground">{notice.text}</span>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      {!busy && refused !== null ? (
        <RefusalNotice
          code={refused.code}
          backendMessage={refused.message === "" ? undefined : refused.message}
        />
      ) : null}
    </li>
  );
}

function RunsBody({ handle }: { readonly handle: WorkflowsHandle }) {
  const headingId = useId();
  const homeRef = useRef<HTMLDivElement>(null);
  const { view, cancel } = handle;
  const listed = view.status === "live" || view.status === "stale" ? view : null;
  const anyRunning =
    listed !== null &&
    listed.runs.some((run) => run.state === "running" && run.cancelRequested !== true);
  return (
    <div
      ref={homeRef}
      tabIndex={-1}
      role="group"
      aria-labelledby={headingId}
      aria-busy={cancel.busy.size > 0}
      data-workflow-runs
      data-workflow-view={view.status}
      className="flex min-w-0 flex-col gap-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <h3 id={headingId} className="text-sm font-medium text-foreground">
        Workflow runs
      </h3>
      {view.status === "waiting" ? (
        <p role="status" className={mutedClass}>
          Reading the workflow runs… ({view.reason})
        </p>
      ) : null}
      {view.status === "unavailable" ? (
        <Alert variant="error" role="alert" data-workflow-problem={view.kind}>
          <AlertDescription>
            <span className="text-foreground">
              {view.kind === "unknown"
                ? `The workflow runs could not be read, so they are not known: ${view.reason}`
                : `The workflow runs are unavailable: ${view.reason}`}
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {view.status === "refused" ? (
        <RefusalNotice code={view.code} backendMessage={view.reason} />
      ) : null}
      {view.status === "stale" ? (
        <Alert variant="warning" role="status" data-workflow-stale>
          <AlertDescription>
            <span className="text-foreground">
              This may be out of date: {view.reason}. It shows what was last read (version{" "}
              {view.version}) and is being read again.
              {anyRunning ? " Cancel is not offered until the runs are read again." : ""}
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {listed !== null && listed.unreadable > 0 ? (
        <Alert variant="warning" role="status" data-workflow-unreadable={listed.unreadable}>
          <AlertDescription>
            <span className="text-foreground">
              {listed.unreadable} run {listed.unreadable === 1 ? "record" : "records"} could not be
              read. {listed.unreadable === 1 ? "It" : "They"} may belong to this session, so this
              list may not be complete.
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {listed !== null && listed.runs.length === 0 && listed.unreadable === 0 ? (
        <p className="text-sm" data-workflow-empty>
          The Backend lists no workflow runs for this session.
        </p>
      ) : null}
      {listed === null || listed.runs.length === 0 ? null : (
        <ul className="flex min-w-0 flex-col gap-2" aria-labelledby={headingId}>
          {listed.runs.map((run) => (
            <RunRow key={run.runId} run={run} handle={handle} home={() => homeRef.current} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The runs for the mounted workflow view; without one (no identity known, or a card shown alone) it says so and reads nothing. */
export function WorkflowRuns() {
  const handle = useWorkflowsHandle();
  return handle === null ? (
    <p role="status" className={mutedClass} data-workflow-runs-none>
      Workflow runs cannot be read here: this page has no Backend session for them.
    </p>
  ) : (
    <RunsBody handle={handle} />
  );
}
