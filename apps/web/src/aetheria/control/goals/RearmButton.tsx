// The Re-arm control and what it last did (M07 Plan step 18, D24, C8), shared by the goal card and by an authorization card that is tied to the goal's Re-arm. The button is the person's own click: it asks the one
// owner (`GoalsProvider`) to grant for the snapshot's exact subject and pass that grant to `goal.rearm`. It stays focusable while busy (aria-disabled, never a dropped click that sends twice), and when the
// goal changes under it and the button goes away, focus returns to the card that held it, where the result is said.
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { RefusalNotice } from "../../refusals/RefusalNotice";
import { mutedClass } from "../parts";
import type { GoalsHandle } from "./useGoals";
import type { GoalView } from "./reply";
import { rearmNotice } from "./text";

export function RearmButton({
  goal,
  handle,
}: {
  readonly goal: GoalView;
  readonly handle: GoalsHandle;
}) {
  const { busy, start } = handle.rearm;
  return (
    <Button
      data-rearm="ready"
      aria-disabled={busy}
      aria-busy={busy}
      onClick={(event) => {
        if (busy) return;
        const button = event.currentTarget;
        const home = button.closest<HTMLElement>("[data-aetheria]");
        // The goal usually changes under the button (Re-arm goes away once the Backend shows the goal armed), which drops focus; after the page has drawn the result, focus goes to the card that says it.
        void start(goal).then(() =>
          requestAnimationFrame(() => {
            if (!button.isConnected || document.activeElement === document.body) home?.focus();
          }),
        );
      }}
    >
      Re-arm
    </Button>
  );
}

/** What the last Re-arm did, in one live region: a busy line, one honest sentence, and the Backend's refusal verbatim. Nothing renders before a Re-arm was tried. */
export function RearmStatus({ handle }: { readonly handle: GoalsHandle }) {
  const { busy, report } = handle.rearm;
  const notice = rearmNotice(report);
  const refused =
    report !== null && report.sent && report.outcome.kind === "refused" ? report.outcome : null;
  if (!busy && notice === null) return null;
  return (
    <div
      aria-live="polite"
      data-rearm-status={busy ? "busy" : report !== null && report.sent ? report.outcome.kind : ""}
      className="flex min-w-0 flex-col gap-2"
    >
      {busy ? (
        <p className={mutedClass}>
          Re-arming… the grant and the Re-arm are each sent once and never repeated.
        </p>
      ) : null}
      {!busy && notice !== null ? (
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
      ) : null}
      {!busy && refused !== null && refused.code !== "GOAL_STALE_REVISION" ? (
        <RefusalNotice
          code={refused.code}
          backendMessage={refused.message === "" ? undefined : refused.message}
        />
      ) : null}
    </div>
  );
}
