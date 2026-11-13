// Which routes the children can use and what usage each provider reports (M10 Plan step 18, D14, D20, XC-11). Everything shown is the Backend's last answer: a route is available, out or unknown
// with its reason class and basis, a reading that was not read is unavailable or stale and never 0, an unreadable answer is "not known", and the main thread's route is said not to be supplied by
// the Backend. The control page mounts this with the root's ids; the transport comes from `UsageTransportContext`.
import { useId } from "react";

import { Button } from "../../../components/ui/button";
import { REGION } from "../../regions/declarations";
import { useRegion } from "../../regions/useRegion";
import { RefusalNotice } from "../../refusals/RefusalNotice";
import type { ReadView } from "../jobs/reply";
import { useSuppliedRead } from "../jobs/useSuppliedRead";
import {
  MAIN_ROUTE_TEXT,
  parseUsage,
  readingView,
  routeRowView,
  type RouteRowView,
  type UsageReadingView,
  type UsageValue,
} from "./model";
import { useUsageTransport } from "./transport";

export interface UsagePanelProps {
  /** The T3 environment and thread of the root session, as in the control route's params. */
  readonly environmentId: string;
  readonly threadId: string;
}

export function UsagePanel(props: UsagePanelProps) {
  const transport = useUsageTransport();
  const rootThreadId = props.threadId;
  const target = { environmentId: props.environmentId, rootThreadId };
  const usage = useSuppliedRead({
    environmentId: props.environmentId,
    resetKey: `${props.environmentId}\u0000${rootThreadId}`,
    read: () => transport.read(target),
    parse: parseUsage,
  });
  const headingId = useId();
  const { view, refreshing } = usage;
  useRegion(REGION.controlUsage, () => ({
    props: { threadId: rootThreadId },
    state: { list: view.tag, refreshing },
  }));
  return (
    <section
      aria-labelledby={headingId}
      data-aetheria="usage"
      data-root={rootThreadId}
      className="flex min-w-0 flex-col gap-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">
          Routes and usage
        </h2>
        <Button
          variant="outline"
          size="sm"
          aria-label="Refresh usage"
          onClick={() => void usage.refresh()}
        >
          Refresh
        </Button>
      </header>
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {refreshing && view.tag !== "reading" ? <p>Reading routes and usage again…</p> : null}
      </div>
      <p
        data-testid="main-route"
        className="rounded-md border border-dashed p-2 text-sm text-muted-foreground"
      >
        {MAIN_ROUTE_TEXT}
      </p>
      <UsageBody view={view} />
    </section>
  );
}

function UsageBody(props: { readonly view: ReadView<UsageValue> }) {
  const { view } = props;
  if (view.tag === "reading") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Reading routes and usage…
      </p>
    );
  }
  if (view.tag === "refused") {
    return <RefusalNotice code={view.code} backendMessage={view.detail} />;
  }
  if (view.tag === "unavailable") {
    return (
      <p data-testid="usage-unavailable" className="break-words text-sm text-destructive">
        Route availability and usage are unavailable: {view.reason}
      </p>
    );
  }
  if (view.tag === "unknown") {
    return (
      <p data-testid="usage-unknown" className="break-words text-sm text-muted-foreground">
        The answer could not be read, so route availability and usage are not known: {view.reason}
      </p>
    );
  }
  const { routes, readings, notes } = view.value;
  return (
    <>
      <section aria-label="Child routes" className="flex min-w-0 flex-col gap-2">
        <h3 className="text-sm font-semibold">Child routes</h3>
        {notes?.routes !== undefined ? (
          <p data-testid="routes-unread" className="break-words text-sm text-destructive">
            The child routes could not be read, so they are not known: {notes.routes}
          </p>
        ) : null}
        {notes?.children?.map((line) => (
          <p
            key={line}
            data-testid="route-note"
            className="break-words text-sm text-muted-foreground"
          >
            {line}
          </p>
        ))}
        {notes?.routes !== undefined ? null : routes.length === 0 ? (
          <p data-testid="routes-empty" className="text-sm text-muted-foreground">
            The Backend lists no child routes for this session
            {notes?.children === undefined ? "." : " that have a state to show."}
          </p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-2" aria-label="Child routes">
            {routes.map(routeRowView).map((row) => (
              <RouteRow key={`${row.routeText}\u0000${row.childText ?? ""}`} row={row} />
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Usage by provider" className="flex min-w-0 flex-col gap-2">
        <h3 className="text-sm font-semibold">Usage by provider</h3>
        {notes?.readings !== undefined ? (
          <p data-testid="readings-unread" className="break-words text-sm text-destructive">
            Usage could not be read, so it is not known (this is not zero usage): {notes.readings}
          </p>
        ) : readings.length === 0 ? (
          <p data-testid="readings-empty" className="text-sm text-muted-foreground">
            The Backend supplied no usage readings. That is not zero usage.
          </p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-2" aria-label="Usage by provider">
            {readings.map(readingView).map((reading) => (
              <ReadingRow key={reading.provider} reading={reading} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function RouteRow({ row }: { readonly row: RouteRowView }) {
  return (
    <li
      data-route={row.routeText.replace(" / ", "/")}
      data-state={row.state}
      data-fixture={row.fixture ? "true" : undefined}
      className="min-w-0 rounded-lg border bg-card p-3 text-sm text-card-foreground"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-medium">{row.routeText}</span>
        <span data-testid="route-state" className="rounded-full border px-2 py-0.5 text-xs">
          {row.stateText}
        </span>
        {row.fixture ? (
          <span className="rounded-full border border-dashed px-2 py-0.5 text-xs">
            Fixture data
          </span>
        ) : null}
      </div>
      {row.childText === null ? null : (
        <p className="break-words text-muted-foreground">{row.childText}</p>
      )}
      <p className="break-words">{row.reasonText}</p>
      <p className="break-words text-muted-foreground">
        Reason class: <code>{row.reasonClass}</code> · {row.observedText}
      </p>
      {row.resetsText === null ? null : <p className="break-words">{row.resetsText}</p>}
      {row.emptySinceText === null ? null : <p className="break-words">{row.emptySinceText}</p>}
      {row.basisNote === null ? null : (
        <p className="break-words text-muted-foreground">{row.basisNote}</p>
      )}
      {row.basisTexts.length === 0 ? null : (
        <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground" aria-label="Basis">
          {row.basisTexts.map((basis) => (
            <li key={basis} className="break-words">
              {basis}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function ReadingRow({ reading }: { readonly reading: UsageReadingView }) {
  return (
    <li
      data-provider={reading.provider}
      data-status={reading.status}
      data-fixture={reading.fixture ? "true" : undefined}
      className="min-w-0 rounded-lg border bg-card p-3 text-sm text-card-foreground"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-medium">{reading.provider}</span>
        <span data-testid="reading-status" className="rounded-full border px-2 py-0.5 text-xs">
          {reading.statusText}
        </span>
        {reading.fixture ? (
          <span className="rounded-full border border-dashed px-2 py-0.5 text-xs">
            Fixture data
          </span>
        ) : null}
      </div>
      {reading.windows.length === 0 ? null : (
        <ul
          className="mt-1 flex flex-col gap-0.5"
          aria-label={`Usage windows of ${reading.provider}`}
        >
          {reading.windows.map((window) => (
            <li key={window.id} className="break-words">
              {window.text}
              {window.resetsText === null ? "" : ` · ${window.resetsText}`}
            </li>
          ))}
        </ul>
      )}
      {reading.note === null ? null : (
        <p className="break-words text-muted-foreground">{reading.note}</p>
      )}
    </li>
  );
}
