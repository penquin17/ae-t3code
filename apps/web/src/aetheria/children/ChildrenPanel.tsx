// What a root's children are doing, the reports they left, and a Stop for each (M10 Plan step 10, D2, C7). Everything shown is derived from the Backend's last answer: an unreadable state is
// "Unknown", an unreadable report says so, a refusal shows the Backend's own words, and nothing is edited before the Backend answers. The control page mounts this with the root's ids.
import { EnvironmentId } from "@t3tools/contracts";
import { use, useId, useState } from "react";

import { Button } from "../../components/ui/button";
import { RefusalNotice } from "../refusals/RefusalNotice";
import { ChildrenCallsContext, useT3ChildrenCalls, type ChildrenCalls } from "./calls";
import { childStopNotice, rowViews, unattachedDiagnostics, type ChildRowView } from "./model";
import { structuredText, useReportsTransport, type ReportView } from "./reports";
import { useChildren, useReports } from "./useChildren";

export interface ChildrenPanelProps {
  /** The T3 environment and thread of the root session, as in the control route's params. */
  readonly environmentId: string;
  readonly threadId: string;
}

/** M05's own statement of a limit, shown as reported. The `UserReportValue` the Backend returns carries no such notice, so this view cannot check or add to it. */
const ROLLBACK_LIMIT =
  "Reported by M05: the rollback “child stopped” notice is an accepted limit. This is M05's own statement of its limit; this view shows it as reported, cannot check it, and adds nothing to it.";

export function ChildrenPanel(props: ChildrenPanelProps) {
  const injected = use(ChildrenCallsContext);
  return injected === null ? <T3Children {...props} /> : <Children {...props} calls={injected} />;
}

function T3Children(props: ChildrenPanelProps) {
  return <Children {...props} calls={useT3ChildrenCalls()} />;
}

