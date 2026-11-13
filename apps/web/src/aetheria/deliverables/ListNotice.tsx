// How a list that is not known reads (M10 Plan step 16, C1/D14): reading, refused, unavailable or unknown, each in its own words, each with the Backend's code and message verbatim. Never empty, never
// idle. Presentational: props in, markup out.
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import type { FailureView } from "./model";
import { lineForCode } from "./words";

export function ListNotice({
  what,
  view,
}: {
  /** "deliverables" or "edit record": the thing that was being read. */
  readonly what: string;
  readonly view: FailureView | { readonly tag: "reading" };
}) {
  if (view.tag === "reading") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Reading the {what}…
      </p>
    );
  }
  if (view.tag === "unknown") {
    return (
      <p
        data-testid="list-unknown"
        data-list-state="unknown"
        className="break-words text-sm text-muted-foreground"
      >
        The {what} could not be read, so what exists is not known: {view.reason}
      </p>
    );
  }
  const code = view.code;
  const detail = view.detail;
  const line = code === undefined ? undefined : lineForCode(code);
  return (
    <Alert
      variant={view.tag === "unavailable" ? "error" : "warning"}
      role={view.tag === "unavailable" ? "alert" : "status"}
      data-list-state={view.tag}
      data-refusal-code={code}
    >
      <AlertTitle className="break-words">
        {view.tag === "unavailable"
          ? `The ${what} are unavailable: ${line ?? view.reason}`
          : (line ?? detail ?? code ?? "Refused (no code or message was supplied).")}
      </AlertTitle>
      <AlertDescription>
        {code === undefined ? null : (
          <span className="block break-words text-xs">Code: {code}</span>
        )}
        {detail !== undefined && detail !== "" ? (
          <span data-verbatim="backend" className="block whitespace-pre-wrap break-words">
            {detail}
          </span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
