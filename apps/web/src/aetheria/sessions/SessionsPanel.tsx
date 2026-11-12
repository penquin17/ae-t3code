import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useState } from "react";

import { Input } from "../../components/ui/input";
import { useSidebar } from "../../components/ui/sidebar";
import type { RunResult } from "../core/outcome";
import { AetheriaSessionTree } from "./AetheriaSessionTree";
import { outcomeText, type OutcomeNotice } from "./outcomeText";
import { useSessionActions, type SessionActions } from "./useSessionActions";
import { useSessionTree } from "./useSessionTree";

/**
 * Search, the project tree and a polite status line for the last action's outcome. Used by the
 * Aetheria sidebar and the sessions page; it holds only view memory (search text, the last notice).
 */
export function SessionsPanel() {
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<OutcomeNotice | null>(null);
  const { model, now } = useSessionTree(query);
  const base = useSessionActions();
  const { isMobile, setOpenMobile } = useSidebar();

  const actions: SessionActions = {
    ...base,
    open: (sessionId) => {
      base.open(sessionId);
      if (isMobile) setOpenMobile(false);
    },
  };

  const onResult = (label: string, run: Promise<RunResult<unknown>>) => {
    setNotice(null);
    void run.then((result) => {
      // A reply for an action a newer one has replaced says nothing about the present.
      if (!result.current) return;
      setNotice(outcomeText(label, result.outcome));
      const outcome = result.outcome;
      if (label === "Fork" && outcome.kind === "confirmed") {
        const target = outcome.value as Parameters<typeof scopedThreadKey>[0];
        actions.open(scopedThreadKey(target));
      }
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-1">
        <Input
          type="search"
          aria-label="Search sessions by title"
          placeholder="Search sessions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div role="status" aria-live="polite" className="px-3 text-xs text-sidebar-muted-foreground">
        {notice === null ? null : (
          <p
            data-tone={notice.tone}
            className={notice.tone === "error" ? "text-destructive" : undefined}
          >
            {notice.text}
          </p>
        )}
      </div>
      <AetheriaSessionTree model={model} now={now} actions={actions} onResult={onResult} />
    </div>
  );
}
