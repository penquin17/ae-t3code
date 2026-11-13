// The download and preview controls of one item, and what the last request said (M10 Plan step 16, C5/C6). Both semantics are named in words: the current file (the default) and, when a copy is
// kept, the file as delivered. A refusal is shown as a plain line plus the Backend's own message verbatim; an Office or unknown kind says it cannot be previewed instead of offering a viewer.
// Everything is derived from the props and the owner's slots (`useFetches`); this holds no state of its own.
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { lineForCode } from "../deliverables/words";
import { comparisonText, humanSize, type Semantics } from "../deliverables/model";
import { previewPlan } from "./preview";
import { PreviewPane } from "./PreviewPane";
import type { FetchTarget, Fetches, Problem } from "./useFetches";

export interface FileItem {
  readonly id: string;
  readonly label: string;
  readonly rootThreadId?: string;
  readonly path: string;
  readonly filename: string;
  readonly kind: FetchTarget["kind"];
  readonly size: number | null;
  readonly declaredDigest: string | null;
  readonly semantics: readonly Semantics[];
}

const SEMANTICS_WORDS: Record<Semantics, { readonly noun: string; readonly detail: string }> = {
  current: { noun: "current file", detail: "the file as it is now" },
  "as-delivered": { noun: "as delivered", detail: "the copy kept when it was delivered" },
};

function ProblemNotice({ problem }: { readonly problem: Problem }) {
  if (problem.tag === "refused") {
    const line = lineForCode(problem.code);
    return (
      <Alert
        variant="warning"
        role="alert"
        data-refusal-code={problem.code}
        data-refusal-known={String(problem.known)}
      >
        <AlertTitle>{line ?? `The Backend refused the download (${problem.status}).`}</AlertTitle>
        <AlertDescription>
          <span className="block break-words text-xs text-foreground">Code: {problem.code}</span>
          {problem.detail !== undefined && problem.detail !== "" ? (
            <span
              data-verbatim="backend"
              className="block whitespace-pre-wrap break-words text-foreground"
            >
              {problem.detail}
            </span>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert
      variant={problem.tag === "not-previewable" ? "warning" : "error"}
      role={problem.tag === "not-previewable" ? "status" : "alert"}
      data-problem={problem.tag}
    >
      <AlertTitle className="break-words">{problem.reason}</AlertTitle>
    </Alert>
  );
}

export function FileActions({
  item,
  fetches,
}: {
  readonly item: FileItem;
  readonly fetches: Fetches;
}) {
  const save = fetches.saveOf(item.id);
  const preview = fetches.previewOf(item.id);
  const plan = previewPlan(item.kind, item.size ?? 0);
  const target = (semantics: Semantics): FetchTarget => ({
    id: item.id,
    ...(item.rootThreadId === undefined ? {} : { rootThreadId: item.rootThreadId }),
    semantics,
    filename: item.filename,
    path: item.path,
    kind: item.kind,
    size: item.size,
    declaredDigest: item.declaredDigest,
  });
  return (
    <div data-file-actions={item.id} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {item.semantics.map((semantics) => (
          <Button
            key={`save-${semantics}`}
            variant="outline"
            size="sm"
            title={SEMANTICS_WORDS[semantics].detail}
            disabled={save.tag === "working"}
            aria-label={`Download ${SEMANTICS_WORDS[semantics].noun} of ${item.label}`}
            onClick={() => fetches.save(target(semantics))}
          >
            Download {SEMANTICS_WORDS[semantics].noun}
          </Button>
        ))}
        {plan.mode === "download-only"
          ? null
          : item.semantics.map((semantics) => (
              <Button
                key={`preview-${semantics}`}
                variant="outline"
                size="sm"
                title={SEMANTICS_WORDS[semantics].detail}
                aria-label={`Preview ${SEMANTICS_WORDS[semantics].noun} of ${item.label}`}
                onClick={() => fetches.preview(target(semantics))}
              >
                Preview {SEMANTICS_WORDS[semantics].noun}
              </Button>
            ))}
      </div>
      {plan.mode === "download-only" ? (
        <p data-testid="preview-unavailable" className="text-xs text-muted-foreground">
          {plan.reason}
        </p>
      ) : null}
      <div role="status" aria-live="polite" className="flex min-w-0 flex-col gap-1 text-xs">
        {save.tag === "working" ? <p>Downloading…</p> : null}
        {save.tag === "saved" ? (
          <>
            <p data-testid="saved">
              Saved {save.filename} ({humanSize(save.size)}), {SEMANTICS_WORDS[save.semantics].noun}
              .
            </p>
            {save.comparison === null ? (
              <p className="text-muted-foreground">
                This path carries no declared digest, so none was compared.
              </p>
            ) : (
              <p data-testid="comparison" data-comparison={save.comparison.tag}>
                {comparisonText(save.semantics, save.comparison)}
              </p>
            )}
          </>
        ) : null}
        {preview.tag === "working" ? <p>Fetching the preview…</p> : null}
      </div>
      {save.tag === "problem" ? <ProblemNotice problem={save.problem} /> : null}
      {preview.tag === "problem" ? <ProblemNotice problem={preview.problem} /> : null}
      {preview.tag === "open" ? (
        <div data-testid="preview" className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">
              Preview, {SEMANTICS_WORDS[preview.semantics].noun}
            </p>
            <Button
              variant="ghost-muted"
              size="sm"
              aria-label={`Close preview of ${item.label}`}
              onClick={() => fetches.closePreview(item.id)}
            >
              Close preview
            </Button>
          </div>
          {preview.comparison === null ? null : (
            <p
              className="text-xs"
              data-testid="comparison"
              data-comparison={preview.comparison.tag}
            >
              {comparisonText(preview.semantics, preview.comparison)}
            </p>
          )}
          <PreviewPane content={preview.content} title={item.label} />
        </div>
      ) : null}
    </div>
  );
}
