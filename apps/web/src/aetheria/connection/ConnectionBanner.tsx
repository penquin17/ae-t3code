// How the connection reads on screen (D6–D8): this client's headline, then someone else's words verbatim with whose they are, the digests and — only when the composition status supplied them — the modules.
// Presentational: a ConnectionView in, markup out; the model owns every decision. A control appears only when its intent is supplied, and the view never offers a read-only fallback.
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import type { ConnectionKind, ConnectionView, Locale } from "./state";

const LABELS = {
  en: {
    source: { server: "Server says", t3: "T3 says", client: "This client says" },
    expected: "This client expects",
    actual: "The server reports",
    modules: "Modules (from the Backend's status)",
    required: "required",
    attempt: "Attempt",
    reload: "Reload",
    signIn: "Sign in again",
  },
  zh: {
    source: { server: "服务器说", t3: "T3 说", client: "本客户端说" },
    expected: "本客户端期望",
    actual: "服务器报告",
    modules: "模块（来自后端状态）",
    required: "必需",
    attempt: "第",
    reload: "重新加载",
    signIn: "重新登录",
  },
} as const satisfies Record<Locale, unknown>;

type Variant = "info" | "success" | "warning" | "error";

const VARIANT: Record<ConnectionKind, Variant> = {
  connected: "success",
  connecting: "info",
  reconnecting: "info",
  disconnected: "info",
  unauthorized: "error",
  "access-ended": "error",
  "version-mismatch": "error",
  unknown: "warning",
};

/** A state that needs the person to act or understand something is announced as an alert; a passing one is a status. */
const isAlert = (kind: ConnectionKind): boolean => VARIANT[kind] === "error" || kind === "unknown";

export interface ConnectionBannerProps {
  readonly view: ConnectionView;
  readonly locale?: Locale;
  readonly onReload?: () => void;
  readonly onSignIn?: () => void;
  readonly className?: string;
}

export function ConnectionBanner({
  view,
  locale = "en",
  onReload,
  onSignIn,
  className,
}: ConnectionBannerProps) {
  const labels = LABELS[locale];
  const modules = view.modules.state === "known" ? view.modules.value : [];
  return (
    <Alert
      variant={VARIANT[view.kind]}
      role={isAlert(view.kind) ? "alert" : "status"}
      lang={locale}
      className={className}
      data-connection-kind={view.kind}
      data-connection-cause={view.cause ?? ""}
      data-connection-actions={view.actions}
      data-connection-stale={String(view.stale)}
    >
      {/* The words carry the foreground colour inside the slots: the error and warning tokens give 4.38:1 in dark mode on their own surface, so the tone is the border and surface, not the text. */}
      <AlertTitle>
        <span className="text-foreground">{view.headline}</span>
      </AlertTitle>
      <AlertDescription>
        <div className="text-foreground">
          {view.detail !== undefined ? (
            <span className="block min-w-0 break-words" data-source={view.detail.source}>
              <span className="font-medium">{labels.source[view.detail.source]}: </span>
              <span
                data-verbatim={view.detail.source}
                className="whitespace-pre-wrap break-words"
                lang="en"
              >
                {view.detail.text}
              </span>
            </span>
          ) : null}
          {view.digests !== undefined &&
          (view.digests.expected !== undefined || view.digests.actual !== undefined) ? (
            <dl className="grid min-w-0 gap-x-2 gap-y-0.5 text-xs" data-testid="connection-digests">
              {view.digests.expected !== undefined ? (
                <div className="min-w-0">
                  <dt className="font-medium">{labels.expected}</dt>
                  <dd className="break-all font-mono" data-digest="expected">
                    {view.digests.expected}
                  </dd>
                </div>
              ) : null}
              {view.digests.actual !== undefined ? (
                <div className="min-w-0">
                  <dt className="font-medium">{labels.actual}</dt>
                  <dd className="break-all font-mono" data-digest="actual">
                    {view.digests.actual}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {modules.length > 0 ? (
            <div className="min-w-0 text-xs" data-testid="connection-modules">
              <span className="font-medium">{labels.modules}</span>
              <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {modules.map((m) => (
                  <li key={m.id} className="break-all" data-module={m.id}>
                    {m.id}: {m.state}
                    {m.required ? ` (${labels.required})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {view.kind === "reconnecting" && view.attempt > 1 ? (
            <span className="block text-xs" data-testid="connection-attempt">
              {locale === "zh"
                ? `${labels.attempt} ${view.attempt} 次尝试`
                : `${labels.attempt} ${view.attempt}`}
            </span>
          ) : null}
          {view.code !== undefined ? (
            <code className="block break-all text-xs opacity-80">{view.code}</code>
          ) : null}
          {(view.offer === "reload" && onReload !== undefined) ||
          (view.offer === "sign-in" && onSignIn !== undefined) ? (
            <span className="mt-1 flex gap-2">
              {view.offer === "reload" && onReload !== undefined ? (
                <Button size="sm" variant="outline" onClick={onReload}>
                  {labels.reload}
                </Button>
              ) : null}
              {view.offer === "sign-in" && onSignIn !== undefined ? (
                <Button size="sm" variant="outline" onClick={onSignIn}>
                  {labels.signIn}
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}
