// How a refusal reads on screen (D14): the display line for its code, then the Backend's own message and the coverage sentence EXACTLY as supplied. The component adds no words to either and
// hides nothing: an unknown code shows its text. It is presentational — props in, markup out — so any view that meets a refusal mounts it.
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { classOf, describeRefusal, type RefusalLocale } from "./describe";

export interface RefusalNoticeProps {
  /** The refusal's code, or the id of a code-less refusal. */
  readonly code: string;
  /** The Backend's message for this refusal, shown verbatim. */
  readonly backendMessage?: string | undefined;
  /** The coverage sentence the Backend supplied for the guarantee, shown verbatim. */
  readonly coverage?: string | undefined;
  readonly locale?: RefusalLocale;
  readonly className?: string;
}

/** Failure classes read as errors; everything else (a refusal, a conflict, a warning) is a warning the person can act on. */
const isError = (cls: ReturnType<typeof classOf>): boolean =>
  cls === "failure" || cls === "failed-unchanged";

export function RefusalNotice({
  code,
  backendMessage,
  coverage,
  locale = "en",
  className,
}: RefusalNoticeProps) {
  const shown = describeRefusal(code, backendMessage, locale);
  const error = isError(classOf(code));
  // An unknown code's text IS the Backend's message; showing it again below would repeat it.
  const repeatsText = !shown.known && shown.text === backendMessage;
  return (
    <Alert
      variant={error ? "error" : "warning"}
      role={error ? "alert" : "status"}
      lang={locale}
      className={className}
      data-refusal-code={code}
      data-refusal-known={String(shown.known)}
    >
      <AlertTitle>{shown.text}</AlertTitle>
      <AlertDescription>
        {backendMessage !== undefined && backendMessage !== "" && !repeatsText ? (
          <span data-verbatim="backend" className="block whitespace-pre-wrap break-words" lang="en">
            {backendMessage}
          </span>
        ) : null}
        {coverage !== undefined && coverage !== "" ? (
          <span
            data-verbatim="coverage"
            className="block whitespace-pre-wrap break-words"
            lang="en"
          >
            {coverage}
          </span>
        ) : null}
        <code className="block break-all text-xs opacity-80">{code}</code>
      </AlertDescription>
    </Alert>
  );
}
