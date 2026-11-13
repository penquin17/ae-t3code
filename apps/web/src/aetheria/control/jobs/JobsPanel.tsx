// What a root's jobs are doing, what they printed, a Kill for each, and the read-only outbox of completion notices (M10 Plan step 18, D14, D20, XC-15/16). Everything shown is derived from the
// Backend's last answer: an unreadable list is "not known", a time or exit that was not supplied is said not to be supplied, output is read by explicit byte offset and never called complete, a
// refusal shows the Backend's own words, and nothing is edited before the Backend answers. The control page mounts this with the root's ids; the transport comes from `JobsTransportContext`.
import { useEffect, useId, useState } from "react";

import { Button } from "../../../components/ui/button";
import { REGION } from "../../regions/declarations";
import { useRegion } from "../../regions/useRegion";
import { RefusalNotice } from "../../refusals/RefusalNotice";
import {
  incompleteText,
  jobRowView,
  killNotice,
  outboxRowView,
  OUTBOX_READ_ONLY_NOTE,
  streamStatus,
  type JobRowValue,
  type JobRowView,
  type JobState,
  type Listed,
  type OutboxRowValue,
  type StreamView,
} from "./model";
import { touchWithin } from "../touchTarget";
import type { ReadView } from "./reply";
import { useJobsTransport } from "./transport";
import { useJobOutput, useJobs, type OutputProblem } from "./useJobs";

export interface JobsPanelProps {
  /** The T3 environment and thread of the root session, as in the control route's params. */
  readonly environmentId: string;
  readonly threadId: string;
}

export function JobsPanel(props: JobsPanelProps) {
  const transport = useJobsTransport();
  const rootThreadId = props.threadId;
  const jobs = useJobs({ environmentId: props.environmentId, rootThreadId, transport });
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const headingId = useId();
  const outboxHeadingId = useId();
  const { view, refreshing } = jobs.list;
  const notice = jobs.notice;
  const noticeText = notice === null ? null : killNotice(notice.label, notice.outcome);
  useRegion(REGION.controlJobs, () => ({
    props: { threadId: rootThreadId },
    state: { list: view.tag, refreshing },
  }));

  const toggle = (jobId: string) => {
    const key = `${rootThreadId}\u0000${jobId}`;
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
  };

  return (
    <section
      aria-labelledby={headingId}
      data-aetheria="jobs"
      data-root={rootThreadId}
      className={`flex min-w-0 flex-col gap-3 ${touchWithin}`}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">
          Jobs
        </h2>
        <Button
          variant="outline"
          size="sm"
          aria-label="Refresh jobs"
          onClick={() => void jobs.list.refresh()}
        >
          Refresh
        </Button>
      </header>
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {refreshing && view.tag !== "reading" ? <p>Reading the jobs again…</p> : null}
        {noticeText !== null ? (
          <p
            data-testid="kill-notice"
            data-tone={noticeText.tone}
            className={noticeText.tone === "error" ? "text-destructive" : undefined}
          >
            {noticeText.text}
          </p>
        ) : null}
      </div>
      {notice !== null && notice.outcome.kind === "refused" ? (
        <RefusalNotice
          code={notice.outcome.code}
          backendMessage={notice.outcome.message}
          className="break-words"
        />
      ) : null}
      <JobsBody
        view={view}
        isKilling={jobs.isKilling}
        confirming={confirming}
        onAskKill={setConfirming}
        onKill={(row) => {
          setConfirming(null);
          jobs.kill(row);
        }}
        open={open}
        onToggle={toggle}
        environmentId={props.environmentId}
        rootThreadId={rootThreadId}
      />
      <section
        aria-labelledby={outboxHeadingId}
        data-aetheria="outbox"
        className="mt-2 flex min-w-0 flex-col gap-2 border-t pt-3"
      >
        <header className="flex items-center justify-between gap-2">
          <h3 id={outboxHeadingId} className="text-sm font-semibold">
            Completion notices
          </h3>
          <Button
            variant="outline"
            size="sm"
            aria-label="Refresh notices"
            onClick={() => void jobs.outbox.refresh()}
          >
            Refresh
          </Button>
        </header>
        <p
          data-testid="outbox-note"
          className="rounded-md border border-dashed p-2 text-xs text-muted-foreground"
        >
          {OUTBOX_READ_ONLY_NOTE}
        </p>
        <OutboxBody view={jobs.outbox.view} />
      </section>
    </section>
  );
}

function ReadProblem(props: {
  readonly view: Exclude<ReadView<unknown>, { readonly tag: "read" | "reading" }>;
  readonly what: string;
  readonly unknownText: string;
  readonly testId: string;
}) {
  const { view } = props;
  if (view.tag === "refused")
    return <RefusalNotice code={view.code} backendMessage={view.detail} />;
  return view.tag === "unavailable" ? (
    <p data-testid={`${props.testId}-unavailable`} className="break-words text-sm text-destructive">
      {props.what} unavailable: {view.reason}
    </p>
  ) : (
    <p
      data-testid={`${props.testId}-unknown`}
      className="break-words text-sm text-muted-foreground"
    >
      {props.unknownText}: {view.reason}
    </p>
  );
}