function Children(props: ChildrenPanelProps & { readonly calls: ChildrenCalls }) {
  const rootThreadId = props.threadId;
  const children = useChildren({
    environmentId: EnvironmentId.make(props.environmentId),
    rootThreadId,
    calls: props.calls,
  });
  const reports = useReports(rootThreadId, useReportsTransport());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const headingId = useId();
  const { view, refreshing } = children.list;
  const notice = children.notice;
  const noticeText = notice === null ? null : childStopNotice(notice.name, notice.outcome);

  const toggle = (childId: string) => {
    const key = `${rootThreadId}\u0000${childId}`;
    const next = new Set(open);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      if (reports.viewOf(childId) === undefined) reports.read(childId);
    }
    setOpen(next);
  };

  return (
    <section
      aria-labelledby={headingId}
      data-aetheria="children"
      data-root={rootThreadId}
      className="flex min-w-0 flex-col gap-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">
          Children
        </h2>
        <Button variant="outline" size="sm" onClick={children.refresh}>
          Refresh
        </Button>
      </header>
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {refreshing && view.tag !== "reading" ? <p>Reading the children again…</p> : null}
        {notice !== null && notice.outcome.kind !== "refused" && noticeText !== null ? (
          <p
            data-testid="stop-notice"
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
      {view.tag === "reading" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Reading the children…
        </p>
      ) : null}
      {view.tag === "refused" ? (
        <RefusalNotice code={view.code} backendMessage={view.detail} />
      ) : null}
      {view.tag === "unavailable" ? (
        <p data-testid="children-unavailable" className="break-words text-sm text-destructive">
          The children are unavailable: {view.reason}
        </p>
      ) : null}
      {view.tag === "unknown" ? (
        <p data-testid="children-unknown" className="break-words text-sm text-muted-foreground">
          The children could not be read, so what they are doing is not known: {view.reason}
        </p>
      ) : null}
      {view.tag === "read" && view.list.rows.length === 0 ? (
        <p data-testid="children-empty" className="text-sm text-muted-foreground">
          The Backend lists no open children for this session.
        </p>
      ) : null}
      {view.tag === "read" && view.list.rows.length > 0 ? (
        <ul className="flex min-w-0 flex-col gap-2" aria-label="Children">
          {rowViews(view.list).map((row) => (
            <ChildRow
              key={row.childId}
              row={row}
              stopping={children.isStopping(row.childId)}
              onStop={() => children.stop(row)}
              expanded={open.has(`${rootThreadId}\u0000${row.childId}`)}
              onToggle={() => toggle(row.childId)}
              report={reports.viewOf(row.childId)}
              onRead={() => reports.read(row.childId)}
            />
          ))}
        </ul>
      ) : null}
      {view.tag === "read" && unattachedDiagnostics(view.list).length > 0 ? (
        <div data-testid="children-diagnostics" className="flex flex-col gap-1 text-sm">
          <p className="font-medium">The Backend could not read these records</p>
          <ul className="flex flex-col gap-1">
            {unattachedDiagnostics(view.list).map((diagnostic) => (
              <li key={`${diagnostic.kind}:${diagnostic.id}`} className="break-words">
                {diagnostic.kind}: {diagnostic.id}
                {diagnostic.detail === undefined ? null : ` (${diagnostic.detail})`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p
        data-testid="rollback-limit"
        className="rounded-md border border-dashed p-2 text-xs text-muted-foreground"
      >
        {ROLLBACK_LIMIT}
      </p>
    </section>
  );
}

function ChildRow(props: {
  readonly row: ChildRowView;
  readonly stopping: boolean;
  readonly onStop: () => void;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly report: ReportView | undefined;
  readonly onRead: () => void;
}) {
  const { row, report } = props;
  const base = useId();
  const stopHelp = `${base}-stop`;
  const regionId = `${base}-report`;
  const closed = row.state === "closed";
  return (
    <li
      data-child-id={row.childId}
      data-state={row.state}
      data-mode={row.mode}
      className="min-w-0 rounded-lg border bg-card p-3 text-card-foreground"
      style={{ marginInlineStart: `${Math.min(row.depth, 4) * 0.75}rem` }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-medium">{row.name}</span>
        <span className="rounded-full border px-2 py-0.5 text-xs">{row.modeText}</span>
        <span
          data-testid="child-state"
          className={`rounded-full border px-2 py-0.5 text-xs ${row.stateKnown ? "" : "border-dashed"}`}
        >
          {row.stateText}
        </span>
      </div>
      <p className="break-words text-sm text-muted-foreground">
        {row.label === undefined ? null : <span>{row.childId} · </span>}
        {row.role === null ? "No role recorded" : row.role}
        {row.route === null ? "" : ` · route ${row.route}`}
      </p>
      <p className="break-words text-sm text-muted-foreground">{row.lastOutcomeText}</p>
      {row.stateKnown ? null : (
        <p className="break-words text-sm">
          The Backend could not read this child&apos;s state, so it is not known whether it is
          running, idle or closed.
        </p>
      )}
      {row.diagnostics.map((diagnostic) => (
        <p key={diagnostic.kind} className="break-words text-sm" data-testid="child-diagnostic">
          {diagnostic.kind}
          {diagnostic.detail === undefined ? "" : `: ${diagnostic.detail}`}
        </p>
      ))}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={`Stop ${row.name}`}
          aria-describedby={stopHelp}
          aria-disabled={closed || props.stopping}
          onClick={props.onStop}
        >
          {props.stopping ? "Stopping…" : "Stop"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={props.expanded}
          aria-controls={regionId}
          aria-label={`Report of ${row.name}`}
          onClick={props.onToggle}
        >
          Report
        </Button>
        <span id={stopHelp} className="text-xs text-muted-foreground">
          {closed
            ? "Already closed."
            : row.mode === "one-shot"
              ? "Stop closes this child."
              : "Stop ends its current turn; the child stays open."}
        </span>
      </div>
      <div
        id={regionId}
        role="region"
        aria-label={`Stored report of ${row.name}`}
        hidden={!props.expanded}
      >
        {props.expanded ? <ReportBody view={report} onRead={props.onRead} /> : null}
      </div>
    </li>
  );
}

function ReportBody(props: { readonly view: ReportView | undefined; readonly onRead: () => void }) {
  const view = props.view ?? ({ tag: "reading" } as const);
  return (
    <div className="mt-2 flex min-w-0 flex-col gap-2 border-t pt-2 text-sm" data-report={view.tag}>
      <ReportContent view={view} />
      {view.tag === "reading" ? null : (
        <div>
          <Button variant="ghost" size="sm" onClick={props.onRead}>
            Read again
          </Button>
        </div>
      )}
    </div>
  );
}

function ReportContent({ view }: { readonly view: ReportView }) {
  switch (view.tag) {
    case "reading":
      return <p role="status">Reading the report…</p>;
    case "reported":
      return (
        <>
          <p>
            Status: {view.report.status}
            {view.report.cause === undefined ? "" : ` (${view.report.cause})`} · route{" "}
            {view.report.route}
          </p>
          <pre
            data-verbatim="report-text"
            className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 font-mono text-xs"
          >
            {view.report.text}
          </pre>
          {view.report.structured === undefined ? null : (
            <pre
              data-verbatim="report-structured"
              className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 font-mono text-xs"
            >
              {structuredText(view.report.structured)}
            </pre>
          )}
        </>
      );
    case "pending":
      return <p>No report yet: this child has not finished.</p>;
    case "not-record-only":
      return <p>No stored report: this child does not deliver its result as a stored record.</p>;
    case "missing":
      return (
        <p className="break-words">
          Missing: the Backend has no such child under this session.
          {view.detail === undefined ? "" : ` ${view.detail}`}
        </p>
      );
    case "unreadable":
      return (
        <p className="break-words">
          Unreadable: the report could not be read, so its contents are not known ({view.reason}).
        </p>
      );
    case "unavailable":
      return <p className="break-words">Unavailable: {view.reason}</p>;
    case "refused":
      return <RefusalNotice code={view.code} backendMessage={view.detail} />;
  }
}
