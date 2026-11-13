// The terminal statement of the deliverables page (M10 Plan step 16, D13): presentational, props in nothing, words out.
import { REGION } from "../regions/declarations";
import { useRegion } from "../regions/useRegion";
import { TERMINAL_AUTHORITY, TERMINAL_NOT_MOUNTED } from "./notice";

export function TerminalNotice() {
  useRegion(REGION.deliverablesTerminal, () => ({}));
  return (
    <section
      aria-label="Terminal"
      data-aetheria="terminal-notice"
      className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-card p-4 text-card-foreground"
    >
      <h2 className="text-base font-semibold">Terminal</h2>
      <p className="text-sm">{TERMINAL_NOT_MOUNTED}</p>
      <p className="text-xs text-muted-foreground">{TERMINAL_AUTHORITY}</p>
    </section>
  );
}