/** A list the Backend could not read all of says so, above whatever rows it did read (or none). */
function IncompleteNote(props: { readonly text: string | null; readonly testId: string }) {
  return props.text === null ? null : (
    <p data-testid={props.testId} className="break-words text-sm text-destructive">
      {props.text}
    </p>
  );
}

function JobsBody(props: {
  readonly view: ReadView<Listed<JobRowValue>>;
  readonly isKilling: (jobId: string) => boolean;
  readonly confirming: string | null;
  readonly onAskKill: (jobId: string | null) => void;
  readonly onKill: (row: JobRowView) => void;
  readonly open: ReadonlySet<string>;
  readonly onToggle: (jobId: string) => void;
  readonly environmentId: string;
  readonly rootThreadId: string;
}) {
  const { view } = props;
  if (view.tag === "reading") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Reading the jobs…
      </p>
    );
  }
  if (view.tag !== "read") {
    return (
      <ReadProblem
        view={view}
        what="Jobs are"
        unknownText="The jobs could not be read, so what they are doing is not known"
        testId="jobs"
      />
    );
  }
  const incomplete = (
    <IncompleteNote
      text={incompleteText("This list of jobs", view.value.unreadable)}
      testId="jobs-incomplete"
    />
  );
  if (view.value.rows.length === 0) {
    return (
      <>
        {incomplete}
        <p data-testid="jobs-empty" className="text-sm text-muted-foreground">
          The Backend lists no jobs for this session
          {view.value.unreadable === 0 ? "." : ", but not every record could be read."}
        </p>
      </>
    );
  }
  return (
    <>
      {incomplete}
      <JobsList {...props} rows={view.value.rows} />
    </>
  );
}

function JobsList(props: {
  readonly rows: readonly JobRowValue[];
  readonly isKilling: (jobId: string) => boolean;
  readonly confirming: string | null;
  readonly onAskKill: (jobId: string | null) => void;
  readonly onKill: (row: JobRowView) => void;
  readonly open: ReadonlySet<string>;
  readonly onToggle: (jobId: string) => void;
  readonly environmentId: string;
  readonly rootThreadId: string;
}) {
  return (
    <ul className="flex min-w-0 flex-col gap-2" aria-label="Jobs">
      {props.rows.map(jobRowView).map((row) => (
        <JobRow
          key={row.jobId}
          row={row}
          killing={props.isKilling(row.jobId)}
          confirming={props.confirming === row.jobId}
          onAskKill={() => props.onAskKill(row.jobId)}
          onCancelKill={() => props.onAskKill(null)}
          onKill={() => props.onKill(row)}
          expanded={props.open.has(`${props.rootThreadId}\u0000${row.jobId}`)}
          onToggle={() => props.onToggle(row.jobId)}
          environmentId={props.environmentId}
          rootThreadId={props.rootThreadId}
        />
      ))}
    </ul>
  );
}

