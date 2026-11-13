// The authority label of T3's terminal drawer (M10 Plan step 16, D13; integration point IP-61): one line, mounted by the drawer's marked hunk, so a person reads who a terminal runs as before they type.
import { TERMINAL_AUTHORITY } from "./notice";

export function TerminalAuthorityLabel() {
  return (
    <p
      role="note"
      data-aetheria="terminal-authority"
      className="shrink-0 border-b border-border/70 bg-background py-0.5 pl-2 pr-28 text-2xs text-muted-foreground"
    >
      {TERMINAL_AUTHORITY}
    </p>
  );
}
