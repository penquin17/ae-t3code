// A static statement that goals and workflows are not built (M10 Plan step 18, D14, XC-23). M07 owns them and has not delivered, so this card makes no request, offers no control, and never shows a
// goal, a workflow, a progress state or a Re-arm of its own: nothing here is a UI-local flag. When M07's contracts land, this card is replaced, not extended.
import { useId } from "react";

export function GoalsCard() {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-aetheria="goals"
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-dashed p-3"
    >
      <h2 id={headingId} className="text-base font-semibold">
        Goals and workflows
      </h2>
      <p className="break-words text-sm text-muted-foreground">
        Goals and workflows are not built yet (M07).
      </p>
    </section>
  );
}