function JobRow(props: {
  readonly row: JobRowView;
  readonly killing: boolean;
  readonly confirming: boolean;
  readonly onAskKill: () => void;
  readonly onCancelKill: () => void;
  readonly onKill: () => void;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly environmentId: string;
  readonly rootThreadId: string;
}) {
  const { row } = props;
  const base = useId();
  const regionId = `${base}-output`;
  return (
    <li
      data-job-id={row.jobId}
      data-state={row.state}
      className="min-w-0 rounded-lg border bg-card p-3 text-card-foreground"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-medium">{row.label}</span>
        <span data-testid="job-state" className="rounded-full border px-2 py-0.5 text-xs">
          {row.stateText}
        </span>
      </div>
      <p className="break-words text-sm text-muted-foreground">
        {row.ownerText} · {row.exitText}
      </p>
      <p className="break-words text-sm text-muted-foreground">
        {row.startedText} · {row.endedText}
      </p>
      <p className="break-words text-sm text-muted-foreground">{row.noticeText}</p>
      {row.flagTexts.map((flag) => (
        <p key={flag} className="break-words text-sm" data-testid="job-flag">
          {flag}
        </p>
      ))}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {row.canKill ? (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Kill ${row.label}`}
            aria-disabled={props.killing || props.confirming}
            onClick={() => {
              if (!props.killing) props.onAskKill();
            }}
          >
            {props.killing ? "Killing…" : "Kill"}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          aria-expanded={props.expanded}
          aria-controls={regionId}
          aria-label={`Output of ${row.label}`}
          onClick={props.onToggle}
        >
          Output
        </Button>
      </div>
      {props.confirming ? (
        <div
          role="group"
          aria-label={`Kill confirmation for ${row.label}`}
          className="mt-2 flex min-w-0 flex-col gap-2 rounded-md border border-dashed p-2 text-sm"
        >
          <p className="break-words">
            Kill {row.label}? This ends the job&apos;s process. It is sent once; if the reply is
            lost, the outcome is shown as unknown and is not sent again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive-outline"
              size="sm"
              aria-label={`Confirm kill of ${row.label}`}
              onClick={props.onKill}
            >
              Confirm kill
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Cancel kill of ${row.label}`}
              onClick={props.onCancelKill}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <div
        id={regionId}
        role="region"
        aria-label={`Output region of ${row.label}`}
        hidden={!props.expanded}
      >
        {props.expanded ? (
          <OutputBody
            key={`${props.rootThreadId}\u0000${row.jobId}`}
            row={row}
            environmentId={props.environmentId}
            rootThreadId={props.rootThreadId}
          />
        ) : null}
      </div>
    </li>
  );
}

function OutputBody(props: {
  readonly row: JobRowView;
  readonly environmentId: string;
  readonly rootThreadId: string;
}) {
  const transport = useJobsTransport();
  const { hold, read } = useJobOutput({
    environmentId: props.environmentId,
    rootThreadId: props.rootThreadId,
    jobId: props.row.jobId,
    transport,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the first output read starts when the region opens, once
  useEffect(() => {
    read();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `read` is rebuilt every render; the first read happens once per mount
  }, []);
  const { output, problem, reading } = hold;
  const hasRead = output.jobState !== null;
  const more = output.stdout.more || output.stderr.more;
  return (
    <div
      className="mt-2 flex min-w-0 flex-col gap-2 border-t pt-2 text-sm"
      data-output={hasRead ? "read" : "none"}
    >
      {reading && !hasRead ? <p role="status">Reading the output…</p> : null}
      {problem !== null ? <OutputProblemText problem={problem} /> : null}
      {hasRead ? (
        <>
          <p className="text-muted-foreground">
            The job&apos;s state at this read: {output.jobState}. Output is read from a byte offset,
            so what is shown is only what came back.
          </p>
          <StreamBlock name="stdout" stream={output.stdout} jobState={output.jobState} />
          <StreamBlock name="stderr" stream={output.stderr} jobState={output.jobState} />
          {output.notes.map((note) => (
            <p key={note} className="break-words" data-testid="output-note">
              {note}
            </p>
          ))}
        </>
      ) : null}
      {hasRead || problem !== null ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Read more output of ${props.row.label}`}
            aria-disabled={reading}
            onClick={() => {
              if (!reading) read();
            }}
          >
            {reading ? "Reading…" : hasRead ? (more ? "Read more" : "Read again") : "Try again"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function OutputProblemText(props: { readonly problem: OutputProblem }) {
  const { problem } = props;
  if (problem.tag === "refused") {
    return <RefusalNotice code={problem.code} backendMessage={problem.detail} />;
  }
  return problem.tag === "unavailable" ? (
    <p className="break-words text-destructive" data-testid="output-unavailable">
      The output is unavailable: {problem.reason}
    </p>
  ) : (
    <p className="break-words" data-testid="output-unknown">
      The output could not be read, so what the job printed is not known: {problem.reason}
    </p>
  );
}

function StreamBlock(props: {
  readonly name: "stdout" | "stderr";
  readonly stream: StreamView;
  readonly jobState: JobState | null;
}) {
  const { name, stream } = props;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h4 className="text-xs font-medium">{name}</h4>
      {stream.text === "" ? null : (
        <pre
          data-stream={name}
          className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 font-mono text-xs"
        >
          {stream.text}
        </pre>
      )}
      <p className="text-xs text-muted-foreground" data-testid={`${name}-status`}>
        {streamStatus(stream, props.jobState)}
      </p>
    </div>
  );
}

function OutboxBody(props: { readonly view: ReadView<Listed<OutboxRowValue>> }) {
  const { view } = props;
  if (view.tag === "reading") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Reading the notices…
      </p>
    );
  }
  if (view.tag !== "read") {
    return (
      <ReadProblem
        view={view}
        what="The outbox is"
        unknownText="The outbox could not be read, so its notices are not known"
        testId="outbox"
      />
    );
  }
  const incomplete = (
    <IncompleteNote
      text={incompleteText("This list of notices", view.value.unreadable)}
      testId="outbox-incomplete"
    />
  );
  if (view.value.rows.length === 0) {
    return (
      <>
        {incomplete}
        <p data-testid="outbox-empty" className="text-sm text-muted-foreground">
          The Backend lists no notices in the outbox
          {view.value.unreadable === 0 ? "." : ", but not every record could be read."}
        </p>
      </>
    );
  }
  return (
    <>
      {incomplete}
      <OutboxList rows={view.value.rows} />
    </>
  );
}

function OutboxList(props: { readonly rows: readonly OutboxRowValue[] }) {
  return (
    <ul className="flex min-w-0 flex-col gap-2" aria-label="Completion notices">
      {props.rows.map(outboxRowView).map((row) => (
        <li
          key={row.key}
          data-outbox-key={row.key}
          data-delivery={row.delivery}
          className="min-w-0 rounded-lg border bg-card p-3 text-sm text-card-foreground"
        >
          <p className="break-words font-medium">{row.deliveryText}</p>
          <p className="break-words text-muted-foreground">
            {row.kind} · {row.key}
          </p>
          <p className="break-words text-muted-foreground">
            {row.attemptsText}
            {row.nextText === null ? "" : ` · ${row.nextText}`}
          </p>
        </li>
      ))}
    </ul>
  );
}
