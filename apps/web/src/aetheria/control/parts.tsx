// Shared presentational pieces of the human-control cards: raw text, a record's state, an action's result, and a stored draft. Props in, markup out; no Backend access.
import { useState, type ReactNode } from "react";

import { Alert, AlertDescription } from "../../components/ui/alert";
import { RefusalNotice } from "../refusals/RefusalNotice";
import type { ActionReport } from "./actions";
import type { DraftKey, DraftStore } from "./drafts";
import { recordFacts, reportNotice } from "./recordText";
import type { InteractionRecord } from "./types";

export const cardClass =
  "flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground";
export const mutedClass = "text-xs text-muted-foreground";

/** Markdown the Backend stored raw is shown as text, wrapped, and never parsed or executed (D7). */
export function RawText({ text, label }: { readonly text: string; readonly label?: string }) {
  return (
    <pre
      aria-label={label}
      data-raw-text
      className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-sans text-sm text-foreground"
    >
      {text}
    </pre>
  );
}

/** The state of a record exactly as supplied: headline, then each supplied fact. */
export function RecordStatus({ record }: { readonly record: InteractionRecord }) {
  const facts = recordFacts(record);
  return (
    <div
      data-record-state={record.state}
      data-held={String(record.held)}
      className="flex flex-col gap-0.5"
    >
      <p className="text-sm font-medium">{facts.headline}</p>
      {facts.lines.map((line) => (
        <p key={line} className={`${mutedClass} break-words`}>
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * What the last action did: one honest sentence, the Backend's refusal verbatim, and the record it supplied with an already-settled or failed-delivery reply. The text lives in a live region so
 * a screen reader hears it.
 */
export function ReportView({
  label,
  report,
}: {
  readonly label: string;
  readonly report: ActionReport<unknown> | null;
}) {
  if (report === null || !report.sent) return null;
  const notice = reportNotice(label, report);
  const { outcome, reply } = report;
  return (
    <div data-report={outcome.kind} data-reply-class={reply.class} className="flex flex-col gap-2">
      {notice === null ? null : (
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
      )}
      {outcome.kind === "refused" ? (
        <RefusalNotice
          code={outcome.code}
          backendMessage={outcome.message === "" ? undefined : outcome.message}
        />
      ) : null}
      {reply.record === undefined ? null : (
        <div data-supplied-record className="rounded-lg border border-border p-3">
          <p className={mutedClass}>The Backend's record</p>
          <RecordStatus record={reply.record} />
        </div>
      )}
    </div>
  );
}

export interface StoredDraft<T> {
  readonly value: T;
  readonly set: (next: T) => void;
  /** Text typed against an earlier revision of this request: readable, never submitted. */
  readonly earlier: { readonly text: string; readonly revision: string } | null;
  /** Called only after the Backend confirmed the action. */
  readonly clear: () => void;
}

/** A draft kept in the store under (session, interaction, revision), restored on mount. Writing never sends and never clears. */
export function useStoredDraft<T>(
  store: DraftStore,
  key: DraftKey,
  codec: {
    readonly empty: T;
    readonly parse: (text: string) => T | null;
    readonly serialize: (value: T) => string;
  },
): StoredDraft<T> {
  const [initial] = useState(() => {
    const read = store.read(key);
    if (read.status === "current")
      return { value: codec.parse(read.value) ?? codec.empty, earlier: null };
    if (read.status === "earlier")
      return { value: codec.empty, earlier: { text: read.value, revision: read.revision } };
    return { value: codec.empty, earlier: null };
  });
  const [value, setValue] = useState(initial.value);
  const set = (next: T) => {
    setValue(next);
    store.write(key, codec.serialize(next));
  };
  const clear = () => store.clear(key);
  return { value, set, earlier: initial.earlier, clear };
}

export function EarlierDraft({
  text,
  revision,
}: {
  readonly text: string;
  readonly revision: string;
}) {
  return (
    <div
      data-earlier-draft
      className="flex flex-col gap-1 rounded-lg border border-dashed border-border p-3"
    >
      <p className="text-xs font-medium text-warning-foreground">From an earlier version</p>
      <p className={mutedClass}>
        This text was typed against revision {revision.slice(0, 8)}, which has since changed. It
        cannot be sent; copy from it if it helps.
      </p>
      <RawText text={text} label="Draft from an earlier version" />
    </div>
  );
}

export function Heading({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  return (
    <h2 id={id} className="text-base font-medium text-foreground">
      {children}
    </h2>
  );
}
