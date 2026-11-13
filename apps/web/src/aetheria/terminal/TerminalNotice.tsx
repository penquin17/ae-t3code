// The terminal statement of the deliverables page (M10 Plan step 16, D13): presentational, props in nothing, words out. The terminal itself is T3's own drawer in the chat view (integration point
// IP-61 adds its authority label and its exited-write words); this page only says who a terminal runs as and where to find it.
import { REGION } from "../regions/declarations";
import { useRegion } from "../regions/useRegion";
import { TERMINAL_AUTHORITY, TERMINAL_WHERE } from "./notice";

export function TerminalNotice() {
  useRegion(REGION.deliverablesTerminal, () => ({}));
  return (
    <section
      aria-label="Terminal"
      data-aetheria="terminal-notice"
      className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-card p-4 text-card-foreground"
    >
      <h2 className="text-base font-semibold">Terminal</h2>
      <p className="text-sm">{TERMINAL_WHERE}</p>
      <p className="text-xs text-muted-foreground">{TERMINAL_AUTHORITY}</p>
    </section>
  );
}
